use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use schemars::JsonSchema;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::vokoo::documents::{DocumentEvidence, EvidenceChunk};

use super::{
    lower, validate_output, CarePathProgram, CatalogueSnapshot, CompilationOutput, CompilerError,
    CompilerModel, ModelPhase, ModelRequest, Recommendation, TokenUsage, WorkspaceResources,
};

pub const MAX_SECTION_TASKS: usize = 4;
pub const MAX_TASK_PAGE_SPAN: usize = 80;
pub const MAX_CHUNKS_PER_TASK: usize = 20;
pub const MAX_MODEL_CALLS: usize = 8;
pub const MAX_CORRECTION_ATTEMPTS: usize = 1;
pub const MAX_DELEGATION_CORRECTION_ATTEMPTS: usize = 2;
pub const MAX_WORKER_CORRECTION_ATTEMPTS: usize = 2;

#[derive(Clone)]
pub struct CompilerInput {
    pub run_id: String,
    pub version_id: String,
    pub evidence: DocumentEvidence,
    pub catalogue: CatalogueSnapshot,
    pub resources: WorkspaceResources,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
pub struct SectionTask {
    pub id: String,
    pub heading: String,
    pub page_start: usize,
    pub page_end: usize,
    pub chunk_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
struct DelegationPlan {
    tasks: Vec<SectionTask>,
    #[serde(default)]
    excluded_sections: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
struct WorkerEmission {
    task_id: String,
    recommendations: Vec<Recommendation>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
struct RecommendationSelection {
    task_id: String,
    recommendation_id: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
struct Reconciliation {
    title: String,
    selections: Vec<RecommendationSelection>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
struct FinishCompilation {
    accepted_recommendations: usize,
    gap_count: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct TraceSummary {
    pub task_count: usize,
    pub recommendation_count: usize,
    pub selection_count: usize,
    pub gap_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct TraceEvent {
    pub phase: ModelPhase,
    pub task_id: Option<String>,
    pub tool_name: String,
    pub status: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub chunk_ids: Vec<String>,
    pub summary: TraceSummary,
    pub usage: TokenUsage,
    pub duration_ms: u64,
    pub error_code: Option<String>,
}

pub trait TraceSink: Send + Sync {
    fn emit(&self, event: TraceEvent);
}

pub struct CompilerHarness<'a> {
    model: &'a dyn CompilerModel,
    trace: &'a dyn TraceSink,
}

impl<'a> CompilerHarness<'a> {
    pub fn new(model: &'a dyn CompilerModel, trace: &'a dyn TraceSink) -> Self {
        Self { model, trace }
    }

    pub async fn compile(&self, input: CompilerInput) -> Result<CompilationOutput, CompilerError> {
        if !input
            .evidence
            .compiler_matches
            .iter()
            .any(|id| id == "care_path")
        {
            return Err(CompilerError::model("care_path_not_recommended"));
        }
        if input
            .evidence
            .representative_chunks
            .iter()
            .any(|chunk| chunk.version_id != input.version_id)
        {
            return Err(CompilerError::model("mixed_document_versions"));
        }

        let mut model_calls = 0usize;
        let plan: DelegationPlan = self
            .call_typed(
                request(
                    ModelPhase::Supervising,
                    None,
                    "delegate_section",
                    delegation_schema(),
                    json!({
                        "run_id": input.run_id,
                        "outline": input.evidence.outline,
                        "page_map": page_map(&input.evidence.representative_chunks)
                    }),
                ),
                |plan: &DelegationPlan| validate_plan(plan, &input.evidence.representative_chunks),
                |plan| TraceSummary {
                    task_count: plan.tasks.len(),
                    ..Default::default()
                },
                None,
                None,
                &mut model_calls,
            )
            .await?;

        let chunks_by_id: BTreeMap<_, _> = input
            .evidence
            .representative_chunks
            .iter()
            .map(|chunk| (chunk.chunk_id.as_str(), chunk))
            .collect();
        let mut emitted = BTreeMap::<String, Vec<Recommendation>>::new();
        for task in &plan.tasks {
            let task_chunks: Vec<_> = task
                .chunk_ids
                .iter()
                .filter_map(|id| chunks_by_id.get(id.as_str()))
                .copied()
                .collect();
            let task_id = task.id.clone();
            let version_id = input.version_id.clone();
            let validation_chunks = task_chunks.clone();
            let emission: WorkerEmission = self
                .call_typed(
                    request(
                        ModelPhase::Compiling,
                        Some(task.id.clone()),
                        "emit_recommendations",
                        worker_schema(&input.catalogue, &task_chunks),
                        json!({
                            "task": task,
                            "version_id": input.version_id,
                            "chunks": task_chunks,
                            "catalogue": input.catalogue,
                            "resources": input.resources
                        }),
                    ),
                    move |emission: &WorkerEmission| {
                        validate_emission(emission, &task_id, &version_id, &validation_chunks)
                    },
                    |emission| TraceSummary {
                        recommendation_count: emission.recommendations.len(),
                        ..Default::default()
                    },
                    Some(task),
                    Some(&task_chunks),
                    &mut model_calls,
                )
                .await?;
            emitted.insert(task.id.clone(), emission.recommendations);
        }

        let known: Vec<Value> = emitted
            .iter()
            .flat_map(|(task_id, recommendations)| {
                recommendations.iter().map(move |recommendation| {
                    json!({"task_id":task_id,"recommendation_id":recommendation.id,"title":recommendation.title})
                })
            })
            .collect();
        let known_for_validation = emitted.clone();
        let reconciliation: Reconciliation = self
            .call_typed(
                request(
                    ModelPhase::Reconciling,
                    None,
                    "emit_reconciliation",
                    reconciliation_schema(),
                    json!({"candidates":known,"excluded_section_count":plan.excluded_sections.len()}),
                ),
                move |value: &Reconciliation| validate_reconciliation(value, &known_for_validation),
                |value| TraceSummary { selection_count: value.selections.len(), ..Default::default() },
                None,
                None,
                &mut model_calls,
            )
            .await?;

        let mut recommendations = Vec::new();
        for selected in &reconciliation.selections {
            let recommendation = emitted
                .get(&selected.task_id)
                .and_then(|items| {
                    items
                        .iter()
                        .find(|item| item.id == selected.recommendation_id)
                })
                .cloned()
                .ok_or_else(|| CompilerError::model("unknown_recommendation_selection"))?;
            recommendations.push(recommendation);
        }
        let program = CarePathProgram {
            title: reconciliation.title,
            recommendations,
        };
        let output = lower(&program, &input.catalogue, &input.resources);
        let validation = validate_output(&output, &input.catalogue, &program);
        if let Err(errors) = validation {
            let code = errors
                .first()
                .map(|error| error.code.as_str())
                .unwrap_or("invalid_compilation");
            return Err(CompilerError::new(
                code,
                "deterministic compiler validation failed",
            ));
        }
        let expected_recommendations = program.recommendations.len();
        let expected_gaps = output.gaps.len();
        let _: FinishCompilation = self
            .call_typed(
                request(
                    ModelPhase::Finishing,
                    None,
                    "finish_compilation",
                    finish_schema(),
                    json!({"accepted_recommendations":expected_recommendations,"gap_count":expected_gaps}),
                ),
                move |finish: &FinishCompilation| {
                    if finish.accepted_recommendations != expected_recommendations || finish.gap_count != expected_gaps {
                        Err("finish_count_mismatch")
                    } else {
                        Ok(())
                    }
                },
                |finish| TraceSummary {
                    recommendation_count: finish.accepted_recommendations,
                    gap_count: finish.gap_count,
                    ..Default::default()
                },
                None,
                None,
                &mut model_calls,
            )
            .await?;
        Ok(output)
    }

    async fn call_typed<T, V, S>(
        &self,
        base_request: ModelRequest,
        validate: V,
        summarize: S,
        task: Option<&SectionTask>,
        canonical_evidence: Option<&[&EvidenceChunk]>,
        model_calls: &mut usize,
    ) -> Result<T, CompilerError>
    where
        T: DeserializeOwned,
        V: Fn(&T) -> Result<(), &'static str>,
        S: Fn(&T) -> TraceSummary,
    {
        let mut correction = None;
        let max_corrections = match base_request.tool_name.as_str() {
            "delegate_section" => MAX_DELEGATION_CORRECTION_ATTEMPTS,
            "emit_recommendations" => MAX_WORKER_CORRECTION_ATTEMPTS,
            _ => MAX_CORRECTION_ATTEMPTS,
        };
        for attempt in 0..=max_corrections {
            if *model_calls >= MAX_MODEL_CALLS {
                return Err(CompilerError::model("model_step_limit"));
            }
            *model_calls += 1;
            let mut request = base_request.clone();
            request.correction = correction.clone();
            let started = Instant::now();
            let response = match self.model.call(request.clone()).await {
                Ok(response) => response,
                Err(error) if error.code() == "required_tool_not_called" => {
                    self.trace.emit(trace_event(
                        &request,
                        task,
                        "rejected",
                        TraceSummary::default(),
                        TokenUsage::default(),
                        started.elapsed().as_millis() as u64,
                        Some("required_tool_not_called".into()),
                    ));
                    if attempt == max_corrections {
                        return Err(error);
                    }
                    correction = Some("required_tool_not_called".into());
                    continue;
                }
                Err(error) => return Err(error),
            };
            let mut arguments = response.arguments;
            normalize_tool_arguments(
                request.tool_name.as_str(),
                &mut arguments,
                canonical_evidence.unwrap_or_default(),
            );
            let parsed = if response.tool_name != request.tool_name {
                Err("wrong_tool_called")
            } else {
                let invalid_code =
                    classify_invalid_tool_output(request.tool_name.as_str(), &arguments);
                serde_json::from_value::<T>(arguments)
                    .map_err(|_| invalid_code)
                    .and_then(|value| validate(&value).map(|_| value))
            };
            match parsed {
                Ok(value) => {
                    self.trace.emit(trace_event(
                        &request,
                        task,
                        "accepted",
                        summarize(&value),
                        response.usage,
                        started.elapsed().as_millis() as u64,
                        None,
                    ));
                    return Ok(value);
                }
                Err(code) => {
                    self.trace.emit(trace_event(
                        &request,
                        task,
                        "rejected",
                        TraceSummary::default(),
                        response.usage,
                        started.elapsed().as_millis() as u64,
                        Some(code.into()),
                    ));
                    if attempt == max_corrections {
                        return Err(CompilerError::new(code, "typed model output was rejected"));
                    }
                    correction = Some(code.into());
                }
            }
        }
        Err(CompilerError::model("correction_limit"))
    }
}

fn trace_event(
    request: &ModelRequest,
    task: Option<&SectionTask>,
    status: &str,
    summary: TraceSummary,
    usage: TokenUsage,
    duration_ms: u64,
    error_code: Option<String>,
) -> TraceEvent {
    TraceEvent {
        phase: request.phase.clone(),
        task_id: request.task_id.clone(),
        tool_name: request.tool_name.clone(),
        status: status.into(),
        page_start: task.map(|task| task.page_start),
        page_end: task.map(|task| task.page_end),
        chunk_ids: task.map(|task| task.chunk_ids.clone()).unwrap_or_default(),
        summary,
        usage,
        duration_ms,
        error_code,
    }
}

fn request(
    phase: ModelPhase,
    task_id: Option<String>,
    tool: &str,
    schema: Value,
    payload: Value,
) -> ModelRequest {
    ModelRequest {
        phase,
        task_id,
        tool_name: tool.into(),
        tool_description: tool_description(tool),
        schema,
        system: "Compile only explicit source requirements. Cite supplied chunks. Unsupported intent is a gap. Call the required tool exactly once.".into(),
        payload,
        correction: None,
    }
}

fn tool_description(tool: &str) -> String {
    match tool {
        "delegate_section" => concat!(
            "Call this tool exactly once to select one to four non-overlapping source tasks. ",
            "Use the page_map previews and section paths to maximize longitudinal care-path coverage: ",
            "prefer explicit monitoring cadence, patient actions, completion criteria, and escalation ",
            "over background, bibliography, or the first isolated actionable statement. Each task must ",
            "contain one to twenty supplied chunk IDs and span no more than eighty source pages."
        )
        .into(),
        "emit_recommendations" => concat!(
            "Emit exactly one object with task_id and recommendations. Each recommendation must contain ",
            "id, title, population, trigger, thresholds, actions, completion, failure_policy, and evidence. ",
            "Population contains description, inclusions, exclusions, and evidence. Trigger is flattened: ",
            "put key, kind, the kind-specific fields, and evidence in the same object; kind is exactly one of ",
            "due, recurring, reported, or document. Every action is also flattened: put key, kind, the ",
            "kind-specific fields, and evidence in the same object; kind is exactly one of request, conversation, ",
            "record_observation, intelligence, or unsupported. Every request must include actor: patient, clinician, ",
            "care_team, or system. Use patient only when the source directs the patient to act. Prescribing, ordering, ",
            "and clinician review must use clinician or care_team; these become explicit capability gaps and must never ",
            "be represented as patient outreach. ",
            "Evidence entries contain only chunk_id and role; the compiler hydrates canonical excerpts. Use null for absent completion or ",
            "failure_policy. Do not invent fields or nest trigger/action operation objects."
        ).into(),
        _ => format!("Emit the typed {tool} result and include every required field from its schema."),
    }
}

fn classify_invalid_tool_output(tool: &str, value: &Value) -> &'static str {
    if tool != "emit_recommendations" {
        return "invalid_tool_output";
    }
    let Some(output) = value.as_object() else {
        return "invalid_tool_output_top_level";
    };
    if !output.get("task_id").is_some_and(Value::is_string) {
        return "invalid_tool_output_task_id";
    }
    let Some(recommendations) = output.get("recommendations").and_then(Value::as_array) else {
        return "invalid_tool_output_recommendations";
    };
    for recommendation in recommendations {
        let Some(recommendation) = recommendation.as_object() else {
            return "invalid_tool_output_recommendation";
        };
        if !recommendation.get("id").is_some_and(Value::is_string)
            || !recommendation.get("title").is_some_and(Value::is_string)
        {
            return "invalid_tool_output_recommendation_identity";
        }
        let Some(population) = recommendation.get("population").and_then(Value::as_object) else {
            return "invalid_tool_output_population";
        };
        if !population.get("description").is_some_and(Value::is_string)
            || !population.get("evidence").is_some_and(Value::is_array)
        {
            return "invalid_tool_output_population_fields";
        }
        let Some(trigger) = recommendation.get("trigger").and_then(Value::as_object) else {
            return "invalid_tool_output_trigger";
        };
        if trigger.get("kind").is_none() && trigger.get("operation").is_some() {
            return "invalid_tool_output_trigger_operation_nested";
        }
        if !matches!(
            trigger.get("kind").and_then(Value::as_str),
            Some("due" | "recurring" | "reported" | "document")
        ) {
            return "invalid_tool_output_trigger_kind";
        }
        if !trigger.get("evidence").is_some_and(Value::is_array) {
            return "invalid_tool_output_trigger_evidence";
        }
        if !recommendation
            .get("thresholds")
            .is_some_and(Value::is_array)
        {
            return "invalid_tool_output_thresholds";
        }
        let Some(actions) = recommendation.get("actions").and_then(Value::as_array) else {
            return "invalid_tool_output_actions";
        };
        for action in actions {
            let Some(action) = action.as_object() else {
                return "invalid_tool_output_action";
            };
            if action.get("kind").is_none() && action.get("operation").is_some() {
                return "invalid_tool_output_action_operation_nested";
            }
            if !matches!(
                action.get("kind").and_then(Value::as_str),
                Some(
                    "request"
                        | "conversation"
                        | "record_observation"
                        | "intelligence"
                        | "unsupported"
                )
            ) {
                return "invalid_tool_output_action_kind";
            }
            if action.get("kind").and_then(Value::as_str) == Some("request")
                && !matches!(
                    action.get("actor").and_then(Value::as_str),
                    Some("patient" | "clinician" | "care_team" | "system")
                )
            {
                return "invalid_tool_output_request_actor";
            }
            if !action.get("evidence").is_some_and(Value::is_array) {
                return "invalid_tool_output_action_evidence";
            }
        }
        if !recommendation.get("evidence").is_some_and(Value::is_array) {
            return "invalid_tool_output_recommendation_evidence";
        }
    }
    "invalid_tool_output"
}

fn normalize_tool_arguments(tool: &str, value: &mut Value, chunks: &[&EvidenceChunk]) {
    if tool != "emit_recommendations" {
        return;
    }
    let Some(recommendations) = value
        .get_mut("recommendations")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for recommendation in recommendations {
        let Some(recommendation) = recommendation.as_object_mut() else {
            continue;
        };
        let recommendation_id = recommendation
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        for key in ["population", "trigger", "completion", "failure_policy"] {
            if let Some(item) = recommendation.get_mut(key).and_then(Value::as_object_mut) {
                normalize_evidence_array(item, &recommendation_id, chunks);
            }
        }
        for key in ["thresholds", "actions"] {
            if let Some(items) = recommendation.get_mut(key).and_then(Value::as_array_mut) {
                for item in items {
                    if let Some(item) = item.as_object_mut() {
                        normalize_evidence_array(item, &recommendation_id, chunks);
                    }
                }
            }
        }
        normalize_evidence_array(recommendation, &recommendation_id, chunks);
        if recommendation.get("evidence").is_some_and(Value::is_array) {
            continue;
        }
        let mut evidence = Vec::new();
        for key in ["population", "trigger", "completion", "failure_policy"] {
            if let Some(items) = recommendation
                .get(key)
                .and_then(|item| item.get("evidence"))
                .and_then(Value::as_array)
            {
                evidence.extend(items.iter().cloned());
            }
        }
        for key in ["thresholds", "actions"] {
            if let Some(items) = recommendation.get(key).and_then(Value::as_array) {
                for item in items {
                    if let Some(citations) = item.get("evidence").and_then(Value::as_array) {
                        evidence.extend(citations.iter().cloned());
                    }
                }
            }
        }
        let mut seen = BTreeSet::new();
        evidence.retain(|citation| seen.insert(citation.to_string()));
        recommendation.insert("evidence".into(), Value::Array(evidence));
    }
}

fn normalize_evidence_array(
    object: &mut serde_json::Map<String, Value>,
    recommendation_id: &str,
    chunks: &[&EvidenceChunk],
) {
    let Some(evidence) = object.get_mut("evidence") else {
        return;
    };
    if evidence.is_object() {
        let citation = evidence.take();
        *evidence = Value::Array(vec![citation]);
    }
    let Some(citations) = evidence.as_array_mut() else {
        return;
    };
    for citation in citations {
        let Some(citation) = citation.as_object_mut() else {
            continue;
        };
        let excerpt = citation
            .get("chunk_id")
            .and_then(Value::as_str)
            .and_then(|chunk_id| chunks.iter().find(|chunk| chunk.chunk_id == chunk_id))
            .map(|chunk| chunk.text.as_str())
            .unwrap_or_default();
        citation.insert("recommendation_id".into(), json!(recommendation_id));
        citation.insert("excerpt".into(), json!(excerpt));
    }
}

fn page_map(chunks: &[EvidenceChunk]) -> Vec<Value> {
    chunks
        .iter()
        .map(|chunk| {
            let preview: String = chunk.text.chars().take(240).collect();
            json!({
                "chunk_id":chunk.chunk_id,"page_start":chunk.page_start,"page_end":chunk.page_end,
                "section_path":chunk.section_path,"preview":preview
            })
        })
        .collect()
}

fn validate_plan(plan: &DelegationPlan, chunks: &[EvidenceChunk]) -> Result<(), &'static str> {
    if plan.tasks.is_empty() || plan.tasks.len() > MAX_SECTION_TASKS {
        return Err("task_limit");
    }
    let known: BTreeMap<_, _> = chunks
        .iter()
        .map(|chunk| (chunk.chunk_id.as_str(), chunk))
        .collect();
    let mut ids = BTreeSet::new();
    for (index, task) in plan.tasks.iter().enumerate() {
        if task.id.trim().is_empty()
            || !ids.insert(task.id.as_str())
            || task.heading.trim().is_empty()
            || task.page_start == 0
            || task.page_end < task.page_start
            || task.page_end - task.page_start + 1 > MAX_TASK_PAGE_SPAN
            || task.chunk_ids.is_empty()
            || task.chunk_ids.len() > MAX_CHUNKS_PER_TASK
        {
            return Err("invalid_delegation_plan");
        }
        if plan
            .tasks
            .iter()
            .take(index)
            .any(|other| task.page_start <= other.page_end && other.page_start <= task.page_end)
        {
            return Err("overlapping_section_tasks");
        }
        for id in &task.chunk_ids {
            let chunk = known.get(id.as_str()).ok_or("unknown_task_chunk")?;
            let start = chunk.page_start.ok_or("chunk_without_page")?;
            let end = chunk.page_end.unwrap_or(start);
            if start < task.page_start || end > task.page_end {
                return Err("chunk_outside_task_pages");
            }
        }
    }
    Ok(())
}

fn validate_emission(
    emission: &WorkerEmission,
    task_id: &str,
    version_id: &str,
    chunks: &[&EvidenceChunk],
) -> Result<(), &'static str> {
    if emission.task_id != task_id {
        return Err("worker_task_mismatch");
    }
    let chunks: BTreeMap<_, _> = chunks
        .iter()
        .map(|chunk| (chunk.chunk_id.as_str(), *chunk))
        .collect();
    let mut recommendation_ids = BTreeSet::new();
    for recommendation in &emission.recommendations {
        if recommendation.id.trim().is_empty()
            || !recommendation_ids.insert(recommendation.id.as_str())
        {
            return Err("duplicate_recommendation_id");
        }
        for evidence in recommendation_evidence(recommendation) {
            let chunk = chunks
                .get(evidence.chunk_id.as_str())
                .ok_or("evidence_out_of_scope")?;
            if chunk.version_id != version_id
                || evidence.recommendation_id != recommendation.id
                || evidence.excerpt.trim().is_empty()
                || !chunk.text.contains(&evidence.excerpt)
            {
                return Err("evidence_out_of_scope");
            }
        }
    }
    Ok(())
}

fn recommendation_evidence(recommendation: &Recommendation) -> Vec<&super::EvidenceRef> {
    let mut all = Vec::new();
    all.extend(recommendation.evidence.iter());
    all.extend(recommendation.population.evidence.iter());
    all.extend(recommendation.trigger.evidence.iter());
    all.extend(
        recommendation
            .thresholds
            .iter()
            .flat_map(|item| item.evidence.iter()),
    );
    all.extend(
        recommendation
            .actions
            .iter()
            .flat_map(|item| item.evidence.iter()),
    );
    if let Some(completion) = &recommendation.completion {
        all.extend(completion.evidence.iter());
    }
    if let Some(policy) = &recommendation.failure_policy {
        all.extend(policy.evidence.iter());
    }
    all
}

fn validate_reconciliation(
    reconciliation: &Reconciliation,
    emitted: &BTreeMap<String, Vec<Recommendation>>,
) -> Result<(), &'static str> {
    if reconciliation.title.trim().is_empty() || reconciliation.selections.is_empty() {
        return Err("invalid_reconciliation");
    }
    let mut selected = BTreeSet::new();
    for selection in &reconciliation.selections {
        if !selected.insert((
            selection.task_id.as_str(),
            selection.recommendation_id.as_str(),
        )) {
            return Err("duplicate_recommendation_selection");
        }
        let known = emitted.get(&selection.task_id).is_some_and(|items| {
            items
                .iter()
                .any(|item| item.id == selection.recommendation_id)
        });
        if !known {
            return Err("unknown_recommendation_selection");
        }
    }
    Ok(())
}

fn delegation_schema() -> Value {
    serde_json::to_value(schemars::schema_for!(DelegationPlan)).expect("static delegation schema")
}
fn worker_schema(catalogue: &CatalogueSnapshot, chunks: &[&EvidenceChunk]) -> Value {
    let mut schema =
        serde_json::to_value(schemars::schema_for!(WorkerEmission)).expect("static worker schema");
    for definition in ["TriggerSpec", "Action"] {
        distribute_variant_requirements(&mut schema, definition);
    }
    configure_evidence_contract(&mut schema, chunks);
    for (property, components, field) in [
        (
            "anchor",
            &["trigger.due", "trigger.recurring"][..],
            "anchor",
        ),
        ("document_kind", &["trigger.document"][..], "document_kind"),
        ("what", &["outreach.request"][..], "what"),
        ("source", &["care_path.record"][..], "source"),
        ("recipient", &["escalate.notify"][..], "to"),
        ("urgency", &["escalate.notify"][..], "urgency"),
    ] {
        let options = catalogue_select_options(catalogue, components, field);
        constrain_schema_property(&mut schema, property, &options);
    }
    schema
}

fn configure_evidence_contract(schema: &mut Value, chunks: &[&EvidenceChunk]) {
    let Some(evidence) = schema
        .get_mut("$defs")
        .and_then(Value::as_object_mut)
        .and_then(|definitions| definitions.get_mut("EvidenceRef"))
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    if let Some(properties) = evidence
        .get_mut("properties")
        .and_then(Value::as_object_mut)
    {
        properties.remove("excerpt");
        properties.remove("recommendation_id");
        if let Some(chunk_id) = properties
            .get_mut("chunk_id")
            .and_then(Value::as_object_mut)
        {
            chunk_id.insert(
                "enum".into(),
                Value::Array(chunks.iter().map(|chunk| json!(chunk.chunk_id)).collect()),
            );
        }
    }
    if let Some(required) = evidence.get_mut("required").and_then(Value::as_array_mut) {
        required.retain(|field| field != "excerpt" && field != "recommendation_id");
    }
}

fn catalogue_select_options(
    catalogue: &CatalogueSnapshot,
    components: &[&str],
    field: &str,
) -> Vec<Value> {
    let mut options = BTreeSet::new();
    for node in &catalogue.nodes {
        if !components.contains(&node.id.as_str()) {
            continue;
        }
        if let Some(definition) = node.fields.iter().find(|candidate| candidate.key == field) {
            options.extend(
                definition
                    .options
                    .iter()
                    .filter_map(|option| option.get("id").and_then(Value::as_str))
                    .map(str::to_owned),
            );
        }
    }
    options.into_iter().map(Value::String).collect()
}

fn constrain_schema_property(schema: &mut Value, property: &str, options: &[Value]) {
    if options.is_empty() {
        return;
    }
    match schema {
        Value::Object(object) => {
            if let Some(definition) = object
                .get_mut("properties")
                .and_then(Value::as_object_mut)
                .and_then(|properties| properties.get_mut(property))
                .and_then(Value::as_object_mut)
            {
                definition.insert("enum".into(), Value::Array(options.to_vec()));
            }
            for child in object.values_mut() {
                constrain_schema_property(child, property, options);
            }
        }
        Value::Array(items) => {
            for item in items {
                constrain_schema_property(item, property, options);
            }
        }
        _ => {}
    }
}

fn distribute_variant_requirements(schema: &mut Value, definition: &str) {
    let Some(definition) = schema
        .get_mut("$defs")
        .and_then(Value::as_object_mut)
        .and_then(|definitions| definitions.get_mut(definition))
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    if !definition.get("oneOf").is_some_and(Value::is_array) {
        return;
    }
    let Some(properties) = definition
        .remove("properties")
        .and_then(|value| value.as_object().cloned())
    else {
        return;
    };
    let required = definition
        .remove("required")
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let variants = definition
        .get_mut("oneOf")
        .and_then(Value::as_array_mut)
        .expect("checked oneOf array");
    for variant in variants {
        let Some(variant) = variant.as_object_mut() else {
            continue;
        };
        let variant_properties = variant
            .entry("properties")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .expect("generated object variant properties");
        for (key, value) in &properties {
            variant_properties
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
        let variant_required = variant
            .entry("required")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .expect("generated object variant requirements");
        for field in &required {
            if !variant_required.contains(field) {
                variant_required.push(field.clone());
            }
        }
    }
}
fn reconciliation_schema() -> Value {
    serde_json::to_value(schemars::schema_for!(Reconciliation))
        .expect("static reconciliation schema")
}
fn finish_schema() -> Value {
    serde_json::to_value(schemars::schema_for!(FinishCompilation)).expect("static finish schema")
}
