use std::collections::{HashMap, HashSet, VecDeque};

use serde_json::Value;

use super::types::*;

pub fn validate_output(
    output: &CompilationOutput,
    catalogue: &CatalogueSnapshot,
    input: &CarePathProgram,
) -> Result<(), Vec<ValidationError>> {
    let available = catalogue
        .nodes
        .iter()
        .filter(|node| node.is_active && node.families.iter().any(|family| family == "care_path"))
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let generated_agents = output
        .agents
        .iter()
        .map(|agent| agent.key.as_str())
        .collect::<HashSet<_>>();
    let source_evidence = collect_source_evidence(input);
    let mut errors = Vec::new();

    validate_input(input, &mut errors);
    validate_artifact_keys(output, &mut errors);

    for link in &output.evidence {
        if link.artifact_key.trim().is_empty()
            || link.target_path.trim().is_empty()
            || link.chunk_id.trim().is_empty()
            || link.excerpt.trim().is_empty()
        {
            push_error(
                &mut errors,
                "invalid_evidence_link",
                "An evidence link has an empty identity, target, chunk, or excerpt.",
                Some(&link.artifact_key),
                Some(&link.target_path),
            );
        } else if !source_evidence.contains(&(
            link.chunk_id.clone(),
            link.recommendation_id.clone(),
            link.excerpt.clone(),
            link.role.clone(),
        )) {
            push_error(
                &mut errors,
                "ungrounded_evidence",
                "Generated evidence was not present in the source-bound program.",
                Some(&link.artifact_key),
                Some(&link.target_path),
            );
        }
    }

    for agent in &output.agents {
        if agent.key.trim().is_empty()
            || agent.name.trim().is_empty()
            || agent.system_prompt.trim().is_empty()
        {
            push_error(
                &mut errors,
                "invalid_agent",
                "Generated agents need a stable key, name, and system prompt.",
                Some(&agent.key),
                None,
            );
        }
        require_evidence_target(output, &agent.key, "agent.system_prompt", &mut errors);
    }

    for flow in &output.flows {
        validate_flow(flow, output, &available, &generated_agents, &mut errors);
    }
    for gap in &output.gaps {
        if gap.code.trim().is_empty()
            || gap.recommendation_id.trim().is_empty()
            || gap.explanation.trim().is_empty()
            || gap.evidence.is_empty()
        {
            push_error(
                &mut errors,
                "invalid_gap",
                "Compiler gaps must be explained and source-bound.",
                None,
                None,
            );
        }
        for evidence in &gap.evidence {
            if !source_evidence.contains(&(
                evidence.chunk_id.clone(),
                evidence.recommendation_id.clone(),
                evidence.excerpt.clone(),
                evidence.role.clone(),
            )) {
                push_error(
                    &mut errors,
                    "ungrounded_gap",
                    "A compiler gap cites evidence outside the source-bound program.",
                    None,
                    None,
                );
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn validate_input(input: &CarePathProgram, errors: &mut Vec<ValidationError>) {
    let mut ids = HashSet::new();
    for recommendation in &input.recommendations {
        if recommendation.id.trim().is_empty() || !ids.insert(recommendation.id.as_str()) {
            push_error(
                errors,
                "invalid_recommendation_id",
                "Recommendation identifiers must be nonempty and unique.",
                None,
                None,
            );
        }
        if recommendation.evidence.is_empty()
            || recommendation.population.evidence.is_empty()
            || recommendation.trigger.evidence.is_empty()
        {
            push_error(
                errors,
                "uncited_recommendation",
                "Recommendation, population, and trigger claims all need evidence.",
                None,
                None,
            );
        }
        let mismatched_evidence = recommendation
            .evidence
            .iter()
            .chain(recommendation.population.evidence.iter())
            .chain(recommendation.trigger.evidence.iter())
            .chain(
                recommendation
                    .actions
                    .iter()
                    .flat_map(|action| action.evidence.iter()),
            )
            .chain(
                recommendation
                    .thresholds
                    .iter()
                    .flat_map(|threshold| threshold.evidence.iter()),
            )
            .chain(
                recommendation
                    .completion
                    .iter()
                    .flat_map(|completion| completion.evidence.iter()),
            )
            .chain(
                recommendation
                    .failure_policy
                    .iter()
                    .flat_map(|policy| policy.evidence.iter()),
            )
            .any(|evidence| evidence.recommendation_id != recommendation.id);
        if mismatched_evidence {
            push_error(
                errors,
                "mismatched_evidence_recommendation",
                "Evidence must identify the recommendation that owns it.",
                None,
                None,
            );
        }
        for action in &recommendation.actions {
            if action.key.trim().is_empty() || action.evidence.is_empty() {
                push_error(
                    errors,
                    "uncited_action",
                    "Every action needs a stable key and source evidence.",
                    None,
                    None,
                );
            }
        }
        for threshold in &recommendation.thresholds {
            if threshold.observation.trim().is_empty()
                || threshold.operator.trim().is_empty()
                || threshold.unit.trim().is_empty()
                || threshold.evidence.is_empty()
            {
                push_error(
                    errors,
                    "invalid_threshold",
                    "Thresholds must retain observation, operator, unit, and evidence.",
                    None,
                    None,
                );
            }
        }
    }
}

fn validate_artifact_keys(output: &CompilationOutput, errors: &mut Vec<ValidationError>) {
    let mut keys = HashSet::new();
    for key in output
        .agents
        .iter()
        .map(|agent| agent.key.as_str())
        .chain(output.flows.iter().map(|flow| flow.key.as_str()))
    {
        if key.trim().is_empty() || !keys.insert(key) {
            push_error(
                errors,
                "duplicate_artifact_key",
                "Generated artifact keys must be nonempty and unique.",
                Some(key),
                None,
            );
        }
    }
}

fn validate_flow(
    flow: &FlowDraft,
    output: &CompilationOutput,
    available: &HashMap<&str, &CatalogueNode>,
    generated_agents: &HashSet<&str>,
    errors: &mut Vec<ValidationError>,
) {
    if flow.key.trim().is_empty() || flow.name.trim().is_empty() || flow.graph.version != 3 {
        push_error(
            errors,
            "invalid_flow",
            "Generated flows need a stable key, name, and graph version 3.",
            Some(&flow.key),
            None,
        );
    }
    let mut nodes = HashMap::new();
    for node in &flow.graph.nodes {
        if node.id.trim().is_empty() || nodes.insert(node.id.as_str(), node).is_some() {
            push_error(
                errors,
                "duplicate_node_id",
                "Flow node identifiers must be nonempty and unique.",
                Some(&flow.key),
                Some(&format!("flow.nodes.{}", node.id)),
            );
        }
        let Some(definition) = available.get(node.implementation.as_str()) else {
            push_error(
                errors,
                "unknown_component",
                &format!(
                    "{} is outside the active care-path catalogue.",
                    node.implementation
                ),
                Some(&flow.key),
                Some(&format!("flow.nodes.{}", node.id)),
            );
            continue;
        };
        if node.node_type != definition.node_type {
            push_error(
                errors,
                "wrong_node_type",
                "The node primitive does not match its catalogue component.",
                Some(&flow.key),
                Some(&format!("flow.nodes.{}", node.id)),
            );
        }
        validate_config(flow, node, definition, errors);
        if node.implementation == "agent"
            && node
                .agent_key
                .as_deref()
                .is_none_or(|key| !generated_agents.contains(key))
        {
            push_error(
                errors,
                "unknown_agent_key",
                "An agent node must reference an agent generated in this output.",
                Some(&flow.key),
                Some(&format!("flow.nodes.{}", node.id)),
            );
        }
        require_evidence_target(
            output,
            &flow.key,
            &format!("flow.nodes.{}", node.id),
            errors,
        );
    }

    let mut routes = HashMap::<(&str, &str), &str>::new();
    for transition in &flow.graph.transitions {
        let Some(source) = nodes.get(transition.from.as_str()) else {
            push_error(
                errors,
                "missing_transition_source",
                "A transition source does not exist.",
                Some(&flow.key),
                None,
            );
            continue;
        };
        if !nodes.contains_key(transition.to.as_str()) {
            push_error(
                errors,
                "missing_transition_target",
                "A transition target does not exist.",
                Some(&flow.key),
                None,
            );
        }
        if routes
            .insert(
                (transition.from.as_str(), transition.outcome.as_str()),
                transition.to.as_str(),
            )
            .is_some()
        {
            push_error(
                errors,
                "duplicate_outcome_route",
                "A source outcome has more than one destination.",
                Some(&flow.key),
                None,
            );
        }
        if let Some(definition) = available.get(source.implementation.as_str()) {
            let outcomes = node_outcomes(source, definition);
            if !outcomes.contains(transition.outcome.as_str()) {
                push_error(
                    errors,
                    "invalid_transition_outcome",
                    "A transition names an outcome its source does not expose.",
                    Some(&flow.key),
                    None,
                );
            }
        }
    }

    let triggers = flow
        .graph
        .nodes
        .iter()
        .filter(|node| node.implementation.starts_with("trigger."))
        .map(|node| node.id.as_str())
        .collect::<Vec<_>>();
    if triggers.is_empty() {
        push_error(
            errors,
            "missing_trigger",
            "A compiled care path needs at least one trigger.",
            Some(&flow.key),
            None,
        );
        return;
    }
    let reachable = reachable_from(&triggers, &routes);
    for node in &flow.graph.nodes {
        if !reachable.contains(node.id.as_str()) {
            push_error(
                errors,
                "unreachable_node",
                "A generated node is unreachable from every trigger.",
                Some(&flow.key),
                Some(&format!("flow.nodes.{}", node.id)),
            );
        }
    }
    for trigger in triggers {
        let trigger_reachable = reachable_from(&[trigger], &routes);
        let has_terminal = flow.graph.nodes.iter().any(|node| {
            trigger_reachable.contains(node.id.as_str())
                && available
                    .get(node.implementation.as_str())
                    .is_some_and(|definition| {
                        node_outcomes(node, definition).iter().any(|outcome| {
                            !routes.contains_key(&(node.id.as_str(), outcome.as_str()))
                        })
                    })
        });
        if !has_terminal {
            push_error(
                errors,
                "closed_graph",
                "A trigger cannot reach a terminal outcome.",
                Some(&flow.key),
                None,
            );
        }
    }
    validate_clinical_routes(flow, available, &routes, errors);
}

fn validate_config(
    flow: &FlowDraft,
    node: &FlowNodeDraft,
    definition: &CatalogueNode,
    errors: &mut Vec<ValidationError>,
) {
    for field in &definition.fields {
        let value = node.config.get(&field.key);
        if field.required && field.default.is_none() && value.is_none_or(missing_value) {
            if !(node.implementation == "agent"
                && field.key == "agent_id"
                && node.agent_key.is_some())
            {
                push_error(
                    errors,
                    "missing_required_field",
                    &format!("{} requires {}.", definition.id, field.key),
                    Some(&flow.key),
                    Some(&format!("flow.nodes.{}", node.id)),
                );
            }
        }
        if field.field_type == "select" {
            if let Some(value) = value.and_then(Value::as_str) {
                let allowed = field
                    .options
                    .iter()
                    .filter_map(|option| option.get("id").and_then(Value::as_str))
                    .any(|id| id == value);
                if !allowed {
                    push_error(
                        errors,
                        "invalid_select_option",
                        &format!("{} is not valid for {}.", value, field.key),
                        Some(&flow.key),
                        Some(&format!("flow.nodes.{}", node.id)),
                    );
                }
            }
        }
    }
    if node.implementation == "loop"
        && (node
            .config
            .get("max_iterations")
            .and_then(Value::as_u64)
            .is_none_or(|value| value == 0)
            || node
                .config
                .get("max_seconds")
                .and_then(Value::as_u64)
                .is_none_or(|value| value == 0))
    {
        push_error(
            errors,
            "unbounded_loop",
            "Loop nodes need positive iteration and duration bounds.",
            Some(&flow.key),
            Some(&format!("flow.nodes.{}", node.id)),
        );
    }
}

fn validate_clinical_routes(
    flow: &FlowDraft,
    available: &HashMap<&str, &CatalogueNode>,
    routes: &HashMap<(&str, &str), &str>,
    errors: &mut Vec<ValidationError>,
) {
    let mut safe = flow
        .graph
        .nodes
        .iter()
        .filter(|node| node.implementation == "escalate.notify")
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    for _ in 0..flow.graph.nodes.len() {
        let mut changed = false;
        for node in &flow.graph.nodes {
            if safe.contains(node.id.as_str()) {
                continue;
            }
            let Some(definition) = available.get(node.implementation.as_str()) else {
                continue;
            };
            let outcomes = node_outcomes(node, definition);
            if !outcomes.is_empty()
                && outcomes.iter().all(|outcome| {
                    routes
                        .get(&(node.id.as_str(), outcome.as_str()))
                        .is_some_and(|target| safe.contains(target))
                })
            {
                safe.insert(node.id.as_str());
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    for node in &flow.graph.nodes {
        let risky: &[&str] = match node.implementation.as_str() {
            "outreach.request" => &["declined", "expired", "failed"],
            "intelligence" => &["empty", "failed"],
            "care_path.record" => &["failed"],
            "care_path.complete" => &["not_found", "failed"],
            _ => &[],
        };
        for outcome in risky {
            if routes
                .get(&(node.id.as_str(), *outcome))
                .is_none_or(|target| !safe.contains(target))
            {
                push_error(
                    errors,
                    "unsafe_clinical_terminal",
                    &format!("{}.{} does not safely reach escalation.", node.id, outcome),
                    Some(&flow.key),
                    Some(&format!("flow.nodes.{}", node.id)),
                );
            }
        }
    }
}

fn reachable_from<'a>(
    starts: &[&'a str],
    routes: &HashMap<(&'a str, &'a str), &'a str>,
) -> HashSet<&'a str> {
    let mut reachable = starts.iter().copied().collect::<HashSet<_>>();
    let mut queue = starts.iter().copied().collect::<VecDeque<_>>();
    while let Some(source) = queue.pop_front() {
        for target in routes
            .iter()
            .filter_map(|((from, _), target)| (*from == source).then_some(*target))
        {
            if reachable.insert(target) {
                queue.push_back(target);
            }
        }
    }
    reachable
}

fn node_outcomes(node: &FlowNodeDraft, definition: &CatalogueNode) -> HashSet<String> {
    let mut outcomes = definition
        .outcomes
        .iter()
        .map(|outcome| outcome.id.clone())
        .collect::<HashSet<_>>();
    if let Some(key) = &definition.outcomes_from {
        if let Some(values) = node.config.get(key).and_then(Value::as_array) {
            for value in values {
                let id = value.as_str().or_else(|| {
                    value
                        .get("id")
                        .or_else(|| value.get("key"))
                        .or_else(|| value.get("outcome"))
                        .and_then(Value::as_str)
                });
                if let Some(id) = id.filter(|id| !id.trim().is_empty()) {
                    outcomes.insert(id.into());
                }
            }
        }
    }
    outcomes
}

fn require_evidence_target(
    output: &CompilationOutput,
    artifact_key: &str,
    target_path: &str,
    errors: &mut Vec<ValidationError>,
) {
    if !output
        .evidence
        .iter()
        .any(|link| link.artifact_key == artifact_key && link.target_path == target_path)
    {
        push_error(
            errors,
            "missing_provenance",
            "A generated clinical target has no source evidence.",
            Some(artifact_key),
            Some(target_path),
        );
    }
}

fn missing_value(value: &Value) -> bool {
    value.is_null()
        || value.as_str().is_some_and(|value| value.trim().is_empty())
        || value.as_array().is_some_and(Vec::is_empty)
}

fn collect_source_evidence(
    input: &CarePathProgram,
) -> HashSet<(String, String, String, EvidenceRole)> {
    let mut evidence = HashSet::new();
    for recommendation in &input.recommendations {
        add_evidence(&mut evidence, &recommendation.evidence);
        add_evidence(&mut evidence, &recommendation.population.evidence);
        add_evidence(&mut evidence, &recommendation.trigger.evidence);
        for action in &recommendation.actions {
            add_evidence(&mut evidence, &action.evidence);
        }
        for threshold in &recommendation.thresholds {
            add_evidence(&mut evidence, &threshold.evidence);
        }
        if let Some(completion) = &recommendation.completion {
            add_evidence(&mut evidence, &completion.evidence);
        }
        if let Some(policy) = &recommendation.failure_policy {
            add_evidence(&mut evidence, &policy.evidence);
        }
    }
    evidence
}

fn add_evidence(
    target: &mut HashSet<(String, String, String, EvidenceRole)>,
    evidence: &[EvidenceRef],
) {
    target.extend(evidence.iter().map(|evidence| {
        (
            evidence.chunk_id.clone(),
            evidence.recommendation_id.clone(),
            evidence.excerpt.clone(),
            evidence.role.clone(),
        )
    }));
}

fn push_error(
    errors: &mut Vec<ValidationError>,
    code: &str,
    message: &str,
    artifact_key: Option<&str>,
    target_path: Option<&str>,
) {
    errors.push(ValidationError {
        code: code.into(),
        message: message.into(),
        artifact_key: artifact_key.map(str::to_owned),
        target_path: target_path.map(str::to_owned),
    });
}
