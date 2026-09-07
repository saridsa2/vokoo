use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{EmbeddingFactory, EmbeddingProfile};

fn default_limit() -> usize {
    10
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HistoricalDocumentVersion {
    pub document_id: String,
    pub version: i32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DocumentSearchRequest {
    pub query: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub document_ids: Option<Vec<String>>,
    #[serde(default)]
    pub historical: Option<Vec<HistoricalDocumentVersion>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DocumentSearchResult {
    pub chunk_id: String,
    pub document_id: String,
    pub document_name: String,
    pub version_id: String,
    pub version: i32,
    pub ordinal: usize,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub section_path: Vec<String>,
    pub text: String,
    pub semantic_score: Option<f64>,
    pub lexical_score: Option<f64>,
    pub fused_score: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DocumentSearchResponse {
    pub results: Vec<DocumentSearchResult>,
    pub unavailable_current_documents: usize,
    pub embedding_profile_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SearchError {
    Forbidden,
    BadRequest(String),
    Unavailable(String),
}

impl fmt::Display for SearchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("forbidden"),
            Self::BadRequest(message) | Self::Unavailable(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for SearchError {}

#[async_trait]
pub trait DocumentSearcher: Send + Sync {
    async fn search(
        &self,
        org_id: &str,
        request: &DocumentSearchRequest,
    ) -> Result<DocumentSearchResponse, SearchError>;
}

pub struct DocumentSearchService {
    base_url: String,
    service_key: String,
    client: Client,
    embeddings: Arc<dyn EmbeddingFactory>,
}

impl DocumentSearchService {
    pub fn new(
        base_url: impl Into<String>,
        service_key: impl Into<String>,
        embeddings: Arc<dyn EmbeddingFactory>,
    ) -> Result<Self, SearchError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| {
                SearchError::Unavailable(format!("could not build search client: {error}"))
            })?;
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            service_key: service_key.into(),
            client,
            embeddings,
        })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}/rest/v1/{path}", self.base_url))
            .header("apikey", &self.service_key)
            .header("Authorization", format!("Bearer {}", self.service_key))
    }

    async fn profile(&self, org_id: &str) -> Result<EmbeddingProfile, SearchError> {
        let organizations = self
            .request(reqwest::Method::GET, "organizations")
            .query(&[
                ("select", "embedding_profile_id".to_string()),
                ("id", format!("eq.{org_id}")),
                ("limit", "1".to_string()),
            ])
            .send()
            .await
            .map_err(transport)?;
        let organizations = checked(organizations).await?;
        let organizations: Vec<Value> = organizations.json().await.map_err(|error| {
            SearchError::Unavailable(format!("invalid organization profile: {error}"))
        })?;
        let profile_id = organizations
            .first()
            .and_then(|row| row["embedding_profile_id"].as_str())
            .ok_or_else(|| {
                SearchError::BadRequest("organization embedding profile not found".into())
            })?;

        let profiles = self
            .request(reqwest::Method::GET, "embedding_profiles")
            .query(&[
                (
                    "select",
                    "id,provider_model_id,dimensions,document_prefix,query_prefix".to_string(),
                ),
                ("id", format!("eq.{profile_id}")),
                ("is_active", "eq.true".to_string()),
                ("limit", "1".to_string()),
            ])
            .send()
            .await
            .map_err(transport)?;
        let profiles = checked(profiles).await?;
        let mut profiles: Vec<ProfileRow> = profiles.json().await.map_err(|error| {
            SearchError::Unavailable(format!("invalid embedding profile: {error}"))
        })?;
        profiles
            .pop()
            .map(Into::into)
            .ok_or_else(|| SearchError::BadRequest("active embedding profile not found".into()))
    }
}

#[async_trait]
impl DocumentSearcher for DocumentSearchService {
    async fn search(
        &self,
        org_id: &str,
        request: &DocumentSearchRequest,
    ) -> Result<DocumentSearchResponse, SearchError> {
        validate_request(org_id, request)?;
        let profile = self.profile(org_id).await?;
        let embedder = self
            .embeddings
            .create(org_id, &profile)
            .await
            .map_err(|error| SearchError::Unavailable(error.to_string()))?;
        let vector = embedder
            .embed_query(request.query.trim())
            .await
            .map_err(|error| SearchError::Unavailable(error.to_string()))?;
        if vector.len() != profile.dimensions || vector.len() != 768 {
            return Err(SearchError::Unavailable(format!(
                "query embedding has {} dimensions; expected 768",
                vector.len()
            )));
        }
        if vector.iter().any(|value| !value.is_finite()) {
            return Err(SearchError::Unavailable(
                "query embedding contains a non-finite value".into(),
            ));
        }

        let response = self
            .request(reqwest::Method::POST, "rpc/search_document_chunks")
            .json(&json!({
                "p_org_id": org_id,
                "p_query": request.query.trim(),
                "p_query_embedding": vector_literal(&vector),
                "p_limit": request.limit,
                "p_document_ids": request.document_ids,
                "p_historical": request.historical,
            }))
            .send()
            .await
            .map_err(transport)?;
        checked(response)
            .await?
            .json()
            .await
            .map_err(|error| SearchError::Unavailable(format!("invalid search response: {error}")))
    }
}

fn validate_request(org_id: &str, request: &DocumentSearchRequest) -> Result<(), SearchError> {
    if uuid::Uuid::parse_str(org_id).is_err() {
        return Err(SearchError::BadRequest("organization id is invalid".into()));
    }
    if request.query.trim().is_empty() {
        return Err(SearchError::BadRequest("search query is required".into()));
    }
    if !(1..=50).contains(&request.limit) {
        return Err(SearchError::BadRequest(
            "search limit must be between 1 and 50".into(),
        ));
    }
    if request.document_ids.is_some() && request.historical.is_some() {
        return Err(SearchError::BadRequest(
            "current and historical filters cannot be combined".into(),
        ));
    }
    if let Some(ids) = &request.document_ids {
        if ids.iter().any(|id| uuid::Uuid::parse_str(id).is_err()) {
            return Err(SearchError::BadRequest("document id is invalid".into()));
        }
    }
    if let Some(history) = &request.historical {
        if history.is_empty()
            || history
                .iter()
                .any(|item| item.version < 1 || uuid::Uuid::parse_str(&item.document_id).is_err())
        {
            return Err(SearchError::BadRequest(
                "historical search requires valid document and version pairs".into(),
            ));
        }
    }
    Ok(())
}

async fn checked(response: reqwest::Response) -> Result<reqwest::Response, SearchError> {
    if response.status().is_success() {
        Ok(response)
    } else if response.status().is_client_error() {
        Err(SearchError::BadRequest(format!(
            "document search returned {}",
            response.status()
        )))
    } else {
        Err(SearchError::Unavailable(format!(
            "document search returned {}",
            response.status()
        )))
    }
}

fn transport(error: reqwest::Error) -> SearchError {
    SearchError::Unavailable(format!("could not reach document search: {error}"))
}

fn vector_literal(values: &[f32]) -> String {
    let values = values
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    format!("[{values}]")
}

#[derive(Deserialize)]
struct ProfileRow {
    id: String,
    provider_model_id: String,
    dimensions: usize,
    document_prefix: String,
    query_prefix: String,
}

impl From<ProfileRow> for EmbeddingProfile {
    fn from(row: ProfileRow) -> Self {
        Self {
            id: row.id,
            provider_model_id: row.provider_model_id,
            dimensions: row.dimensions,
            document_prefix: row.document_prefix,
            query_prefix: row.query_prefix,
        }
    }
}

#[derive(Clone)]
struct SearchHttpState {
    searcher: Arc<dyn DocumentSearcher>,
    internal_token: Arc<String>,
}

pub fn document_search_router(
    searcher: Arc<dyn DocumentSearcher>,
    internal_token: impl Into<String>,
) -> Router {
    Router::new()
        .route("/documents/search", post(search_handler))
        .with_state(SearchHttpState {
            searcher,
            internal_token: Arc::new(internal_token.into()),
        })
}

async fn search_handler(
    State(state): State<SearchHttpState>,
    headers: HeaderMap,
    Json(request): Json<DocumentSearchRequest>,
) -> Response {
    let presented = headers
        .get("x-vokoo-internal-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if presented != state.internal_token.as_str() || state.internal_token.is_empty() {
        return error_response(SearchError::Forbidden);
    }
    let Some(org_id) = headers
        .get("x-vokoo-org-id")
        .and_then(|value| value.to_str().ok())
    else {
        return error_response(SearchError::BadRequest("x-vokoo-org-id is required".into()));
    };
    match state.searcher.search(org_id, &request).await {
        Ok(result) => (StatusCode::OK, Json(json!(result))).into_response(),
        Err(problem) => error_response(problem),
    }
}

fn error_response(problem: SearchError) -> Response {
    let status = match &problem {
        SearchError::Forbidden => StatusCode::FORBIDDEN,
        SearchError::BadRequest(_) => StatusCode::BAD_REQUEST,
        SearchError::Unavailable(_) => StatusCode::BAD_GATEWAY,
    };
    (status, Json(json!({"error": problem.to_string()}))).into_response()
}
