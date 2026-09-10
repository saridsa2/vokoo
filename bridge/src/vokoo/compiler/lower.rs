use std::collections::HashMap;

use serde_json::{json, Value};

use super::types::*;

pub fn lower(
    program: &CarePathProgram,
    catalogue: &CatalogueSnapshot,
    resources: &WorkspaceResources,
    resolutions: &[CapabilityResolutionSnapshot],
) -> CompilationOutput {
    let available = catalogue
        .nodes
        .iter()
        .filter(|node| node.is_active && node.families.iter().any(|family| family == "care_path"))
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let mut output = CompilationOutput::default();

    for recommendation in &program.recommendations {
        lower_recommendation(
            recommendation,
            &available,
            resources,
            resolutions,
            &mut output,
        );
    }
    merge_gap_identities(&mut output.gaps);
    output
}

fn merge_gap_identities(gaps: &mut Vec<CompilerGap>) {
    let mut merged = Vec::<CompilerGap>::new();
    let mut indices = HashMap::<(String, String), usize>::new();
    for gap in gaps.drain(..) {
        let identity = (gap.code.clone(), gap.recommendation_id.clone());
        if let Some(index) = indices.get(&identity).copied() {
            let existing = &mut merged[index];
            if existing.explanation != gap.explanation {
                existing.explanation.push(' ');
                existing.explanation.push_str(&gap.explanation);
            }
            if existing.missing_capability.is_none() {
                existing.missing_capability = gap.missing_capability;
            }
            for evidence in gap.evidence {
                if !existing.evidence.contains(&evidence) {
                    existing.evidence.push(evidence);
                }
            }
        } else {
            indices.insert(identity, merged.len());
            merged.push(gap);
        }
    }
    *gaps = merged;
}

fn lower_recommendation(
    recommendation: &Recommendation,
    available: &HashMap<&str, &CatalogueNode>,
    resources: &WorkspaceResources,
    resolutions: &[CapabilityResolutionSnapshot],
    output: &mut CompilationOutput,
) {
    let recommendation_key = stable_key(&recommendation.id);
    let flow_key = format!("{recommendation_key}-care-path");
    for threshold in &recommendation.thresholds {
        output.gaps.push(CompilerGap {
            code: "threshold_requires_mapping".into(),
            severity: GapSeverity::Blocking,
            recommendation_id: recommendation.id.clone(),
            explanation: format!(
                "Threshold {} {} {} {} has no source-authorized runtime observation mapping.",
                threshold.observation, threshold.operator, threshold.value, threshold.unit
            ),
            missing_capability: Some("clinical.threshold_mapping".into()),
            details: json!({
                "observation": threshold.observation,
                "operator": threshold.operator,
                "value": threshold.value,
                "unit": threshold.unit,
            }),
            evidence: threshold.evidence.clone(),
        });
    }
    let (trigger_component, trigger_event, trigger_outcome, trigger_config) =
        lower_trigger(&recommendation.trigger);

    let mut required = vec![trigger_component];
    let mut needs_escalation = recommendation.completion.is_some();
    let mut has_supported_action = false;
    let clinical_task_resolution = resolutions.iter().find(|resolution| {
        resolution.recommendation_id == recommendation.id
            && valid_clinical_task_resolution(resolution, available)
    });
    for action in &recommendation.actions {
        match &action.operation {
            ActionOperation::Request {
                actor: RequestActor::Patient,
                ..
            } => {
                required.push("outreach.request");
                needs_escalation = true;
                has_supported_action = true;
            }
            ActionOperation::Request {
                actor: RequestActor::Clinician | RequestActor::CareTeam,
                ..
            } if clinical_task_resolution.is_some() => {
                required.push(
                    clinical_task_resolution
                        .expect("checked above")
                        .node_type_id
                        .as_str(),
                );
                needs_escalation = true;
                has_supported_action = true;
            }
            ActionOperation::Request {
                actor,
                what,
                instructions,
                expires_days,
            } => {
                output.gaps.push(CompilerGap {
                    code: "unsupported_action_actor".into(),
                    severity: GapSeverity::Blocking,
                    recommendation_id: recommendation.id.clone(),
                    explanation: format!(
                        "A {}-directed request cannot be represented as patient outreach.",
                        actor.as_str()
                    ),
                    missing_capability: Some("clinical.task".into()),
                    details: json!({
                        "actor": actor.as_str(),
                        "action_key": action.key,
                        "what": what,
                        "instructions": instructions,
                        "expires_days": expires_days,
                    }),
                    evidence: action.evidence.clone(),
                });
                return;
            }
            ActionOperation::Conversation(_) => {
                required.push("agent");
                has_supported_action = true;
            }
            ActionOperation::RecordObservation { .. } => {
                required.push("care_path.record");
                needs_escalation = true;
                has_supported_action = true;
            }
            ActionOperation::Intelligence { shape_id, .. } => {
                required.push("intelligence");
                needs_escalation = true;
                has_supported_action = true;
                if !resources.structured_output_ids.contains(shape_id) {
                    output.gaps.push(CompilerGap {
                        code: "missing_resource".into(),
                        severity: GapSeverity::Blocking,
                        recommendation_id: recommendation.id.clone(),
                        explanation: format!(
                            "Structured output {shape_id} is not in the frozen workspace resources."
                        ),
                        missing_capability: Some("structured_output".into()),
                        details: json!({
                            "action_key": action.key,
                            "shape_id": shape_id,
                        }),
                        evidence: action.evidence.clone(),
                    });
                    return;
                }
            }
            ActionOperation::Unsupported {
                capability,
                description,
            } => output.gaps.push(CompilerGap {
                code: "missing_capability".into(),
                severity: GapSeverity::Warning,
                recommendation_id: recommendation.id.clone(),
                explanation: format!(
                    "{description} cannot be represented by the active catalogue."
                ),
                missing_capability: Some(capability.clone()),
                details: json!({
                    "action_key": action.key,
                    "description": description,
                }),
                evidence: action.evidence.clone(),
            }),
        }
    }
    if recommendation.completion.is_some() {
        required.push("care_path.complete");
    }
    if needs_escalation {
        required.push("escalate.notify");
        if recommendation.failure_policy.is_none() {
            output.gaps.push(CompilerGap {
                code: "missing_failure_policy".into(),
                severity: GapSeverity::Blocking,
                recommendation_id: recommendation.id.clone(),
                explanation: "The source-bound program has no escalation policy for a failure-capable action."
                    .into(),
                missing_capability: None,
                details: json!({}),
                evidence: recommendation.evidence.clone(),
            });
            return;
        }
    }
    if !has_supported_action {
        return;
    }

    required.sort_unstable();
    required.dedup();
    let missing = required
        .into_iter()
        .filter(|component| !available.contains_key(component))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        for component in missing {
            output.gaps.push(CompilerGap {
                code: "missing_capability".into(),
                severity: GapSeverity::Blocking,
                recommendation_id: recommendation.id.clone(),
                explanation: format!(
                    "Required component {component} is not active for care paths."
                ),
                missing_capability: Some(component.into()),
                details: json!({ "component": component }),
                evidence: recommendation.evidence.clone(),
            });
        }
        return;
    }

    let trigger_id = format!("{recommendation_key}-trigger");
    let completion_id = format!("{recommendation_key}-complete");
    let escalation_id = format!("{recommendation_key}-escalation");
    let mut nodes = vec![FlowNodeDraft {
        id: trigger_id.clone(),
        node_type: available[trigger_component].node_type.clone(),
        implementation: trigger_component.into(),
        config: with_catalogue_defaults(trigger_config, available[trigger_component]),
        agent_key: None,
    }];
    link_evidence(
        &mut output.evidence,
        &flow_key,
        &format!("flow.nodes.{trigger_id}"),
        &recommendation.id,
        &recommendation.trigger.evidence,
    );
    link_evidence(
        &mut output.evidence,
        &flow_key,
        "flow.population",
        &recommendation.id,
        &recommendation.population.evidence,
    );
    link_evidence(
        &mut output.evidence,
        &flow_key,
        "flow.recommendation",
        &recommendation.id,
        &recommendation.evidence,
    );

    let mut transitions = Vec::new();
    let mut previous_id = trigger_id;
    let mut previous_outcome = trigger_outcome;
    let mut clinical_failures = Vec::<(String, &'static str)>::new();

    for action in &recommendation.actions {
        let action_id = stable_key(&action.key);
        let (component, config, success_outcome, agent_key) = match &action.operation {
            ActionOperation::Request {
                actor: RequestActor::Patient,
                what,
                instructions,
                expires_days,
            } => {
                for outcome in ["declined", "expired", "failed"] {
                    clinical_failures.push((action_id.clone(), outcome));
                }
                (
                    "outreach.request",
                    json!({
                        "what": what,
                        "instructions": instructions,
                        "expires_days": expires_days
                    }),
                    "fulfilled",
                    None,
                )
            }
            ActionOperation::Request {
                actor: RequestActor::Clinician | RequestActor::CareTeam,
                instructions,
                ..
            } => {
                let resolution =
                    clinical_task_resolution.expect("validated before graph construction");
                let mapping = resolution
                    .mapping
                    .as_object()
                    .expect("validated resolution mapping");
                clinical_failures.push((action_id.clone(), "failed"));
                (
                    resolution.node_type_id.as_str(),
                    json!({
                        "to": mapping["to"],
                        "urgency": mapping["urgency"],
                        "note": instructions,
                    }),
                    "notified",
                    None,
                )
            }
            ActionOperation::Request { .. } => continue,
            ActionOperation::Conversation(conversation) => {
                let key = format!("{recommendation_key}-{action_id}-agent");
                output.agents.push(AgentDraft {
                    key: key.clone(),
                    name: conversation.name.clone(),
                    system_prompt: conversation.system_prompt.clone(),
                    first_message: conversation.first_message.clone(),
                    config: json!({}),
                });
                link_evidence(
                    &mut output.evidence,
                    &key,
                    "agent.system_prompt",
                    &recommendation.id,
                    &action.evidence,
                );
                ("agent", json!({}), "done", Some(key))
            }
            ActionOperation::RecordObservation {
                observation_kind,
                value,
                source,
            } => {
                clinical_failures.push((action_id.clone(), "failed"));
                (
                    "care_path.record",
                    json!({"kind": observation_kind, "value": value, "source": source}),
                    "recorded",
                    None,
                )
            }
            ActionOperation::Intelligence {
                shape_id,
                instruction,
            } => {
                clinical_failures.push((action_id.clone(), "empty"));
                clinical_failures.push((action_id.clone(), "failed"));
                (
                    "intelligence",
                    json!({"shape_id": shape_id, "instruction": instruction}),
                    "ok",
                    None,
                )
            }
            ActionOperation::Unsupported { .. } => continue,
        };
        transitions.push(edge(&previous_id, &previous_outcome, &action_id));
        nodes.push(FlowNodeDraft {
            id: action_id.clone(),
            node_type: available[component].node_type.clone(),
            implementation: component.into(),
            config: with_catalogue_defaults(config, available[component]),
            agent_key,
        });
        link_evidence(
            &mut output.evidence,
            &flow_key,
            &format!("flow.nodes.{action_id}"),
            &recommendation.id,
            &action.evidence,
        );
        previous_id = action_id;
        previous_outcome = success_outcome.to_string();
    }

    if let Some(completion) = &recommendation.completion {
        transitions.push(edge(&previous_id, &previous_outcome, &completion_id));
        nodes.push(FlowNodeDraft {
            id: completion_id.clone(),
            node_type: available["care_path.complete"].node_type.clone(),
            implementation: "care_path.complete".into(),
            config: with_catalogue_defaults(
                json!({"milestone_key": completion.milestone_key}),
                available["care_path.complete"],
            ),
            agent_key: None,
        });
        clinical_failures.push((completion_id.clone(), "not_found"));
        clinical_failures.push((completion_id.clone(), "failed"));
        link_evidence(
            &mut output.evidence,
            &flow_key,
            &format!("flow.nodes.{completion_id}"),
            &recommendation.id,
            &completion.evidence,
        );
    }

    if needs_escalation {
        let policy = recommendation
            .failure_policy
            .as_ref()
            .expect("checked above");
        for (from, outcome) in clinical_failures {
            transitions.push(edge(&from, outcome, &escalation_id));
        }
        nodes.push(FlowNodeDraft {
            id: escalation_id.clone(),
            node_type: available["escalate.notify"].node_type.clone(),
            implementation: "escalate.notify".into(),
            config: with_catalogue_defaults(
                json!({
                    "to": policy.recipient,
                    "urgency": policy.urgency,
                    "note": policy.note
                }),
                available["escalate.notify"],
            ),
            agent_key: None,
        });
        link_evidence(
            &mut output.evidence,
            &flow_key,
            &format!("flow.nodes.{escalation_id}"),
            &recommendation.id,
            &policy.evidence,
        );
    }

    output.flows.push(FlowDraft {
        key: flow_key,
        name: recommendation.title.clone(),
        description: format!(
            "Compiled from recommendation {} for {}.",
            recommendation.id, recommendation.population.description
        ),
        trigger_event: trigger_event.into(),
        graph: FlowGraphDraft {
            version: 3,
            nodes,
            transitions,
        },
    });
}

pub(crate) fn validate_capability_resolutions(
    resolutions: &[CapabilityResolutionSnapshot],
    catalogue: &CatalogueSnapshot,
) -> Result<(), &'static str> {
    let available = catalogue
        .nodes
        .iter()
        .filter(|node| node.is_active && node.families.iter().any(|family| family == "care_path"))
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let mut identities = std::collections::HashSet::new();
    for resolution in resolutions {
        if resolution.id.parse::<uuid::Uuid>().is_err()
            || resolution.recommendation_id.trim().is_empty()
            || !valid_clinical_task_resolution(resolution, &available)
            || !identities.insert((
                resolution.recommendation_id.as_str(),
                resolution.capability_key.as_str(),
            ))
        {
            return Err("invalid_capability_resolution");
        }
    }
    Ok(())
}

fn valid_clinical_task_resolution(
    resolution: &CapabilityResolutionSnapshot,
    available: &HashMap<&str, &CatalogueNode>,
) -> bool {
    if resolution.capability_key != "clinical.task"
        || resolution.adapter_key != "clinical-task-escalate-notify-v1"
        || resolution.adapter_version != 1
        || resolution.node_type_id != "escalate.notify"
        || !available.contains_key(resolution.node_type_id.as_str())
    {
        return false;
    }
    let Some(mapping) = resolution.mapping.as_object() else {
        return false;
    };
    if mapping.len() != 2 {
        return false;
    }
    let recipient = mapping.get("to").and_then(Value::as_str);
    let urgency = mapping.get("urgency").and_then(Value::as_str);
    matches!(
        recipient,
        Some("primary_team" | "on_call" | "clinician" | "coordinator")
    ) && matches!(urgency, Some("routine" | "soon" | "urgent" | "immediate"))
}

fn lower_trigger(trigger: &TriggerSpec) -> (&'static str, &'static str, String, Value) {
    match &trigger.operation {
        TriggerOperation::Due {
            anchor,
            offset_days,
            window_days,
        } => (
            "trigger.due",
            "care_path.due",
            "due".into(),
            json!({
                "key": trigger.key,
                "anchor": anchor,
                "offset_days": offset_days,
                "window_days": window_days
            }),
        ),
        TriggerOperation::Recurring { anchor, every_days } => (
            "trigger.recurring",
            "care_path.recurring",
            "due".into(),
            json!({"key": trigger.key, "anchor": anchor, "every_days": every_days}),
        ),
        TriggerOperation::Reported { observations } => (
            "trigger.reported",
            "care_path.reported",
            observations.first().cloned().unwrap_or_default(),
            json!({"key": trigger.key, "watch": observations}),
        ),
        TriggerOperation::Document { document_kind } => (
            "trigger.document",
            "care_path.document",
            "received".into(),
            json!({"key": trigger.key, "document_kind": document_kind}),
        ),
    }
}

fn edge(from: &str, outcome: &str, to: &str) -> FlowTransitionDraft {
    FlowTransitionDraft {
        id: format!(
            "{}-{}-{}",
            stable_key(from),
            stable_key(outcome),
            stable_key(to)
        ),
        from: from.into(),
        outcome: outcome.into(),
        to: to.into(),
    }
}

fn link_evidence(
    links: &mut Vec<EvidenceLinkDraft>,
    artifact_key: &str,
    target_path: &str,
    recommendation_id: &str,
    evidence: &[EvidenceRef],
) {
    links.extend(evidence.iter().map(|source| EvidenceLinkDraft {
        artifact_key: artifact_key.into(),
        target_path: target_path.into(),
        chunk_id: source.chunk_id.clone(),
        excerpt: source.excerpt.clone(),
        recommendation_id: recommendation_id.into(),
        role: source.role.clone(),
    }));
}

fn with_catalogue_defaults(mut config: Value, definition: &CatalogueNode) -> Value {
    let Some(object) = config.as_object_mut() else {
        return config;
    };
    for field in &definition.fields {
        if !object.contains_key(&field.key) {
            if let Some(default) = &field.default {
                object.insert(field.key.clone(), default.clone());
            }
        }
    }
    config
}

pub(crate) fn stable_key(value: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            result.push(character.to_ascii_lowercase());
            separator = false;
        } else if !result.is_empty() && !separator {
            result.push('-');
            separator = true;
        }
    }
    result.trim_matches('-').to_string()
}
