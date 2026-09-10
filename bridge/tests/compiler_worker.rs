use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use rustvani::vokoo::compiler::*;
use rustvani::vokoo::documents::DocumentEvidence;
use serde_json::{json, Value};

#[derive(Default)]
struct State {
    claim: Option<ClaimedCompilerRun>,
    active: bool,
    steps: Vec<StoredCompilerStep>,
    advances: Vec<CompilerRunStatus>,
    appended: Vec<Value>,
    materialized: usize,
    materialize_retryable: bool,
    failures: Vec<(String, bool)>,
}
struct FakeRepository(Mutex<State>);

#[async_trait]
impl CompilerRepository for FakeRepository {
    async fn claim(&self, _: &str) -> Result<Option<ClaimedCompilerRun>, CompilerRepositoryError> {
        Ok(self.0.lock().unwrap().claim.take())
    }
    async fn renew_lease(&self, _: &str, _: &str) -> Result<(), CompilerRepositoryError> {
        if self.0.lock().unwrap().active {
            Ok(())
        } else {
            Err(CompilerRepositoryError::permanent("lost"))
        }
    }
    async fn is_active(&self, _: &str, _: &str) -> Result<bool, CompilerRepositoryError> {
        Ok(self.0.lock().unwrap().active)
    }
    async fn load_input(
        &self,
        run: &ClaimedCompilerRun,
    ) -> Result<CompilerInput, CompilerRepositoryError> {
        Ok(CompilerInput {
            run_id: run.id.clone(),
            version_id: run.file_version_id.clone(),
            evidence: DocumentEvidence {
                outline: vec![],
                representative_chunks: vec![],
                compiler_matches: vec!["care_path".into()],
            },
            catalogue: CatalogueSnapshot::default(),
            resources: WorkspaceResources::default(),
            resolutions: run
                .input_snapshot
                .get("resolutions")
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|_| CompilerRepositoryError::permanent("invalid resolutions"))?
                .unwrap_or_default(),
        })
    }
    async fn load_steps(
        &self,
        _: &str,
    ) -> Result<Vec<StoredCompilerStep>, CompilerRepositoryError> {
        Ok(self.0.lock().unwrap().steps.clone())
    }
    async fn append_step(
        &self,
        _: &str,
        _: &str,
        step: Value,
    ) -> Result<StoredCompilerStep, CompilerRepositoryError> {
        self.0.lock().unwrap().appended.push(step);
        Ok(StoredCompilerStep {
            sequence: 1,
            kind: "test".into(),
            status: "completed".into(),
            result: json!({}),
        })
    }
    async fn advance(
        &self,
        _: &str,
        _: &str,
        status: CompilerRunStatus,
    ) -> Result<(), CompilerRepositoryError> {
        self.0.lock().unwrap().advances.push(status);
        Ok(())
    }
    async fn materialize(
        &self,
        _: &str,
        _: &str,
        _: &CompilationOutput,
    ) -> Result<Value, CompilerRepositoryError> {
        let mut state = self.0.lock().unwrap();
        if state.materialize_retryable {
            return Err(CompilerRepositoryError::retryable("timeout"));
        }
        state.materialized += 1;
        Ok(json!({"status":"completed"}))
    }
    async fn fail(
        &self,
        _: &str,
        _: &str,
        code: &str,
        retryable: bool,
    ) -> Result<(), CompilerRepositoryError> {
        self.0
            .lock()
            .unwrap()
            .failures
            .push((code.into(), retryable));
        Ok(())
    }
}

struct FakeExecutor {
    calls: AtomicUsize,
    result: Mutex<Result<CompilationOutput, CompilerError>>,
}
#[async_trait]
impl CompilerExecutor for FakeExecutor {
    async fn compile(
        &self,
        _: &ClaimedCompilerRun,
        _: CompilerInput,
    ) -> Result<(CompilationOutput, Vec<TraceEvent>), (CompilerError, Vec<TraceEvent>)> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.result
            .lock()
            .unwrap()
            .clone()
            .map(|output| (output, vec![]))
            .map_err(|error| (error, vec![]))
    }
}

#[tokio::test]
async fn idle_work_makes_no_compiler_call() {
    let repository = Arc::new(FakeRepository(Mutex::new(State::default())));
    let executor = Arc::new(executor(Ok(CompilationOutput::default())));
    assert_eq!(
        CompilerWorker::new(repository, executor.clone(), "worker")
            .run_once()
            .await
            .unwrap(),
        CompilerRunOutcome::Idle
    );
    assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn successful_work_records_states_and_materializes_once() {
    let repository = Arc::new(repository(true));
    let executor = Arc::new(executor(Ok(CompilationOutput::default())));
    let outcome = CompilerWorker::new(repository.clone(), executor.clone(), "worker")
        .run_once()
        .await
        .unwrap();
    assert_eq!(
        outcome,
        CompilerRunOutcome::Processed {
            run_id: "run-1".into()
        }
    );
    let state = repository.0.lock().unwrap();
    assert_eq!(
        state.advances,
        vec![
            CompilerRunStatus::Compiling,
            CompilerRunStatus::Validating,
            CompilerRunStatus::Materializing
        ]
    );
    assert_eq!(state.materialized, 1);
    assert_eq!(executor.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn retry_resumes_completed_lowering_without_model_work() {
    let repository = Arc::new(repository(true));
    repository.0.lock().unwrap().steps.push(StoredCompilerStep {
        sequence: 1,
        kind: "lower".into(),
        status: "completed".into(),
        result: json!({"output":CompilationOutput::default()}),
    });
    let executor = Arc::new(executor(Err(CompilerError::model("must_not_run"))));
    CompilerWorker::new(repository.clone(), executor.clone(), "worker")
        .run_once()
        .await
        .unwrap();
    assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    assert_eq!(repository.0.lock().unwrap().materialized, 1);
}

#[tokio::test]
async fn records_the_frozen_resolution_before_lowering() {
    let repository = Arc::new(repository(true));
    repository
        .0
        .lock()
        .unwrap()
        .claim
        .as_mut()
        .unwrap()
        .input_snapshot = json!({
        "resolutions": [{
            "resolution_id": "00000000-0000-4000-8000-000000000001",
            "recommendation_id": "HLT-1",
            "capability_key": "clinical.task",
            "adapter_key": "clinical-task-escalate-notify-v1",
            "adapter_version": 1,
            "node_type_id": "escalate.notify",
            "mapping": {"to":"clinician","urgency":"soon"}
        }]
    });
    let executor = Arc::new(executor(Ok(CompilationOutput::default())));

    CompilerWorker::new(repository.clone(), executor, "worker")
        .run_once()
        .await
        .unwrap();

    let state = repository.0.lock().unwrap();
    let resolution = state
        .appended
        .iter()
        .find(|step| step["kind"] == "resolve")
        .expect("resolution trace step");
    assert_eq!(resolution["result"]["resolutions"][0]["adapter_version"], 1);
    assert_eq!(
        resolution["result"]["resolutions"][0]["resolution_id"],
        "00000000-0000-4000-8000-000000000001"
    );
}

#[tokio::test]
async fn cancellation_stops_before_compilation() {
    let repository = Arc::new(repository(false));
    let executor = Arc::new(executor(Ok(CompilationOutput::default())));
    assert_eq!(
        CompilerWorker::new(repository, executor.clone(), "worker")
            .run_once()
            .await
            .unwrap(),
        CompilerRunOutcome::Cancelled {
            run_id: "run-1".into()
        }
    );
    assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn invalid_evidence_fails_permanently_without_drafts() {
    let repository = Arc::new(repository(true));
    let executor = Arc::new(executor(Err(CompilerError::model("evidence_out_of_scope"))));
    let error = CompilerWorker::new(repository.clone(), executor, "worker")
        .run_once()
        .await
        .unwrap_err();
    assert_eq!(error.code(), "evidence_out_of_scope");
    assert!(!error.is_retryable());
    let state = repository.0.lock().unwrap();
    assert_eq!(state.materialized, 0);
    assert_eq!(
        state.failures,
        vec![("evidence_out_of_scope".into(), false)]
    );
}

#[tokio::test]
async fn transient_materialization_waits_for_idempotent_lease_recovery() {
    let repository = Arc::new(repository(true));
    repository.0.lock().unwrap().materialize_retryable = true;
    let executor = Arc::new(executor(Ok(CompilationOutput::default())));
    let error = CompilerWorker::new(repository.clone(), executor, "worker")
        .run_once()
        .await
        .unwrap_err();
    assert_eq!(error.code(), "materialization_retryable");
    assert!(error.is_retryable());
    assert!(repository.0.lock().unwrap().failures.is_empty());
}

fn repository(active: bool) -> FakeRepository {
    FakeRepository(Mutex::new(State {
        claim: Some(ClaimedCompilerRun {
            id: "run-1".into(),
            org_id: "org-1".into(),
            file_version_id: "version-1".into(),
            status: CompilerRunStatus::Planning,
            provider: "minimax".into(),
            model: "model".into(),
            catalogue_digest: "digest".into(),
            input_snapshot: json!({}),
        }),
        active,
        ..Default::default()
    }))
}
fn executor(result: Result<CompilationOutput, CompilerError>) -> FakeExecutor {
    FakeExecutor {
        calls: AtomicUsize::new(0),
        result: Mutex::new(result),
    }
}
