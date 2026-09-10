use std::collections::BTreeSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceRole {
    Requirement,
    Threshold,
    Timing,
    Exception,
    Population,
    Escalation,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
pub struct EvidenceRef {
    pub chunk_id: String,
    pub recommendation_id: String,
    pub excerpt: String,
    pub role: EvidenceRole,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
pub struct Population {
    pub description: String,
    #[serde(default)]
    pub inclusions: Vec<String>,
    #[serde(default)]
    pub exclusions: Vec<String>,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TriggerOperation {
    Due {
        anchor: String,
        offset_days: i64,
        window_days: u32,
    },
    Recurring {
        anchor: String,
        every_days: u32,
    },
    Reported {
        observations: Vec<String>,
    },
    Document {
        document_kind: String,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
pub struct TriggerSpec {
    pub key: String,
    #[serde(flatten)]
    pub operation: TriggerOperation,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
pub struct AgentConversation {
    pub name: String,
    pub system_prompt: String,
    pub first_message: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionOperation {
    Request {
        actor: RequestActor,
        what: String,
        instructions: String,
        expires_days: u32,
    },
    Conversation(AgentConversation),
    RecordObservation {
        observation_kind: String,
        value: String,
        source: String,
    },
    Intelligence {
        shape_id: String,
        instruction: String,
    },
    Unsupported {
        capability: String,
        description: String,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequestActor {
    Patient,
    Clinician,
    CareTeam,
    System,
}

impl RequestActor {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Patient => "patient",
            Self::Clinician => "clinician",
            Self::CareTeam => "care_team",
            Self::System => "system",
        }
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
pub struct Action {
    pub key: String,
    #[serde(flatten)]
    pub operation: ActionOperation,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
pub struct CompletionSpec {
    pub milestone_key: String,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
pub struct FailurePolicy {
    pub recipient: String,
    pub urgency: String,
    pub note: String,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
pub struct Threshold {
    pub observation: String,
    pub operator: String,
    pub value: Value,
    pub unit: String,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
pub struct Recommendation {
    pub id: String,
    pub title: String,
    pub population: Population,
    pub trigger: TriggerSpec,
    #[serde(default)]
    pub thresholds: Vec<Threshold>,
    pub actions: Vec<Action>,
    pub completion: Option<CompletionSpec>,
    pub failure_policy: Option<FailurePolicy>,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct CarePathProgram {
    pub title: String,
    pub recommendations: Vec<Recommendation>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct CatalogueOutcome {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct CatalogueField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default)]
    pub options: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct CatalogueNode {
    pub id: String,
    pub node_type: String,
    pub families: Vec<String>,
    #[serde(default)]
    pub outcomes: Vec<CatalogueOutcome>,
    #[serde(default)]
    pub fields: Vec<CatalogueField>,
    #[serde(default)]
    pub outcomes_from: Option<String>,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub suspends: bool,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Default)]
pub struct CatalogueSnapshot {
    #[serde(default)]
    pub digest: String,
    pub nodes: Vec<CatalogueNode>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
pub struct WorkspaceResources {
    #[serde(default)]
    pub published_agent_ids: BTreeSet<String>,
    #[serde(default)]
    pub structured_output_ids: BTreeSet<String>,
    #[serde(default)]
    pub tool_ids: BTreeSet<String>,
    #[serde(default)]
    pub integration_flow_ids: BTreeSet<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct CapabilityResolutionSnapshot {
    #[serde(alias = "resolution_id")]
    pub id: String,
    pub recommendation_id: String,
    pub capability_key: String,
    pub adapter_key: String,
    pub adapter_version: String,
    pub node_type_id: String,
    pub mapping: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AgentDraft {
    pub key: String,
    pub name: String,
    pub system_prompt: String,
    pub first_message: String,
    #[serde(default)]
    pub config: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct FlowNodeDraft {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub implementation: String,
    #[serde(default)]
    pub config: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct FlowTransitionDraft {
    pub id: String,
    pub from: String,
    pub outcome: String,
    pub to: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct FlowGraphDraft {
    pub version: u32,
    pub nodes: Vec<FlowNodeDraft>,
    pub transitions: Vec<FlowTransitionDraft>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct FlowDraft {
    pub key: String,
    pub name: String,
    pub description: String,
    pub trigger_event: String,
    pub graph: FlowGraphDraft,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct EvidenceLinkDraft {
    pub artifact_key: String,
    pub target_path: String,
    pub chunk_id: String,
    pub excerpt: String,
    pub recommendation_id: String,
    pub role: EvidenceRole,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GapSeverity {
    Info,
    Warning,
    Blocking,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct CompilerGap {
    pub code: String,
    pub severity: GapSeverity,
    pub recommendation_id: String,
    pub explanation: String,
    pub missing_capability: Option<String>,
    pub details: Value,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Default)]
pub struct CompilationOutput {
    pub agents: Vec<AgentDraft>,
    pub flows: Vec<FlowDraft>,
    pub gaps: Vec<CompilerGap>,
    pub evidence: Vec<EvidenceLinkDraft>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ValidationError {
    pub code: String,
    pub message: String,
    pub artifact_key: Option<String>,
    pub target_path: Option<String>,
}
