use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use rustvani::vokoo::documents::{
    EmbedErrorKind, Embedder, EmbeddingProfile, GeminiEmbedder, MAX_EMBEDDING_BATCH,
};
use serde_json::{json, Value};

#[derive(Clone)]
struct FakeState {
    requests: Arc<Mutex<Vec<(HeaderMap, Value)>>>,
    responses: Arc<Mutex<VecDeque<FakeResponse>>>,
}

struct FakeResponse {
    status: StatusCode,
    retry_after: Option<&'static str>,
    body: Value,
    delay: Duration,
}

fn profile() -> EmbeddingProfile {
    EmbeddingProfile {
        id: "gemini-embedding-2-768".into(),
        provider_model_id: "gemini-embedding-2".into(),
        dimensions: 768,
        document_prefix: "title: none | text: {content}".into(),
        query_prefix: "task: search result | query: {content}".into(),
    }
}

fn embeddings(seeds: &[f32], dimensions: usize) -> Value {
    json!({
        "embeddings": seeds
            .iter()
            .map(|seed| json!({"values": vec![seed; dimensions]}))
            .collect::<Vec<_>>()
    })
}

fn success(seeds: &[f32]) -> FakeResponse {
    FakeResponse {
        status: StatusCode::OK,
        retry_after: None,
        body: embeddings(seeds, 768),
        delay: Duration::ZERO,
    }
}

async fn fake_gemini(
    State(state): State<FakeState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    state.requests.lock().unwrap().push((headers, body));
    let response = state.responses.lock().unwrap().pop_front().unwrap();
    if !response.delay.is_zero() {
        tokio::time::sleep(response.delay).await;
    }
    let mut headers = HeaderMap::new();
    if let Some(value) = response.retry_after {
        headers.insert("retry-after", HeaderValue::from_static(value));
    }
    (response.status, headers, Json(response.body)).into_response()
}

async fn serve(responses: Vec<FakeResponse>) -> (String, FakeState, tokio::task::JoinHandle<()>) {
    let state = FakeState {
        requests: Arc::new(Mutex::new(Vec::new())),
        responses: Arc::new(Mutex::new(responses.into())),
    };
    let app = Router::new()
        .route(
            "/v1beta/models/gemini-embedding-2:batchEmbedContents",
            post(fake_gemini),
        )
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}"), state, task)
}

#[tokio::test]
async fn gemini_preserves_order_and_uses_embedding_2_retrieval_prefixes() {
    let (base_url, state, server) = serve(vec![success(&[0.1, 0.2]), success(&[0.3])]).await;
    let embedder = GeminiEmbedder::new("resolved-secret", profile(), base_url).unwrap();

    let documents = embedder
        .embed_documents(&["Alpha".into(), "Beta".into()])
        .await
        .unwrap();
    let query = embedder.embed_query("find escalation").await.unwrap();

    assert_eq!(documents[0][0], 0.1);
    assert_eq!(documents[1][0], 0.2);
    assert_eq!(query[0], 0.3);
    let requests = state.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].0["x-goog-api-key"], "resolved-secret");
    assert_eq!(
        requests[0].1["requests"][0]["model"],
        "models/gemini-embedding-2"
    );
    assert_eq!(requests[0].1["requests"][0]["outputDimensionality"], 768);
    assert_eq!(
        requests[0].1["requests"][0]["content"]["parts"][0]["text"],
        "title: none | text: Alpha"
    );
    assert!(requests[0].1["requests"][0].get("taskType").is_none());
    assert_eq!(
        requests[1].1["requests"][0]["content"]["parts"][0]["text"],
        "task: search result | query: find escalation"
    );
    server.abort();
}

#[tokio::test]
async fn missing_or_wrong_dimension_embeddings_are_permanent() {
    let wrong_dimension = FakeResponse {
        status: StatusCode::OK,
        retry_after: None,
        body: embeddings(&[0.1], 767),
        delay: Duration::ZERO,
    };
    let malformed = FakeResponse {
        status: StatusCode::OK,
        retry_after: None,
        body: json!({"embeddings": "not-an-array"}),
        delay: Duration::ZERO,
    };
    let (base_url, _, server) = serve(vec![wrong_dimension, success(&[]), malformed]).await;
    let embedder = GeminiEmbedder::new("secret", profile(), base_url).unwrap();

    let wrong = embedder.embed_query("query").await.unwrap_err();
    let missing = embedder.embed_query("query").await.unwrap_err();
    let malformed = embedder.embed_query("query").await.unwrap_err();

    assert_eq!(wrong.kind(), EmbedErrorKind::Permanent);
    assert!(wrong.to_string().contains("767 dimensions"));
    assert_eq!(missing.kind(), EmbedErrorKind::Permanent);
    assert!(missing.to_string().contains("0 embeddings for 1 inputs"));
    assert_eq!(malformed.kind(), EmbedErrorKind::Permanent);
    assert!(malformed.to_string().contains("invalid JSON"));
    server.abort();
}

#[tokio::test]
async fn rate_limits_and_server_errors_are_retryable_but_auth_is_permanent() {
    let response = |status, retry_after| FakeResponse {
        status,
        retry_after,
        body: json!({"error": "expected test response"}),
        delay: Duration::ZERO,
    };
    let (base_url, _, server) = serve(vec![
        response(StatusCode::TOO_MANY_REQUESTS, Some("7")),
        response(StatusCode::INTERNAL_SERVER_ERROR, None),
        response(StatusCode::UNAUTHORIZED, None),
    ])
    .await;
    let embedder = GeminiEmbedder::new("secret", profile(), base_url).unwrap();

    let limited = embedder.embed_query("query").await.unwrap_err();
    let unavailable = embedder.embed_query("query").await.unwrap_err();
    let unauthorized = embedder.embed_query("query").await.unwrap_err();

    assert!(limited.is_retryable());
    assert_eq!(limited.retry_after(), Some(Duration::from_secs(7)));
    assert!(unavailable.is_retryable());
    assert_eq!(unauthorized.kind(), EmbedErrorKind::Permanent);
    server.abort();
}

#[tokio::test]
async fn oversized_batches_and_timeouts_are_classified_before_retry() {
    let inputs = vec!["chunk".to_string(); MAX_EMBEDDING_BATCH + 1];
    let unused = GeminiEmbedder::new("secret", profile(), "http://127.0.0.1:1").unwrap();
    let oversized = unused.embed_documents(&inputs).await.unwrap_err();
    assert_eq!(oversized.kind(), EmbedErrorKind::Permanent);

    let delayed = FakeResponse {
        status: StatusCode::OK,
        retry_after: None,
        body: embeddings(&[0.1], 768),
        delay: Duration::from_millis(50),
    };
    let (base_url, _, server) = serve(vec![delayed]).await;
    let embedder =
        GeminiEmbedder::with_timeout("secret", profile(), base_url, Duration::from_millis(5))
            .unwrap();
    let timeout = embedder.embed_query("query").await.unwrap_err();
    assert!(timeout.is_retryable());
    server.abort();
}
