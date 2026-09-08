use std::fmt;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::vokoo::documents::DocumentMetrics;

use super::{
    AisdkCompilerModel, ClaimedCompilerRun, CompilationOutput, CompilerError, CompilerHarness,
    CompilerInput, CompilerModel, CompilerRepository, CompilerRepositoryError, CompilerRunStatus,
    StoredCompilerStep, TraceEvent, TraceSink,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CompilerRunOutcome {
    Idle,
    Processed { run_id: String },
    Cancelled { run_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompilerWorkerError {
    code: String,
    retryable: bool,
}
impl CompilerWorkerError {
    pub fn code(&self) -> &str {
        &self.code
    }
    pub fn is_retryable(&self) -> bool {
        self.retryable
    }
}
impl fmt::Display for CompilerWorkerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code)
    }
}
impl std::error::Error for CompilerWorkerError {}

#[async_trait]
pub trait CompilerExecutor: Send + Sync {
    async fn compile(
        &self,
        run: &ClaimedCompilerRun,
        input: CompilerInput,
    ) -> Result<(CompilationOutput, Vec<TraceEvent>), (CompilerError, Vec<TraceEvent>)>;
}

#[async_trait]
pub trait CompilerModelFactory: Send + Sync {
    async fn create(
        &self,
        run: &ClaimedCompilerRun,
    ) -> Result<Arc<dyn CompilerModel>, CompilerError>;
}

pub struct OperatorCompilerModelFactory {
    supabase_url: String,
    service_key: String,
}

impl OperatorCompilerModelFactory {
    pub fn new(supabase_url: impl Into<String>, service_key: impl Into<String>) -> Self {
        Self {
            supabase_url: supabase_url.into(),
            service_key: service_key.into(),
        }
    }
}

#[async_trait]
impl CompilerModelFactory for OperatorCompilerModelFactory {
    async fn create(
        &self,
        run: &ClaimedCompilerRun,
    ) -> Result<Arc<dyn CompilerModel>, CompilerError> {
        let secret = crate::vokoo::graph::vendor_secret(
            &self.supabase_url,
            &self.service_key,
            &run.org_id,
            &run.provider,
        )
        .await
        .ok_or_else(|| CompilerError::model("compiler_provider_secret_missing"))?;
        Ok(Arc::new(AisdkCompilerModel::new(
            &run.provider,
            &run.model,
            secret,
        )?))
    }
}

pub struct HarnessCompilerExecutor<R, F> {
    repository: Arc<R>,
    factory: Arc<F>,
    worker_id: String,
}
impl<R, F> HarnessCompilerExecutor<R, F> {
    pub fn new(repository: Arc<R>, factory: Arc<F>, worker_id: impl Into<String>) -> Self {
        Self {
            repository,
            factory,
            worker_id: worker_id.into(),
        }
    }
}

#[derive(Default)]
struct CollectedTrace(Mutex<Vec<TraceEvent>>);
impl TraceSink for CollectedTrace {
    fn emit(&self, event: TraceEvent) {
        self.0
            .lock()
            .expect("compiler trace lock poisoned")
            .push(event);
    }
}

struct GuardedModel<'a, R> {
    repository: &'a R,
    inner: Arc<dyn CompilerModel>,
    run_id: &'a str,
    worker_id: &'a str,
}
#[async_trait]
impl<R: CompilerRepository> CompilerModel for GuardedModel<'_, R> {
    async fn call(
        &self,
        request: super::ModelRequest,
    ) -> Result<super::ModelResponse, CompilerError> {
        if !self
            .repository
            .is_active(self.run_id, self.worker_id)
            .await
            .map_err(repository_compiler_error)?
        {
            return Err(CompilerError::model("compiler_cancelled"));
        }
        self.repository
            .renew_lease(self.run_id, self.worker_id)
            .await
            .map_err(repository_compiler_error)?;
        self.inner.call(request).await
    }
}

#[async_trait]
impl<R, F> CompilerExecutor for HarnessCompilerExecutor<R, F>
where
    R: CompilerRepository + 'static,
    F: CompilerModelFactory + 'static,
{
    async fn compile(
        &self,
        run: &ClaimedCompilerRun,
        input: CompilerInput,
    ) -> Result<(CompilationOutput, Vec<TraceEvent>), (CompilerError, Vec<TraceEvent>)> {
        let inner = self
            .factory
            .create(run)
            .await
            .map_err(|error| (error, vec![]))?;
        let guarded = GuardedModel {
            repository: self.repository.as_ref(),
            inner,
            run_id: &run.id,
            worker_id: &self.worker_id,
        };
        let trace = CollectedTrace::default();
        let result = CompilerHarness::new(&guarded, &trace).compile(input).await;
        let events = trace.0.into_inner().expect("compiler trace lock poisoned");
        result
            .map(|output| (output, events.clone()))
            .map_err(|error| (error, events))
    }
}

pub struct CompilerWorker<R, E> {
    repository: Arc<R>,
    executor: Arc<E>,
    worker_id: String,
    metrics: Option<Arc<DocumentMetrics>>,
}
impl<R, E> CompilerWorker<R, E> {
    pub fn new(repository: Arc<R>, executor: Arc<E>, worker_id: impl Into<String>) -> Self {
        Self {
            repository,
            executor,
            worker_id: worker_id.into(),
            metrics: None,
        }
    }

    pub fn with_metrics(mut self, metrics: Arc<DocumentMetrics>) -> Self {
        self.metrics = Some(metrics);
        self
    }
}

impl<R, E> CompilerWorker<R, E>
where
    R: CompilerRepository + 'static,
    E: CompilerExecutor + 'static,
{
    pub async fn run_once(&self) -> Result<CompilerRunOutcome, CompilerWorkerError> {
        let run = self
            .repository
            .claim(&self.worker_id)
            .await
            .map_err(worker_repository_error)?;
        let Some(run) = run else {
            return Ok(CompilerRunOutcome::Idle);
        };
        match self.process(&run).await {
            Ok(()) => {
                if let Some(metrics) = &self.metrics {
                    metrics.compiler_run("completed");
                }
                Ok(CompilerRunOutcome::Processed { run_id: run.id })
            }
            Err(error) if error.code() == "compiler_cancelled" => {
                if let Some(metrics) = &self.metrics {
                    metrics.compiler_run("cancelled");
                }
                Ok(CompilerRunOutcome::Cancelled { run_id: run.id })
            }
            Err(error) if error.code() == "materialization_retryable" => Err(error),
            Err(error) => {
                if self
                    .repository
                    .is_active(&run.id, &self.worker_id)
                    .await
                    .unwrap_or(false)
                {
                    self.repository
                        .fail(&run.id, &self.worker_id, error.code(), error.retryable)
                        .await
                        .map_err(worker_repository_error)?;
                }
                Err(error)
            }
        }
    }

    async fn process(&self, run: &ClaimedCompilerRun) -> Result<(), CompilerWorkerError> {
        if !self
            .repository
            .is_active(&run.id, &self.worker_id)
            .await
            .map_err(worker_repository_error)?
        {
            return Err(worker_error("compiler_cancelled", false));
        }
        let steps = self
            .repository
            .load_steps(&run.id)
            .await
            .map_err(worker_repository_error)?;
        self.repository
            .advance(&run.id, &self.worker_id, CompilerRunStatus::Compiling)
            .await
            .map_err(worker_repository_error)?;
        let output = resume_output(&steps)
            .transpose()
            .map_err(|_| worker_error("invalid_resumable_output", false))?;
        let output = if let Some(output) = output {
            output
        } else {
            let input = self
                .repository
                .load_input(run)
                .await
                .map_err(worker_repository_error)?;
            let (output, traces) = match self.executor.compile(run, input).await {
                Ok(result) => result,
                Err((error, traces)) => {
                    if self
                        .repository
                        .is_active(&run.id, &self.worker_id)
                        .await
                        .unwrap_or(false)
                    {
                        for event in traces {
                            self.repository
                                .append_step(&run.id, &self.worker_id, trace_step(event))
                                .await
                                .map_err(worker_repository_error)?;
                        }
                    }
                    return Err(worker_compiler_error(error));
                }
            };
            for event in traces {
                if let Some(metrics) = &self.metrics {
                    let phase = match event.phase {
                        super::ModelPhase::Supervising => "supervising",
                        super::ModelPhase::Compiling => "compiling",
                        super::ModelPhase::Reconciling => "reconciling",
                        super::ModelPhase::Finishing => "finishing",
                    };
                    metrics.compiler_model_step(
                        phase,
                        event.duration_ms,
                        event.usage.input_tokens,
                        event.usage.output_tokens,
                    );
                }
                self.repository
                    .append_step(&run.id, &self.worker_id, trace_step(event))
                    .await
                    .map_err(worker_repository_error)?;
            }
            self.repository.append_step(&run.id,&self.worker_id,json!({"kind":"lower","status":"completed","task_key":"compiler-output","input_refs":{},"result":{"output":output}})).await.map_err(worker_repository_error)?;
            output
        };
        self.repository
            .renew_lease(&run.id, &self.worker_id)
            .await
            .map_err(worker_repository_error)?;
        self.repository
            .advance(&run.id, &self.worker_id, CompilerRunStatus::Validating)
            .await
            .map_err(worker_repository_error)?;
        self.repository.append_step(&run.id,&self.worker_id,json!({"kind":"validate","status":"completed","task_key":"deterministic-validation","input_refs":{},"result":{"agent_count":output.agents.len(),"flow_count":output.flows.len(),"gap_count":output.gaps.len()}})).await.map_err(worker_repository_error)?;
        self.repository
            .renew_lease(&run.id, &self.worker_id)
            .await
            .map_err(worker_repository_error)?;
        self.repository
            .advance(&run.id, &self.worker_id, CompilerRunStatus::Materializing)
            .await
            .map_err(worker_repository_error)?;
        self.repository
            .materialize(&run.id, &self.worker_id, &output)
            .await
            .map_err(|error| {
                if error.is_retryable() {
                    worker_error("materialization_retryable", true)
                } else {
                    worker_repository_error(error)
                }
            })?;
        Ok(())
    }
}

fn resume_output(
    steps: &[StoredCompilerStep],
) -> Option<Result<CompilationOutput, serde_json::Error>> {
    steps
        .iter()
        .rev()
        .find(|step| step.kind == "lower" && step.status == "completed")
        .and_then(|step| step.result.get("output").cloned())
        .map(serde_json::from_value)
}
fn trace_step(event: TraceEvent) -> Value {
    json!({"kind":match event.phase { super::ModelPhase::Supervising=>"plan",super::ModelPhase::Compiling=>"extract",super::ModelPhase::Reconciling=>"reconcile",super::ModelPhase::Finishing=>"reconcile"},"status":if event.status=="accepted"{"completed"}else{"failed"},"task_key":event.task_id,"page_start":event.page_start,"page_end":event.page_end,"input_refs":{"chunk_ids":event.chunk_ids},"result":{"tool":event.tool_name,"summary":event.summary},"input_tokens":event.usage.input_tokens,"output_tokens":event.usage.output_tokens,"duration_ms":event.duration_ms,"error_code":event.error_code})
}
fn repository_compiler_error(error: CompilerRepositoryError) -> CompilerError {
    CompilerError::new(
        if error.is_retryable() {
            "compiler_repository_retryable"
        } else {
            "compiler_lease_lost"
        },
        error.to_string(),
    )
}
fn worker_repository_error(error: CompilerRepositoryError) -> CompilerWorkerError {
    worker_error(
        if error.is_retryable() {
            "compiler_repository_retryable"
        } else {
            "compiler_repository_permanent"
        },
        error.is_retryable(),
    )
}
fn worker_compiler_error(error: CompilerError) -> CompilerWorkerError {
    let retryable = matches!(
        error.code(),
        "provider_request_failed" | "compiler_repository_retryable"
    );
    worker_error(error.code(), retryable)
}
fn worker_error(code: impl Into<String>, retryable: bool) -> CompilerWorkerError {
    CompilerWorkerError {
        code: code.into(),
        retryable,
    }
}
