use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use rustvani::vokoo::documents::{
    document_search_router, DocumentMetrics, DocumentSearchService, DocumentWorker,
    GeminiEmbeddingFactory, PostgrestJobRepository, RunOutcome, WorkspaceIntelligenceClassifier,
};
use serde_json::json;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct HttpState {
    metrics: Arc<DocumentMetrics>,
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
    let search = Arc::new(DocumentSearchService::new(
        &supabase_url,
        &service_key,
        embeddings.clone(),
    )?);
    let worker = Arc::new(
        DocumentWorker::new(jobs, embeddings, classifier, worker_id).with_metrics(metrics.clone()),
    );
    let cancellation = CancellationToken::new();

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(render_metrics))
        .with_state(HttpState { metrics })
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
        let delay = match worker.run_once().await {
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
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{name} is required").into())
}

async fn health() -> impl IntoResponse {
    Json(json!({"status": "ok", "worker_processes": 1}))
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
