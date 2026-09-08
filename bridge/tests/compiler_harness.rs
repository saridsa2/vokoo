use std::collections::VecDeque;
use std::sync::Mutex;

use async_trait::async_trait;
use rustvani::vokoo::compiler::{
    Action, ActionOperation, AisdkCompilerModel, CatalogueNode, CatalogueOutcome,
    CatalogueSnapshot, CompilerError, CompilerHarness, CompilerInput, CompilerModel, EvidenceRef,
    EvidenceRole, FailurePolicy, ModelRequest, ModelResponse, Population, Recommendation,
    TokenUsage, TraceEvent, TraceSink, TriggerOperation, TriggerSpec, WorkspaceResources,
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
    assert_eq!(requests[1].tool_name, "emit_recommendations");
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

#[tokio::test]
async fn rejects_out_of_scope_evidence_and_retries_invalid_output_once() {
    let model = ScriptedModel::new(vec![
        json!({"tasks":"not-an-array"}),
        json!({
            "tasks":[{"id":"task-1","heading":"Monitoring","page_start":1,"page_end":2,"chunk_ids":["chunk-1"]}],
            "excluded_sections":[]
        }),
        json!({"task_id":"task-1","recommendations":[recommendation("bad", "chunk-2")]}),
        json!({"task_id":"task-1","recommendations":[recommendation("still-bad", "chunk-2")]}),
    ]);
    let trace = RecordingTrace::default();
    let harness = CompilerHarness::new(&model, &trace);

    let error = harness.compile(input()).await.unwrap_err();

    assert_eq!(error.code(), "evidence_out_of_scope");
    let requests = model.requests.lock().unwrap();
    assert_eq!(requests.len(), 4);
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
async fn rejects_overlapping_supervisor_tasks_after_one_correction() {
    let overlapping = json!({
        "tasks":[
            {"id":"one","heading":"One","page_start":1,"page_end":3,"chunk_ids":["chunk-1"]},
            {"id":"two","heading":"Two","page_start":2,"page_end":4,"chunk_ids":["chunk-2"]}
        ],
        "excluded_sections":[]
    });
    let model = ScriptedModel::new(vec![overlapping.clone(), overlapping]);
    let trace = RecordingTrace::default();

    let error = CompilerHarness::new(&model, &trace)
        .compile(input())
        .await
        .unwrap_err();

    assert_eq!(error.code(), "overlapping_section_tasks");
    assert_eq!(model.requests.lock().unwrap().len(), 2);
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
                anchor: "last_hba1c".into(),
                every_days: 90,
            },
            evidence: evidence.clone(),
        },
        thresholds: vec![],
        actions: vec![Action {
            key: "request-hba1c".into(),
            operation: ActionOperation::Request {
                what: "HbA1c result".into(),
                instructions: "Ask the patient to arrange a review".into(),
                expires_days: 14,
            },
            evidence: evidence.clone(),
        }],
        completion: None,
        failure_policy: Some(FailurePolicy {
            recipient: "care_team".into(),
            urgency: "routine".into(),
            note: "Follow up manually".into(),
            evidence: evidence.clone(),
        }),
        evidence,
    }
}

fn catalogue() -> CatalogueSnapshot {
    let node = |id: &str, outcomes: &[&str]| CatalogueNode {
        id: id.into(),
        node_type: id.into(),
        families: vec!["care_path".into()],
        outcomes: outcomes
            .iter()
            .map(|id| CatalogueOutcome { id: (*id).into() })
            .collect(),
        fields: vec![],
        outcomes_from: None,
        output: String::new(),
        suspends: false,
        is_active: true,
    };
    CatalogueSnapshot {
        digest: "catalogue-1".into(),
        nodes: vec![
            node("trigger.recurring", &["due"]),
            node(
                "outreach.request",
                &["fulfilled", "declined", "expired", "failed"],
            ),
            node("escalate.notify", &["created", "failed"]),
        ],
    }
}
