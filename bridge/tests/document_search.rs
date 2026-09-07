use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::body::to_bytes;
use axum::extract::{Request, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::{Json, Router};
use rustvani::vokoo::documents::{
    document_search_router, DocumentSearchRequest, DocumentSearchResponse, DocumentSearchService,
    DocumentSearcher, EmbedError, Embedder, EmbeddingFactory, EmbeddingProfile,
    HistoricalDocumentVersion, SearchError, WorkerError,
};
use serde_json::{json, Value};

const ORG_ID: &str = "00000000-0000-0000-0000-000000000010";
const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000020";

#[derive(Clone, Debug)]
struct RecordedRequest {
    method: Method,
    path: String,
    query: Option<String>,
    body: Option<Value>,
}

#[derive(Clone, Default)]
struct PostgrestState {
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
    fail_rpc: bool,
}

async fn fake_postgrest(State(state): State<PostgrestState>, request: Request) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let query = request.uri().query().map(str::to_string);
    let bytes = to_bytes(request.into_body(), usize::MAX).await.unwrap();
    let body = (!bytes.is_empty()).then(|| serde_json::from_slice(&bytes).unwrap());
    state.requests.lock().unwrap().push(RecordedRequest {
        method,
        path: path.clone(),
        query,
        body,
    });

    match path.as_str() {
        "/rest/v1/organizations" => Json(json!([{
            "embedding_profile_id": "gemini-embedding-2-768"
        }]))
        .into_response(),
        "/rest/v1/embedding_profiles" => Json(json!([{
            "id": "gemini-embedding-2-768",
            "provider_model_id": "gemini-embedding-2",
            "dimensions": 768,
            "document_prefix": "title: none | text: {content}",
            "query_prefix": "task: search result | query: {content}"
        }]))
        .into_response(),
        "/rest/v1/rpc/search_document_chunks" if state.fail_rpc => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"message": "database unavailable"})),
        )
            .into_response(),
        "/rest/v1/rpc/search_document_chunks" => Json(search_response()).into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_postgrest(fail_rpc: bool) -> (String, PostgrestState, tokio::task::JoinHandle<()>) {
    let state = PostgrestState {
        fail_rpc,
        ..Default::default()
    };
    let app = Router::new()
        .fallback(any(fake_postgrest))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), state, task)
}

fn search_response() -> Value {
    json!({
        "results": [{
            "chunk_id": "00000000-0000-0000-0000-000000000030",
            "document_id": DOCUMENT_ID,
            "document_name": "NICE guideline",
            "version_id": "00000000-0000-0000-0000-000000000040",
            "version": 2,
            "ordinal": 4,
            "page_start": 8,
            "page_end": 9,
            "section_path": ["Treatment", "Escalation"],
            "text": "Escalate treatment when the target is not met.",
            "semantic_score": 0.91,
            "lexical_score": 0.42,
            "fused_score": 0.032
        }],
        "unavailable_current_documents": 1,
        "embedding_profile_id": "gemini-embedding-2-768"
    })
}

struct FakeEmbedder {
    dimensions: usize,
    queries: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl Embedder for FakeEmbedder {
    async fn embed_documents(&self, _texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        unreachable!("search embeds queries only")
    }

    async fn embed_query(&self, query: &str) -> Result<Vec<f32>, EmbedError> {
        self.queries.lock().unwrap().push(query.to_string());
        Ok(vec![0.25; self.dimensions])
    }
}

struct FakeFactory {
    dimensions: usize,
    queries: Arc<Mutex<Vec<String>>>,
    profiles: Arc<Mutex<Vec<(String, EmbeddingProfile)>>>,
}

impl FakeFactory {
    fn new(dimensions: usize) -> Self {
        Self {
            dimensions,
            queries: Arc::default(),
            profiles: Arc::default(),
        }
    }
}

#[async_trait]
impl EmbeddingFactory for FakeFactory {
    async fn create(
        &self,
        org_id: &str,
        profile: &EmbeddingProfile,
    ) -> Result<Arc<dyn Embedder>, WorkerError> {
        self.profiles
            .lock()
            .unwrap()
            .push((org_id.to_string(), profile.clone()));
        Ok(Arc::new(FakeEmbedder {
            dimensions: self.dimensions,
            queries: self.queries.clone(),
        }))
    }
}

fn current_request() -> DocumentSearchRequest {
    DocumentSearchRequest {
        query: " HbA1c escalation ".into(),
        limit: 7,
        document_ids: Some(vec![DOCUMENT_ID.into()]),
        historical: None,
    }
}

#[tokio::test]
async fn search_embeds_query_and_forwards_current_scope_with_provenance() {
    let (base_url, state, server) = serve_postgrest(false).await;
    let factory = Arc::new(FakeFactory::new(768));
    let service = DocumentSearchService::new(&base_url, "service-key", factory.clone()).unwrap();

    let response = service.search(ORG_ID, &current_request()).await.unwrap();

    assert_eq!(response.results.len(), 1);
    assert_eq!(response.results[0].document_name, "NICE guideline");
    assert_eq!(response.results[0].page_start, Some(8));
    assert_eq!(response.results[0].section_path[1], "Escalation");
    assert_eq!(response.unavailable_current_documents, 1);
    assert_eq!(
        factory.queries.lock().unwrap().as_slice(),
        ["HbA1c escalation"]
    );
    let profiles = factory.profiles.lock().unwrap();
    assert_eq!(profiles[0].0, ORG_ID);
    assert_eq!(profiles[0].1.dimensions, 768);
    assert_eq!(
        profiles[0].1.query_prefix,
        "task: search result | query: {content}"
    );

    let requests = state.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].method, Method::GET);
    assert!(requests[0].query.as_deref().unwrap().contains(ORG_ID));
    assert_eq!(requests[2].method, Method::POST);
    assert_eq!(requests[2].path, "/rest/v1/rpc/search_document_chunks");
    let body = requests[2].body.as_ref().unwrap();
    assert_eq!(body["p_org_id"], ORG_ID);
    assert_eq!(body["p_query"], "HbA1c escalation");
    assert_eq!(body["p_limit"], 7);
    assert_eq!(body["p_document_ids"][0], DOCUMENT_ID);
    assert!(body["p_historical"].is_null());
    assert_eq!(
        body["p_query_embedding"]
            .as_str()
            .unwrap()
            .matches(',')
            .count(),
        767
    );
    server.abort();
}

#[tokio::test]
async fn historical_search_forwards_only_explicit_document_version_pairs() {
    let (base_url, state, server) = serve_postgrest(false).await;
    let service =
        DocumentSearchService::new(&base_url, "service-key", Arc::new(FakeFactory::new(768)))
            .unwrap();
    let request = DocumentSearchRequest {
        query: "older recommendation".into(),
        limit: 10,
        document_ids: None,
        historical: Some(vec![HistoricalDocumentVersion {
            document_id: DOCUMENT_ID.into(),
            version: 1,
        }]),
    };

    service.search(ORG_ID, &request).await.unwrap();

    let requests = state.requests.lock().unwrap();
    let body = requests.last().unwrap().body.as_ref().unwrap();
    assert!(body["p_document_ids"].is_null());
    assert_eq!(body["p_historical"][0]["document_id"], DOCUMENT_ID);
    assert_eq!(body["p_historical"][0]["version"], 1);
    server.abort();
}

#[tokio::test]
async fn invalid_filters_and_wrong_dimensions_never_reach_the_search_rpc() {
    let (base_url, state, server) = serve_postgrest(false).await;
    let service =
        DocumentSearchService::new(&base_url, "service-key", Arc::new(FakeFactory::new(767)))
            .unwrap();
    let mut conflicting = current_request();
    conflicting.historical = Some(vec![HistoricalDocumentVersion {
        document_id: DOCUMENT_ID.into(),
        version: 1,
    }]);

    assert!(matches!(
        service.search(ORG_ID, &conflicting).await.unwrap_err(),
        SearchError::BadRequest(_)
    ));
    assert!(state.requests.lock().unwrap().is_empty());

    let dimensions = service
        .search(ORG_ID, &current_request())
        .await
        .unwrap_err();
    assert!(matches!(dimensions, SearchError::Unavailable(_)));
    assert!(dimensions.to_string().contains("767 dimensions"));
    assert!(state
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|request| request.path != "/rest/v1/rpc/search_document_chunks"));
    server.abort();
}

#[tokio::test]
async fn database_failure_is_reported_as_unavailable() {
    let (base_url, _, server) = serve_postgrest(true).await;
    let service =
        DocumentSearchService::new(&base_url, "service-key", Arc::new(FakeFactory::new(768)))
            .unwrap();

    let error = service
        .search(ORG_ID, &current_request())
        .await
        .unwrap_err();

    assert!(matches!(error, SearchError::Unavailable(_)));
    assert!(error.to_string().contains("500"));
    server.abort();
}

#[derive(Default)]
struct FakeSearcher(Mutex<Vec<(String, DocumentSearchRequest)>>);

#[async_trait]
impl DocumentSearcher for FakeSearcher {
    async fn search(
        &self,
        org_id: &str,
        request: &DocumentSearchRequest,
    ) -> Result<DocumentSearchResponse, SearchError> {
        self.0
            .lock()
            .unwrap()
            .push((org_id.to_string(), request.clone()));
        Ok(serde_json::from_value(search_response()).unwrap())
    }
}

#[tokio::test]
async fn internal_endpoint_requires_token_and_trusted_org_header() {
    let searcher = Arc::new(FakeSearcher::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = document_search_router(searcher.clone(), "internal-secret");
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let url = format!("http://{address}/documents/search");

    let forbidden = client
        .post(&url)
        .json(&current_request())
        .send()
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    let missing_org = client
        .post(&url)
        .header("x-vokoo-internal-token", "internal-secret")
        .json(&current_request())
        .send()
        .await
        .unwrap();
    assert_eq!(missing_org.status(), StatusCode::BAD_REQUEST);
    let accepted = client
        .post(&url)
        .header("x-vokoo-internal-token", "internal-secret")
        .header("x-vokoo-org-id", ORG_ID)
        .json(&current_request())
        .send()
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);
    assert_eq!(searcher.0.lock().unwrap().as_slice()[0].0, ORG_ID);
    server.abort();
}
