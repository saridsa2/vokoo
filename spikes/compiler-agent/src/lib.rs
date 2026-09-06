use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use aisdk::core::tools::ToolExecute;
use aisdk::core::{DynamicModel, LanguageModelRequest, Tool};
use aisdk::providers::Anthropic;
use schemars::Schema;

mod harness;

pub use harness::{
    build_document_map, compile_document_with_minimax, extract_pdf_pages, link_fragments,
    pages_from_text, scope_catalogue_to_explicit_triggers, validate_section_task,
    DocumentCompilationReport, DocumentMapEntry, DocumentPage, SectionTask, SupervisorConclusion,
    WorkerFragment, WorkerTrace,
};

const EMIT_TOOL: &str = "emit_agent_and_flow_drafts";

#[derive(Clone, Debug, Deserialize)]
pub struct CatalogueOutcome {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CatalogueField {
    #[serde(alias = "name")]
    pub key: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CatalogueNode {
    pub id: String,
    pub node_type: String,
    pub families: Vec<String>,
    #[serde(default)]
    pub outcomes: Vec<CatalogueOutcome>,
    #[serde(default)]
    pub fields: Vec<CatalogueField>,
    #[serde(default = "enabled")]
    pub is_active: bool,
}

fn enabled() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgentDraft {
    pub key: String,
    pub name: String,
    pub instructions: String,
    pub first_message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FlowNodeDraft {
    pub key: String,
    pub component: String,
    pub name: String,
    #[serde(default)]
    pub agent_key: Option<String>,
    #[serde(default)]
    pub config: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FlowEdgeDraft {
    pub source: String,
    pub outcome: String,
    pub target: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FlowDraft {
    pub key: String,
    pub name: String,
    pub family: String,
    pub nodes: Vec<FlowNodeDraft>,
    pub edges: Vec<FlowEdgeDraft>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CompilationDraft {
    pub agents: Vec<AgentDraft>,
    pub flows: Vec<FlowDraft>,
    #[serde(default)]
    pub notes: Vec<String>,
}

pub fn emission_schema(catalogue: &[CatalogueNode]) -> Value {
    let component_ids = catalogue
        .iter()
        .filter(|component| component.is_active)
        .map(|component| component.id.as_str())
        .collect::<Vec<_>>();

    serde_json::json!({
        "type": "object",
        "required": ["agents", "flows", "notes"],
        "properties": {
            "agents": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["key", "name", "instructions", "first_message"],
                    "properties": {
                        "key": {"type": "string"},
                        "name": {"type": "string"},
                        "instructions": {"type": "string"},
                        "first_message": {"type": "string"}
                    }
                }
            },
            "flows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["key", "name", "family", "nodes", "edges"],
                    "properties": {
                        "key": {"type": "string"},
                        "name": {"type": "string"},
                        "family": {"type": "string"},
                        "nodes": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["key", "component", "name", "config"],
                                "properties": {
                                    "key": {"type": "string"},
                                    "component": {"type": "string", "enum": component_ids},
                                    "name": {"type": "string"},
                                    "agent_key": {"type": ["string", "null"]},
                                    "config": {"type": "object"}
                                }
                            }
                        },
                        "edges": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["source", "outcome", "target"],
                                "properties": {
                                    "source": {"type": "string"},
                                    "outcome": {"type": "string"},
                                    "target": {"type": "string"}
                                }
                            }
                        }
                    }
                }
            },
            "notes": {"type": "array", "items": {"type": "string"}}
        }
    })
}

pub fn validate_draft(
    draft: &CompilationDraft,
    catalogue: &[CatalogueNode],
) -> Result<(), Vec<String>> {
    let available = catalogue
        .iter()
        .filter(|component| component.is_active)
        .map(|component| (component.id.as_str(), component))
        .collect::<HashMap<_, _>>();
    let mut errors = Vec::new();
    let agent_keys = draft
        .agents
        .iter()
        .map(|agent| agent.key.as_str())
        .collect::<HashSet<_>>();

    for flow in &draft.flows {
        let nodes = flow
            .nodes
            .iter()
            .map(|node| (node.key.as_str(), node))
            .collect::<HashMap<_, _>>();
        let has_trigger = flow.nodes.iter().any(|node| {
            available
                .get(node.component.as_str())
                .is_some_and(|component| component.node_type == "trigger")
        });
        if !has_trigger {
            errors.push(format!(
                "flow '{}' has no active trigger from the platform catalogue",
                flow.key
            ));
        }
        for node in &flow.nodes {
            let Some(component) = available.get(node.component.as_str()) else {
                errors.push(format!(
                    "flow '{}' uses component '{}' which is not in the active platform catalogue",
                    flow.key, node.component
                ));
                continue;
            };
            if !component
                .families
                .iter()
                .any(|family| family == &flow.family)
            {
                errors.push(format!(
                    "component '{}' is not available to flow family '{}'",
                    node.component, flow.family
                ));
            }
            if node.component == "agent" {
                match node.agent_key.as_deref() {
                    Some(key) if agent_keys.contains(key) => {}
                    Some(key) => errors.push(format!(
                        "agent node '{}' references agent '{}' which this compilation did not emit",
                        node.key, key
                    )),
                    None => errors.push(format!("agent node '{}' has no agent_key", node.key)),
                }
            }
            for field in component
                .fields
                .iter()
                .filter(|field| field.required && field.default.is_none())
            {
                // The generated agent does not have a database UUID yet. The
                // materializer resolves agent_key to agent_id when it creates
                // the drafts, so that reference satisfies this one field.
                if node.component == "agent" && field.key == "agent_id" && node.agent_key.is_some()
                {
                    continue;
                }
                let value = node.config.get(&field.key);
                let missing = match value {
                    None | Some(Value::Null) => true,
                    Some(Value::String(text)) => text.trim().is_empty(),
                    _ => false,
                };
                if missing {
                    errors.push(format!(
                        "node '{}' ({}) is missing required config field '{}'",
                        node.key, node.component, field.key
                    ));
                }
            }
        }

        for edge in &flow.edges {
            let Some(source) = nodes.get(edge.source.as_str()) else {
                errors.push(format!(
                    "edge source '{}' does not exist in flow '{}'",
                    edge.source, flow.key
                ));
                continue;
            };
            if !nodes.contains_key(edge.target.as_str()) {
                errors.push(format!(
                    "edge target '{}' does not exist in flow '{}'",
                    edge.target, flow.key
                ));
            }
            if let Some(component) = available.get(source.component.as_str()) {
                let outcomes = component
                    .outcomes
                    .iter()
                    .map(|outcome| outcome.id.as_str())
                    .collect::<HashSet<_>>();
                if !outcomes.contains(edge.outcome.as_str()) {
                    errors.push(format!(
                        "edge outcome '{}' is not exposed by component '{}'",
                        edge.outcome, source.component
                    ));
                }
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Ask an AISDK-backed compiler agent for one atomic set of agent and flow
/// drafts. The model can only select component ids present in `catalogue`; the
/// validator then enforces relationships that JSON Schema cannot express.
pub async fn compile_with_minimax(
    api_key: &str,
    model: &str,
    request: &str,
    catalogue: &[CatalogueNode],
) -> Result<CompilationDraft, String> {
    if request.trim().is_empty() {
        return Err("the compilation request is empty".into());
    }
    if catalogue.iter().all(|component| !component.is_active) {
        return Err("the platform catalogue has no active components".into());
    }

    let schema = Schema::try_from(emission_schema(catalogue))
        .map_err(|error| format!("could not build the compiler tool schema: {error}"))?;
    let captured: Arc<Mutex<Option<CompilationDraft>>> = Arc::new(Mutex::new(None));
    let sink = Arc::clone(&captured);
    let failures: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let failure_sink = Arc::clone(&failures);
    let known_catalogue = catalogue.to_vec();
    let tool = Tool::builder()
        .name(EMIT_TOOL)
        .description(
            "Emit the complete set of draft agents and draft flows required by the request.",
        )
        .input_schema(schema)
        .execute(ToolExecute::from_sync(move |_context, value: Value| {
            let rejected = |message: String| {
                if let Ok(mut recorded) = failure_sink.lock() {
                    recorded.push(message.clone());
                }
                aisdk::error::Error::ToolCallError(message)
            };
            let candidate: CompilationDraft = serde_json::from_value(value)
                .map_err(|error| rejected(format!("malformed draft: {error}")))?;
            validate_draft(&candidate, &known_catalogue).map_err(|errors| {
                rejected(format!(
                    "draft is outside the platform boundary: {}",
                    errors.join("; ")
                ))
            })?;
            *sink.lock().map_err(|_| {
                aisdk::error::Error::ToolCallError("compiler output lock poisoned".into())
            })? = Some(candidate);
            Ok("drafts accepted".into())
        }))
        .build()
        .map_err(|error| format!("could not build the compiler tool: {error}"))?;

    let catalogue_summary = catalogue
        .iter()
        .filter(|component| component.is_active)
        .map(|component| {
            let outcomes = component
                .outcomes
                .iter()
                .map(|outcome| outcome.id.as_str())
                .collect::<Vec<_>>();
            let required = component
                .fields
                .iter()
                .filter(|field| field.required && field.default.is_none())
                .map(|field| field.key.as_str())
                .collect::<Vec<_>>();
            format!(
                "- {} | kind={} | families={} | outcomes={} | required_config={}",
                component.id,
                component.node_type,
                component.families.join(","),
                outcomes.join(","),
                required.join(",")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let system = format!(
        "You are VoKoo's compiler agent. Convert the user's request into draft agents and draft flows. \
         You may create as many agents and flows as the request requires. A flow may contain multiple \
         trigger nodes. Use only the platform components listed below; never invent a component, trigger, \
         outcome, agent reference, or capability. Connect edges with an outcome exposed by their source \
         component. An agent node must name one agent emitted in the same tool call through agent_key. \
         Write useful agent instructions from the user's stated policy, but do not invent requirements the \
         user did not provide. If the platform cannot represent part of the request, omit that unsupported \
         part and explain the gap in notes. You must call {EMIT_TOOL} exactly once.\n\n\
         Active platform catalogue:\n{catalogue_summary}"
    );

    let mut last_answer = String::new();
    for attempt in 1..=2 {
        let provider = Anthropic::<DynamicModel>::builder()
            .model_name(model)
            .api_key(api_key)
            .base_url("https://api.minimax.io/anthropic/v1/")
            .build()
            .map_err(|error| format!("could not build the MiniMax provider: {error}"))?;
        let done = Arc::clone(&captured);
        let prompt = if attempt == 1 {
            request.to_string()
        } else {
            format!(
                "{request}\n\nYour previous response did not produce a valid tool call. Call {EMIT_TOOL} now; do not answer in prose."
            )
        };
        let answer = LanguageModelRequest::builder()
            .model(provider)
            .system(system.clone())
            .prompt(prompt)
            .with_tool(tool.clone())
            .body(serde_json::json!({
                "tool_choice": {"type": "tool", "name": EMIT_TOOL}
            }))
            .stop_when(move |options| {
                done.lock().map(|draft| draft.is_some()).unwrap_or(true)
                    || options.steps().len() > 3
            })
            .build()
            .generate_text()
            .await
            .map_err(|error| format!("compiler model request failed: {error}"))?;

        if let Some(draft) = captured
            .lock()
            .map_err(|_| "compiler output lock poisoned".to_string())?
            .take()
        {
            return Ok(draft);
        }
        last_answer = answer
            .text()
            .unwrap_or_default()
            .chars()
            .take(200)
            .collect();
    }

    let validation = failures
        .lock()
        .ok()
        .and_then(|items| items.last().cloned())
        .unwrap_or_else(|| "no valid tool call was received".into());
    Err(format!(
        "the compiler did not emit valid drafts after bounded correction: {validation}. Last answer: {last_answer}"
    ))
}
