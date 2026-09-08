use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use rustvani::vokoo::compiler::{
    CompilerRunOutcome, CompilerWorker, HarnessCompilerExecutor, OperatorCompilerModelFactory,
    PostgrestCompilerRepository,
};
use rustvani::vokoo::documents::{
    document_search_router, DoclingCommandProvider, DocumentMetrics, DocumentSearchService,
    DocumentWorker, GeminiEmbeddingFactory, ModalDoclingProvider, PostgrestJobRepository,
    RunOutcome, WorkspaceIntelligenceClassifier,
};
use rustvani::vokoo::graph::vendor_secret;
use serde_json::json;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct HttpState {
    metrics: Arc<DocumentMetrics>,
    compiler_enabled: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();
    let supabase_url = required("SUPABASE_URL")?;
    let service_key = required("SUPABASE_SERVICE_ROLE_KEY")?;
    let internal_token = required("VOKOO_INTERNAL_TOKEN")?;
    let gemini_base = std::env::var("GEMINI_BASE_URL")
        .unwrap_or_else(|_| "https://generativelanguage.googleapis.com".into());
    let worker_id = format!(
        "{}-{}",
        std::env::var("HOSTNAME").unwrap_or_else(|_| "vokoo-document-worker".into()),
        std::process::id()
    );

    let jobs = Arc::new(PostgrestJobRepository::new(&supabase_url, &service_key)?);
    let embeddings = Arc::new(GeminiEmbeddingFactory::new(
        &supabase_url,
        &service_key,
        gemini_base,
    ));
    let classifier = Arc::new(WorkspaceIntelligenceClassifier::new(
        &supabase_url,
        &service_key,
    ));
    let metrics = Arc::new(DocumentMetrics::default());
    let compiler_enabled = optional("VOKOO_COMPILER_ENABLED").as_deref() == Some("true");
    let search = Arc::new(DocumentSearchService::new(
        &supabase_url,
        &service_key,
        embeddings.clone(),
    )?);
    let mut worker = DocumentWorker::new(jobs, embeddings, classifier, worker_id.clone())
        .with_metrics(metrics.clone());
    match optional("VOKOO_DOCUMENT_EXTRACTION_PROVIDER").as_deref() {
        None | Some("builtin") => {
            log::info!("[document-worker] using built-in document extraction");
        }
        Some("docling-vps") => {
            let executable = required("VOKOO_DOCLING_PATH")?;
            let staging_dir = required("VOKOO_DOCUMENT_STAGING_DIR")?;
            let expected_version =
                optional("VOKOO_DOCLING_VERSION").unwrap_or_else(|| "1.37.0".into());
            let timeout = parsed_env("VOKOO_DOCLING_TIMEOUT_SECONDS", 300_u64)?;
            let max_output = parsed_env("VOKOO_DOCLING_MAX_OUTPUT_BYTES", 64_usize * 1024 * 1024)?;
            log::info!("[document-worker] using Docling VPS extraction version {expected_version}");
            worker = worker.with_extraction_provider(Arc::new(
                DoclingCommandProvider::new(
                    executable,
                    expected_version,
                    Duration::from_secs(timeout),
                    max_output,
                )
                .with_staging_dir(staging_dir),
            ));
        }
        Some("docling-modal") => {
            let endpoint = required("VOKOO_MODAL_DOCLING_URL")?;
            let bearer_token = vendor_secret(&supabase_url, &service_key, "", "modal")
                .await
                .ok_or("no Modal platform credential is configured")?;
            let expected_version =
                optional("VOKOO_DOCLING_VERSION").unwrap_or_else(|| "1.37.0".into());
            let timeout = parsed_env("VOKOO_DOCLING_TIMEOUT_SECONDS", 600_u64)?;
            let max_output = parsed_env("VOKOO_DOCLING_MAX_OUTPUT_BYTES", 64_usize * 1024 * 1024)?;
            log::info!(
                "[document-worker] using Modal Docling extraction version {expected_version}"
            );
            worker = worker.with_extraction_provider(Arc::new(ModalDoclingProvider::new(
                endpoint,
                bearer_token,
                expected_version,
                Duration::from_secs(timeout),
                max_output,
            )?));
        }
        Some(provider) => {
            return Err(format!(
                "VOKOO_DOCUMENT_EXTRACTION_PROVIDER must be builtin, docling-vps, or docling-modal, got {provider}"
            )
            .into());
        }
    }
    let worker = Arc::new(worker);
    let compiler_worker = if compiler_enabled {
        let repository = Arc::new(PostgrestCompilerRepository::new(
            &supabase_url,
            &service_key,
        )?);
        let factory = Arc::new(OperatorCompilerModelFactory::new(
            &supabase_url,
            &service_key,
        ));
        let executor = Arc::new(HarnessCompilerExecutor::new(
            repository.clone(),
            factory,
            worker_id.clone(),
        ));
        Some(
            CompilerWorker::new(repository, executor, worker_id.clone())
                .with_metrics(metrics.clone()),
        )
    } else {
        None
    };
    let cancellation = CancellationToken::new();

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(render_metrics))
        .with_state(HttpState {
            metrics,
            compiler_enabled,
        })
        .merge(document_search_router(search, internal_token));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8082").await?;
    let server_cancel = cancellation.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(server_cancel.cancelled_owned())
            .await
    });

    let signal_cancel = cancellation.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        signal_cancel.cancel();
    });

    while !cancellation.is_cancelled() {
        let mut delay = match worker.run_once().await {
            Ok(RunOutcome::Idle) => Duration::from_secs(2),
            Ok(RunOutcome::Processed { job_id }) => {
                log::info!("[document-worker] completed job {job_id}");
                Duration::ZERO
            }
            Err(problem) => {
                log::warn!("[document-worker] job failed: {problem}");
                Duration::from_secs(2)
            }
        };
        if let Some(compiler) = &compiler_worker {
            match compiler.run_once().await {
                Ok(CompilerRunOutcome::Idle) => {}
                Ok(CompilerRunOutcome::Processed { run_id }) => {
                    log::info!("[document-worker] completed compiler run {run_id}");
                    delay = Duration::ZERO;
                }
                Ok(CompilerRunOutcome::Cancelled { run_id }) => {
                    log::info!("[document-worker] stopped cancelled compiler run {run_id}")
                }
                Err(problem) => log::warn!("[document-worker] compiler run failed: {problem}"),
            }
        }
        if !delay.is_zero() {
            tokio::select! {
                _ = cancellation.cancelled() => break,
                _ = tokio::time::sleep(delay) => {}
            }
        }
    }

    cancellation.cancel();
    server.await??;
    Ok(())
}

fn required(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    optional(name).ok_or_else(|| format!("{name} is required").into())
}

fn optional(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parsed_env<T>(name: &str, default: T) -> Result<T, Box<dyn std::error::Error>>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    optional(name)
        .map(|value| {
            value
                .parse()
                .map_err(|error| format!("{name} is invalid: {error}").into())
        })
        .unwrap_or(Ok(default))
}

async fn health(State(state): State<HttpState>) -> impl IntoResponse {
    Json(json!({"status": "ok", "worker_processes": 1, "compiler_enabled": state.compiler_enabled}))
}

async fn render_metrics(State(state): State<HttpState>) -> impl IntoResponse {
    state.metrics.render()
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}
