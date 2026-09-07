use std::fmt;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

pub const MAX_EMBEDDING_BATCH: usize = 100;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmbeddingProfile {
    pub id: String,
    pub provider_model_id: String,
    pub dimensions: usize,
    pub document_prefix: String,
    pub query_prefix: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EmbedErrorKind {
    Retryable,
    Permanent,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmbedError {
    kind: EmbedErrorKind,
    message: String,
    retry_after: Option<Duration>,
}

impl EmbedError {
    fn retryable(message: impl Into<String>, retry_after: Option<Duration>) -> Self {
        Self {
            kind: EmbedErrorKind::Retryable,
            message: message.into(),
            retry_after,
        }
    }

    fn permanent(message: impl Into<String>) -> Self {
        Self {
            kind: EmbedErrorKind::Permanent,
            message: message.into(),
            retry_after: None,
        }
    }

    pub fn kind(&self) -> EmbedErrorKind {
        self.kind
    }

    pub fn is_retryable(&self) -> bool {
        self.kind == EmbedErrorKind::Retryable
    }

    pub fn retry_after(&self) -> Option<Duration> {
        self.retry_after
    }
}

impl fmt::Display for EmbedError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for EmbedError {}

#[async_trait]
pub trait Embedder: Send + Sync {
    async fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError>;
    async fn embed_query(&self, query: &str) -> Result<Vec<f32>, EmbedError>;
}

pub struct GeminiEmbedder {
    api_key: String,
    profile: EmbeddingProfile,
    base_url: String,
    client: Client,
}

impl GeminiEmbedder {
    pub fn new(
        api_key: impl Into<String>,
        profile: EmbeddingProfile,
        base_url: impl Into<String>,
    ) -> Result<Self, EmbedError> {
        Self::with_timeout(api_key, profile, base_url, Duration::from_secs(30))
    }

    pub fn with_timeout(
        api_key: impl Into<String>,
        profile: EmbeddingProfile,
        base_url: impl Into<String>,
        timeout: Duration,
    ) -> Result<Self, EmbedError> {
        if profile.dimensions == 0 {
            return Err(EmbedError::permanent(
                "the embedding profile dimensions must be positive",
            ));
        }
        if !profile.document_prefix.contains("{content}")
            || !profile.query_prefix.contains("{content}")
        {
            return Err(EmbedError::permanent(
                "embedding prefixes must contain the {content} placeholder",
            ));
        }
        let client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|error| {
                EmbedError::permanent(format!("could not build Gemini client: {error}"))
            })?;
        Ok(Self {
            api_key: api_key.into(),
            profile,
            base_url: base_url.into().trim_end_matches('/').to_string(),
            client,
        })
    }

    async fn embed(&self, inputs: Vec<String>) -> Result<Vec<Vec<f32>>, EmbedError> {
        if inputs.is_empty() {
            return Ok(Vec::new());
        }
        if inputs.len() > MAX_EMBEDDING_BATCH {
            return Err(EmbedError::permanent(format!(
                "an embedding batch may contain at most {MAX_EMBEDDING_BATCH} inputs"
            )));
        }

        let expected = inputs.len();
        let model = format!("models/{}", self.profile.provider_model_id);
        let requests = inputs
            .into_iter()
            .map(|text| GeminiEmbedRequest {
                model: model.clone(),
                content: GeminiContent {
                    parts: vec![GeminiPart { text }],
                },
                output_dimensionality: self.profile.dimensions,
            })
            .collect();
        let url = format!(
            "{}/v1beta/models/{}:batchEmbedContents",
            self.base_url, self.profile.provider_model_id
        );
        let response = self
            .client
            .post(url)
            .header("x-goog-api-key", &self.api_key)
            .json(&GeminiBatchRequest { requests })
            .send()
            .await
            .map_err(classify_transport_error)?;
        let status = response.status();
        if !status.is_success() {
            let retry_after = parse_retry_after(response.headers());
            return Err(
                if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                    EmbedError::retryable(
                        format!("Gemini embeddings returned {status}"),
                        retry_after,
                    )
                } else {
                    EmbedError::permanent(format!("Gemini embeddings returned {status}"))
                },
            );
        }

        let body = response
            .json::<GeminiBatchResponse>()
            .await
            .map_err(|error| {
                EmbedError::permanent(format!("Gemini returned invalid JSON: {error}"))
            })?;
        validate_embeddings(body.embeddings, expected, self.profile.dimensions)
    }
}

#[async_trait]
impl Embedder for GeminiEmbedder {
    async fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let inputs = texts
            .iter()
            .map(|text| apply_prefix(&self.profile.document_prefix, text))
            .collect();
        self.embed(inputs).await
    }

    async fn embed_query(&self, query: &str) -> Result<Vec<f32>, EmbedError> {
        let input = apply_prefix(&self.profile.query_prefix, query);
        let mut embeddings = self.embed(vec![input]).await?;
        embeddings
            .pop()
            .ok_or_else(|| EmbedError::permanent("Gemini returned no query embedding"))
    }
}

fn apply_prefix(template: &str, content: &str) -> String {
    template.replace("{content}", content)
}

fn classify_transport_error(error: reqwest::Error) -> EmbedError {
    if error.is_timeout() || error.is_connect() {
        EmbedError::retryable(format!("could not reach Gemini embeddings: {error}"), None)
    } else {
        EmbedError::permanent(format!("Gemini embedding request failed: {error}"))
    }
}

fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(Duration::from_secs)
}

fn validate_embeddings(
    embeddings: Vec<GeminiEmbedding>,
    expected: usize,
    dimensions: usize,
) -> Result<Vec<Vec<f32>>, EmbedError> {
    if embeddings.len() != expected {
        return Err(EmbedError::permanent(format!(
            "Gemini returned {} embeddings for {expected} inputs",
            embeddings.len()
        )));
    }
    let mut values = Vec::with_capacity(embeddings.len());
    for (index, embedding) in embeddings.into_iter().enumerate() {
        if embedding.values.len() != dimensions {
            return Err(EmbedError::permanent(format!(
                "Gemini embedding {index} has {} dimensions; expected {dimensions}",
                embedding.values.len()
            )));
        }
        if embedding.values.iter().any(|value| !value.is_finite()) {
            return Err(EmbedError::permanent(format!(
                "Gemini embedding {index} contains a non-finite value"
            )));
        }
        values.push(embedding.values);
    }
    Ok(values)
}

#[derive(Serialize)]
struct GeminiBatchRequest {
    requests: Vec<GeminiEmbedRequest>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiEmbedRequest {
    model: String,
    content: GeminiContent,
    output_dimensionality: usize,
}

#[derive(Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Deserialize)]
struct GeminiBatchResponse {
    embeddings: Vec<GeminiEmbedding>,
}

#[derive(Deserialize)]
struct GeminiEmbedding {
    values: Vec<f32>,
}
