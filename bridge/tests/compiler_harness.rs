use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use async_trait::async_trait;
use rustvani::vokoo::compiler::{
    Action, ActionOperation, AisdkCompilerModel, CapabilityResolutionSnapshot, CatalogueField,
    CatalogueNode, CatalogueOutcome, CatalogueSnapshot, CompilerError, CompilerHarness,
    CompilerInput, CompilerModel, EvidenceRef, EvidenceRole, FailurePolicy, ModelRequest,
    ModelResponse, Population, Recommendation, RequestActor, TokenUsage, TraceEvent, TraceSink,
    TriggerOperation, TriggerSpec, WorkspaceResources,
};
use rustvani::vokoo::documents::{DocumentEvidence, EvidenceChunk};
use serde_json::{json, Value};

struct ScriptedModel {
    replies: Mutex<VecDeque<Value>>,
    requests: Mutex<Vec<ModelRequest>>,
}

impl ScriptedModel {
    fn new(replies: Vec<Value>) -> Self {
        Self {
            replies: Mutex::new(replies.into()),
            requests: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl CompilerModel for ScriptedModel {
    async fn call(&self, request: ModelRequest) -> Result<ModelResponse, CompilerError> {
        self.requests.lock().unwrap().push(request.clone());
        let arguments = self
            .replies
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| CompilerError::model("script_exhausted"))?;
        Ok(ModelResponse {
            tool_name: request.tool_name,
            arguments,
            usage: TokenUsage {
                input_tokens: Some(10),
                output_tokens: Some(5),
            },
        })
    }
}

struct MissingWorkerToolOnce {
    inner: ScriptedModel,
    missed: AtomicBool,
}

#[async_trait]
impl CompilerModel for MissingWorkerToolOnce {
    async fn call(&self, request: ModelRequest) -> Result<ModelResponse, CompilerError> {
        if request.tool_name == "emit_recommendations" && !self.missed.swap(true, Ordering::SeqCst)
        {
            return Err(CompilerError::model("required_tool_not_called"));
        }
        self.inner.call(request).await
    }
}

#[derive(Default)]
struct RecordingTrace(Mutex<Vec<TraceEvent>>);

impl TraceSink for RecordingTrace {
    fn emit(&self, event: TraceEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[tokio::test]
async fn runs_bounded_non_overlapping_workers_and_emits_source_safe_trace() {
    let first = recommendation("hba1c-monitoring", "chunk-1");
    let second = recommendation("annual-review", "chunk-2");
    let model = ScriptedModel::new(vec![
        json!({
            "tasks": [
                {"id":"task-1","heading":"HbA1c monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]},
                {"id":"task-2","heading":"Annual review","page_start":3,"page_end":4,"chunk_ids":["chunk-2"]}
            ],
            "excluded_sections": []
        }),
        json!({"task_id":"task-1","recommendations":[first]}),
        json!({"task_id":"task-2","recommendations":[second]}),
        json!({
            "title":"Type 2 diabetes care path",
            "selections":[
                {"task_id":"task-1","recommendation_id":"hba1c-monitoring"},
                {"task_id":"task-2","recommendation_id":"annual-review"}
            ]
        }),
        json!({"accepted_recommendations":2,"gap_count":0}),
    ]);
    let trace = RecordingTrace::default();
    let harness = CompilerHarness::new(&model, &trace);

    let output = harness.compile(input()).await.unwrap();

    assert_eq!(output.flows.len(), 2);
    let requests = model.requests.lock().unwrap();
    assert_eq!(requests.len(), 5);
    assert_eq!(requests[0].tool_name, "delegate_section");
    assert!(requests[0]
        .tool_description
        .contains("maximize longitudinal care-path coverage"));
    assert_eq!(requests[0].schema["properties"]["tasks"]["minItems"], 1);
    assert_eq!(requests[0].schema["properties"]["tasks"]["maxItems"], 4);
    assert_eq!(
        requests[0].schema["$defs"]["SectionTask"]["properties"]["chunk_ids"]["minItems"],
        1
    );
    assert_eq!(
        requests[0].schema["$defs"]["SectionTask"]["properties"]["chunk_ids"]["maxItems"],
        20
    );
    assert_eq!(
        requests[0].payload["page_map"][0]["preview"],
        "Review HbA1c every 90 days"
    );
    assert_eq!(requests[1].tool_name, "emit_recommendations");
    assert!(requests[1]
        .tool_description
        .contains("Trigger is flattened"));
    assert!(requests[1]
        .tool_description
        .contains("Evidence entries contain only chunk_id and role"));
    for definition in ["TriggerSpec", "Action"] {
        let variants = requests[1].schema["$defs"][definition]["oneOf"]
            .as_array()
            .unwrap();
        assert!(variants.iter().all(|variant| {
            let required = variant["required"].as_array().unwrap();
            required.iter().any(|field| field == "key")
                && required.iter().any(|field| field == "evidence")
                && variant["properties"].get("evidence").is_some()
        }));
    }
    for (property, expected) in [
        ("anchor", "enrolment"),
        ("document_kind", "lab_report"),
        ("what", "test"),
        ("source", "patient"),
        ("recipient", "primary_team"),
        ("urgency", "soon"),
    ] {
        let mut enums = Vec::new();
        collect_property_enums(&requests[1].schema, property, &mut enums);
        assert!(
            enums
                .iter()
                .any(|values| values.iter().any(|value| value == expected)),
            "worker schema must constrain {property} to frozen catalogue options"
        );
    }
    assert!(requests[1].schema["$defs"]["RequestActor"]["enum"]
        .as_array()
        .is_some_and(|values| values.iter().any(|value| value == "patient")
            && values.iter().any(|value| value == "clinician")
            && values.iter().any(|value| value == "care_team")
            && values.iter().any(|value| value == "system")));
    assert_eq!(requests[3].tool_name, "emit_reconciliation");
    assert_eq!(requests[4].tool_name, "finish_compilation");
    assert!(requests.iter().all(|request| request.correction.is_none()));

    let events = trace.0.lock().unwrap();
    assert_eq!(events.len(), 5);
    assert!(events.iter().all(|event| event.status == "accepted"));
    let encoded = serde_json::to_string(&*events).unwrap();
    assert!(!encoded.contains("Review HbA1c every 90 days"));
    assert!(!encoded.contains("Type 2 diabetes care path"));
    assert!(!encoded.contains("HbA1c monitoring"));
}

fn collect_property_enums<'a>(value: &'a Value, property: &str, output: &mut Vec<&'a Vec<Value>>) {
    match value {
        Value::Object(object) => {
            if let Some(values) = object
                .get("properties")
                .and_then(|properties| properties.get(property))
                .and_then(|property| property.get("enum"))
                .and_then(Value::as_array)
            {
                output.push(values);
            }
            for child in object.values() {
                collect_property_enums(child, property, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_property_enums(item, property, output);
            }
        }
        _ => {}
    }
}

#[tokio::test]
async fn normalizes_existing_citations_without_inventing_evidence() {
    let mut item = serde_json::to_value(recommendation("hba1c-monitoring", "chunk-1")).unwrap();
    strip_citation_payload_fields(&mut item);
    item.as_object_mut().unwrap().remove("evidence");
    let trigger_citation = item["trigger"]["evidence"][0].take();
    item["trigger"]["evidence"] = trigger_citation;
    let model = ScriptedModel::new(vec![
        json!({
            "tasks": [{"id":"task-1","heading":"HbA1c monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]}],
            "excluded_sections": []
        }),
        json!({"task_id":"task-1","recommendations":[item]}),
        json!({
            "title":"Type 2 diabetes care path",
            "selections":[{"task_id":"task-1","recommendation_id":"hba1c-monitoring"}]
        }),
        json!({"accepted_recommendations":1,"gap_count":0}),
    ]);
    let trace = RecordingTrace::default();

    let output = CompilerHarness::new(&model, &trace)
        .compile(input())
        .await
        .unwrap();

    assert_eq!(output.flows.len(), 1);
    assert!(output.evidence.iter().all(|citation| {
        citation.recommendation_id == "hba1c-monitoring"
            && citation.excerpt == "Review HbA1c every 90 days"
    }));
    let requests = model.requests.lock().unwrap();
    let citation_schema = &requests[1].schema["$defs"]["EvidenceRef"];
    let required = citation_schema["required"].as_array().unwrap();
    assert!(!required.iter().any(|field| field == "excerpt"));
    assert!(!required.iter().any(|field| field == "recommendation_id"));
    assert_eq!(
        citation_schema["properties"]["chunk_id"]["enum"],
        json!(["chunk-1"])
    );
    assert!(trace
        .0
        .lock()
        .unwrap()
        .iter()
        .all(|event| event.status == "accepted"));
}

fn strip_citation_payload_fields(value: &mut Value) {
    match value {
        Value::Object(object) => {
            if object.contains_key("chunk_id") && object.contains_key("role") {
                object.remove("excerpt");
                object.remove("recommendation_id");
            }
            for child in object.values_mut() {
                strip_citation_payload_fields(child);
            }
        }
        Value::Array(items) => {
            for item in items {
                strip_citation_payload_fields(item);
            }
        }
        _ => {}
    }
}

#[tokio::test]
async fn missing_trigger_citations_remain_a_hard_failure() {
    let mut item = serde_json::to_value(recommendation("hba1c-monitoring", "chunk-1")).unwrap();
    item["trigger"].as_object_mut().unwrap().remove("evidence");
    let emission = json!({"task_id":"task-1","recommendations":[item]});
    let model = ScriptedModel::new(vec![
        json!({
            "tasks": [{"id":"task-1","heading":"HbA1c monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]}],
            "excluded_sections": []
        }),
        emission.clone(),
        emission.clone(),
        emission,
    ]);
    let trace = RecordingTrace::default();

    let error = CompilerHarness::new(&model, &trace)
        .compile(input())
        .await
        .unwrap_err();

    assert_eq!(error.code(), "invalid_tool_output_trigger_evidence");
}

#[tokio::test]
async fn retries_a_missing_required_worker_tool_within_the_same_bound() {
    let model = MissingWorkerToolOnce {
        inner: ScriptedModel::new(vec![
            json!({
                "tasks": [{"id":"task-1","heading":"HbA1c monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]}],
                "excluded_sections": []
            }),
            json!({"task_id":"task-1","recommendations":[recommendation("hba1c-monitoring", "chunk-1")]}),
            json!({
                "title":"Type 2 diabetes care path",
                "selections":[{"task_id":"task-1","recommendation_id":"hba1c-monitoring"}]
            }),
            json!({"accepted_recommendations":1,"gap_count":0}),
        ]),
        missed: AtomicBool::new(false),
    };
    let trace = RecordingTrace::default();

    let output = CompilerHarness::new(&model, &trace)
        .compile(input())
        .await
        .unwrap();

    assert_eq!(output.flows.len(), 1);
    let events = trace.0.lock().unwrap();
    assert_eq!(
        events[1].error_code.as_deref(),
        Some("required_tool_not_called")
    );
    assert_eq!(events[2].status, "accepted");
}

#[tokio::test]
async fn rejects_out_of_scope_evidence_after_bounded_worker_corrections() {
    let model = ScriptedModel::new(vec![
        json!({"tasks":"not-an-array"}),
        json!({
            "tasks":[{"id":"task-1","heading":"Monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]}],
            "excluded_sections":[]
        }),
        json!({"task_id":"task-1","recommendations":[recommendation("bad", "chunk-2")]}),
        json!({"task_id":"task-1","recommendations":[recommendation("still-bad", "chunk-2")]}),
        json!({"task_id":"task-1","recommendations":[recommendation("final-bad", "chunk-2")]}),
    ]);
    let trace = RecordingTrace::default();
    let harness = CompilerHarness::new(&model, &trace);

    let error = harness.compile(input()).await.unwrap_err();

    assert_eq!(error.code(), "evidence_out_of_scope");
    let requests = model.requests.lock().unwrap();
    assert_eq!(requests.len(), 5);
    assert!(requests[0].correction.is_none());
    assert_eq!(
        requests[1].correction.as_deref(),
        Some("invalid_tool_output")
    );
    assert!(requests[2].correction.is_none());
    assert_eq!(
        requests[3].correction.as_deref(),
        Some("evidence_out_of_scope")
    );
}

#[tokio::test]
async fn reports_source_safe_shape_code_for_nested_trigger_operation() {
    let nested = json!({
        "task_id":"task-1",
        "recommendations":[{
            "id":"monitoring",
            "title":"Monitoring",
            "population":{"description":"Adults","inclusions":[],"exclusions":[],"evidence":[]},
            "trigger":{"key":"due","operation":{"kind":"due","anchor":"start","offset_days":0,"window_days":7},"evidence":[]},
            "thresholds":[],
            "actions":[],
            "completion":null,
            "failure_policy":null,
            "evidence":[]
        }]
    });
    let model = ScriptedModel::new(vec![
        json!({
            "tasks":[{"id":"task-1","heading":"Monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]}],
            "excluded_sections":[]
        }),
        nested.clone(),
        nested.clone(),
        nested,
    ]);
    let trace = RecordingTrace::default();

    let error = CompilerHarness::new(&model, &trace)
        .compile(input())
        .await
        .unwrap_err();

    assert_eq!(error.code(), "invalid_tool_output_trigger_operation_nested");
    assert_eq!(
        model.requests.lock().unwrap()[2].correction.as_deref(),
        Some("invalid_tool_output_trigger_operation_nested")
    );
}

#[tokio::test]
async fn reports_source_safe_shape_code_for_missing_request_actor() {
    let mut item = serde_json::to_value(recommendation("monitoring", "chunk-1")).unwrap();
    item["actions"][0].as_object_mut().unwrap().remove("actor");
    let emission = json!({"task_id":"task-1","recommendations":[item]});
    let model = ScriptedModel::new(vec![
        json!({
            "tasks":[{"id":"task-1","heading":"Monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]}],
            "excluded_sections":[]
        }),
        emission.clone(),
        emission.clone(),
        emission,
    ]);
    let trace = RecordingTrace::default();

    let error = CompilerHarness::new(&model, &trace)
        .compile(input())
        .await
        .unwrap_err();

    assert_eq!(error.code(), "invalid_tool_output_request_actor");
}

#[tokio::test]
async fn reconciliation_can_only_select_worker_recommendations() {
    let model = ScriptedModel::new(vec![
        json!({
            "tasks":[{"id":"task-1","heading":"Monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]}],
            "excluded_sections":[]
        }),
        json!({"task_id":"task-1","recommendations":[recommendation("known", "chunk-1")]}),
        json!({"title":"Care path","selections":[{"task_id":"task-1","recommendation_id":"invented"}]}),
        json!({"title":"Care path","selections":[{"task_id":"task-1","recommendation_id":"invented-again"}]}),
    ]);
    let trace = RecordingTrace::default();
    let harness = CompilerHarness::new(&model, &trace);

    let error = harness.compile(input()).await.unwrap_err();

    assert_eq!(error.code(), "unknown_recommendation_selection");
    let requests = model.requests.lock().unwrap();
    assert_eq!(
        requests[3].correction.as_deref(),
        Some("unknown_recommendation_selection")
    );
}

#[tokio::test]
async fn rejects_overlapping_supervisor_tasks_after_two_corrections() {
    let overlapping = json!({
        "tasks":[
            {"id":"one","heading":"One","page_start":1,"page_end":3,"chunk_ids":["chunk-1"]},
            {"id":"two","heading":"Two","page_start":2,"page_end":4,"chunk_ids":["chunk-2"]}
        ],
        "excluded_sections":[]
    });
    let model = ScriptedModel::new(vec![overlapping.clone(), overlapping.clone(), overlapping]);
    let trace = RecordingTrace::default();

    let error = CompilerHarness::new(&model, &trace)
        .compile(input())
        .await
        .unwrap_err();

    assert_eq!(error.code(), "overlapping_section_tasks");
    assert_eq!(model.requests.lock().unwrap().len(), 3);
}

#[test]
fn constructs_only_supported_operator_resolved_providers() {
    assert!(AisdkCompilerModel::new("anthropic", "claude", "resolved").is_ok());
    assert!(AisdkCompilerModel::new("minimax", "MiniMax-M2.1", "resolved").is_ok());
    assert!(AisdkCompilerModel::new("openai", "gpt-5", "resolved").is_ok());
    assert!(AisdkCompilerModel::new("browser", "model", "secret").is_err());
    assert!(AisdkCompilerModel::new("minimax", "", "resolved").is_err());
    assert!(AisdkCompilerModel::new("minimax", "model", "").is_err());
}

#[tokio::test]
async fn rejects_an_invalid_frozen_resolution_before_model_work() {
    let model = ScriptedModel::new(vec![]);
    let trace = RecordingTrace::default();
    let mut compiler_input = input();
    compiler_input.resolutions = vec![CapabilityResolutionSnapshot {
        id: "00000000-0000-4000-8000-000000000001".into(),
        recommendation_id: "hba1c-monitoring".into(),
        capability_key: "clinical.task".into(),
        adapter_key: "clinical-task-escalate-notify-v1".into(),
        adapter_version: "99".into(),
        node_type_id: "escalate.notify".into(),
        mapping: json!({"to":"clinician","urgency":"soon"}),
    }];

    let error = CompilerHarness::new(&model, &trace)
        .compile(compiler_input)
        .await
        .unwrap_err();

    assert_eq!(error.code(), "invalid_capability_resolution");
    assert!(model.requests.lock().unwrap().is_empty());
}

fn input() -> CompilerInput {
    CompilerInput {
        run_id: "run-1".into(),
        version_id: "version-1".into(),
        evidence: DocumentEvidence {
            outline: vec!["Monitoring".into(), "Annual review".into()],
            representative_chunks: vec![
                EvidenceChunk {
                    chunk_id: "chunk-1".into(),
                    version_id: "version-1".into(),
                    page_start: Some(1),
                    page_end: Some(2),
                    section_path: vec!["Monitoring".into()],
                    text: "Review HbA1c every 90 days".into(),
                },
                EvidenceChunk {
                    chunk_id: "chunk-2".into(),
                    version_id: "version-1".into(),
                    page_start: Some(3),
                    page_end: Some(4),
                    section_path: vec!["Annual review".into()],
                    text: "Review HbA1c every 90 days".into(),
                },
            ],
            compiler_matches: vec!["care_path".into()],
        },
        catalogue: catalogue(),
        resources: WorkspaceResources::default(),
        resolutions: vec![],
    }
}

fn evidence(recommendation_id: &str, chunk_id: &str) -> Vec<EvidenceRef> {
    vec![EvidenceRef {
        chunk_id: chunk_id.into(),
        recommendation_id: recommendation_id.into(),
        excerpt: "Review HbA1c every 90 days".into(),
        role: EvidenceRole::Timing,
    }]
}

fn recommendation(id: &str, chunk_id: &str) -> Recommendation {
    let evidence = evidence(id, chunk_id);
    Recommendation {
        id: id.into(),
        title: "HbA1c monitoring".into(),
        population: Population {
            description: "Adults with type 2 diabetes".into(),
            inclusions: vec![],
            exclusions: vec![],
            evidence: evidence.clone(),
        },
        trigger: TriggerSpec {
            key: "hba1c-due".into(),
            operation: TriggerOperation::Recurring {
                anchor: "enrolment".into(),
                every_days: 90,
            },
            evidence: evidence.clone(),
        },
        thresholds: vec![],
        actions: vec![Action {
            key: "request-hba1c".into(),
            operation: ActionOperation::Request {
                actor: RequestActor::Patient,
                what: "test".into(),
                instructions: "Ask the patient to arrange a review".into(),
                expires_days: 14,
            },
            evidence: evidence.clone(),
        }],
        completion: None,
        failure_policy: Some(FailurePolicy {
            recipient: "primary_team".into(),
            urgency: "routine".into(),
            note: "Follow up manually".into(),
            evidence: evidence.clone(),
        }),
        evidence,
    }
}

fn catalogue() -> CatalogueSnapshot {
    let field = |key: &str, options: &[&str]| CatalogueField {
        key: key.into(),
        field_type: "select".into(),
        required: true,
        default: None,
        options: options.iter().map(|id| json!({"id": id})).collect(),
    };
    let node = |id: &str, outcomes: &[&str], fields: Vec<CatalogueField>| CatalogueNode {
        id: id.into(),
        node_type: id.into(),
        families: vec!["care_path".into()],
        outcomes: outcomes
            .iter()
            .map(|id| CatalogueOutcome { id: (*id).into() })
            .collect(),
        fields,
        outcomes_from: None,
        output: String::new(),
        suspends: false,
        is_active: true,
    };
    CatalogueSnapshot {
        digest: "catalogue-1".into(),
        nodes: vec![
            node(
                "trigger.recurring",
                &["due"],
                vec![field(
                    "anchor",
                    &[
                        "enrolment",
                        "birth",
                        "transfer_of_care",
                        "discharge",
                        "treatment_start",
                    ],
                )],
            ),
            node(
                "trigger.document",
                &["received"],
                vec![field(
                    "document_kind",
                    &[
                        "lab_report",
                        "imaging_report",
                        "discharge_summary",
                        "referral",
                        "other",
                    ],
                )],
            ),
            node(
                "outreach.request",
                &["fulfilled", "declined", "expired", "failed"],
                vec![field(
                    "what",
                    &[
                        "attendance",
                        "lab_report",
                        "imaging_report",
                        "test",
                        "medication_review",
                        "other",
                    ],
                )],
            ),
            node(
                "care_path.record",
                &["recorded", "failed"],
                vec![field(
                    "source",
                    &["patient", "practitioner", "document", "workflow"],
                )],
            ),
            node(
                "escalate.notify",
                &["notified", "failed"],
                vec![
                    field(
                        "to",
                        &["primary_team", "on_call", "clinician", "coordinator"],
                    ),
                    field("urgency", &["routine", "soon", "urgent", "immediate"]),
                ],
            ),
        ],
    }
}
