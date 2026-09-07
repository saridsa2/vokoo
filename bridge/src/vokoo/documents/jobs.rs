use std::collections::HashSet;
use std::fmt;

use async_trait::async_trait;
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{DocumentChunk, EmbeddingProfile};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStage {
    Queued,
    Extracting,
    Chunking,
    Embedding,
    Classifying,
    Ready,
    RetryableFailed,
    PermanentFailed,
}

impl JobStage {
    fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Extracting => "extracting",
            Self::Chunking => "chunking",
            Self::Embedding => "embedding",
            Self::Classifying => "classifying",
            Self::Ready => "ready",
            Self::RetryableFailed => "retryable_failed",
            Self::PermanentFailed => "permanent_failed",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClaimedJob {
    pub id: String,
    pub org_id: String,
    pub file_id: String,
    pub file_version_id: String,
    pub chunker_version: String,
    pub embedding_profile_id: String,
    pub stage: JobStage,
    pub attempt_count: i32,
    pub max_attempts: i32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentSource {
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub extracted_text: Option<String>,
    pub profile: EmbeddingProfile,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PersistedChunk {
    pub id: String,
    pub ordinal: usize,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub section_path: Vec<String>,
    pub content: String,
    pub token_count: usize,
    pub content_sha256: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChunkEmbedding {
    pub chunk_id: String,
    pub values: Vec<f32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobFailure {
    pub code: String,
    pub detail: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryError {
    message: String,
    retryable: bool,
}

impl RepositoryError {
    pub fn retryable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: true,
        }
    }

    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }

    pub fn is_retryable(&self) -> bool {
        self.retryable
    }
}

impl fmt::Display for RepositoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RepositoryError {}

#[async_trait]
pub trait JobRepository: Send + Sync {
    async fn claim(&self, worker_id: &str) -> Result<Option<ClaimedJob>, RepositoryError>;
    async fn renew_lease(&self, job_id: &str, worker_id: &str) -> Result<(), RepositoryError>;
    async fn load_source(&self, job: &ClaimedJob) -> Result<DocumentSource, RepositoryError>;
    async fn advance(
        &self,
        job_id: &str,
        worker_id: &str,
        stage: JobStage,
    ) -> Result<(), RepositoryError>;
    async fn store_extraction(&self, job: &ClaimedJob, text: &str) -> Result<(), RepositoryError>;
    async fn upsert_chunks(
        &self,
        job: &ClaimedJob,
        chunks: &[DocumentChunk],
    ) -> Result<Vec<PersistedChunk>, RepositoryError>;
    async fn missing_chunks(
        &self,
        job: &ClaimedJob,
        chunks: &[PersistedChunk],
    ) -> Result<Vec<PersistedChunk>, RepositoryError>;
    async fn upsert_embeddings(
        &self,
        job: &ClaimedJob,
        embeddings: &[ChunkEmbedding],
    ) -> Result<(), RepositoryError>;
    async fn complete(
        &self,
        job: &ClaimedJob,
        worker_id: &str,
        intelligence: &Value,
    ) -> Result<(), RepositoryError>;
    async fn fail(
        &self,
        job: &ClaimedJob,
        worker_id: &str,
        failure: &JobFailure,
    ) -> Result<(), RepositoryError>;
}

pub struct PostgrestJobRepository {
    base_url: String,
    service_key: String,
    client: Client,
    lease_seconds: u64,
}

impl PostgrestJobRepository {
    pub fn new(
        base_url: impl Into<String>,
        service_key: impl Into<String>,
    ) -> Result<Self, RepositoryError> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| RepositoryError::permanent(error.to_string()))?;
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            service_key: service_key.into(),
            client,
            lease_seconds: 300,
        })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}/rest/v1/{path}", self.base_url))
            .header("apikey", &self.service_key)
            .header("Authorization", format!("Bearer {}", self.service_key))
    }

    async fn rpc(&self, name: &str, body: Value) -> Result<Response, RepositoryError> {
        checked(self.request(reqwest::Method::POST, &format!("rpc/{name}")))
            .json(&body)
            .send()
            .await
    }
}

fn checked(request: reqwest::RequestBuilder) -> CheckedRequest {
    CheckedRequest(request)
}

struct CheckedRequest(reqwest::RequestBuilder);

impl CheckedRequest {
    fn json(self, value: &Value) -> Self {
        Self(self.0.json(value))
    }

    async fn send(self) -> Result<Response, RepositoryError> {
        let response = self.0.send().await.map_err(|error| {
            RepositoryError::retryable(format!("document database request failed: {error}"))
        })?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let error = format!("document database returned {status}");
        Err(
            if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
                RepositoryError::retryable(error)
            } else {
                RepositoryError::permanent(error)
            },
        )
    }
}

#[async_trait]
impl JobRepository for PostgrestJobRepository {
    async fn claim(&self, worker_id: &str) -> Result<Option<ClaimedJob>, RepositoryError> {
        self.rpc(
            "claim_document_ingestion",
            json!({"p_worker": worker_id, "p_lease_seconds": self.lease_seconds}),
        )
        .await?
        .json()
        .await
        .map_err(|error| RepositoryError::permanent(format!("invalid claimed job: {error}")))
    }

    async fn renew_lease(&self, job_id: &str, worker_id: &str) -> Result<(), RepositoryError> {
        let renewed: bool = self
            .rpc(
                "renew_document_ingestion_lease",
                json!({"p_job_id": job_id, "p_worker": worker_id, "p_lease_seconds": self.lease_seconds}),
            )
            .await?
            .json()
            .await
            .map_err(|error| RepositoryError::permanent(format!("invalid lease response: {error}")))?;
        if renewed {
            Ok(())
        } else {
            Err(RepositoryError::permanent(
                "the document job lease was lost",
            ))
        }
    }

    async fn load_source(&self, job: &ClaimedJob) -> Result<DocumentSource, RepositoryError> {
        let versions: Vec<Value> =
            checked(self.request(reqwest::Method::GET, "file_versions").query(&[
                ("select", "mime_type,content,extracted_text"),
                ("id", &format!("eq.{}", job.file_version_id)),
                ("org_id", &format!("eq.{}", job.org_id)),
            ]))
            .send()
            .await?
            .json()
            .await
            .map_err(|error| {
                RepositoryError::permanent(format!("invalid document source: {error}"))
            })?;
        let source = versions
            .into_iter()
            .next()
            .ok_or_else(|| RepositoryError::permanent("the document source was not found"))?;
        let encoded = source["content"]
            .as_str()
            .and_then(|value| value.strip_prefix("\\x"))
            .ok_or_else(|| RepositoryError::permanent("the document source is not bytea"))?;
        let bytes = hex::decode(encoded).map_err(|error| {
            RepositoryError::permanent(format!("invalid source bytes: {error}"))
        })?;

        let profiles: Vec<ProfileRow> = checked(
            self.request(reqwest::Method::GET, "embedding_profiles")
                .query(&[
                    (
                        "select",
                        "id,provider_model_id,dimensions,document_prefix,query_prefix",
                    ),
                    ("id", &format!("eq.{}", job.embedding_profile_id)),
                ]),
        )
        .send()
        .await?
        .json()
        .await
        .map_err(|error| {
            RepositoryError::permanent(format!("invalid embedding profile: {error}"))
        })?;
        let profile = profiles
            .into_iter()
            .next()
            .ok_or_else(|| RepositoryError::permanent("the embedding profile was not found"))?;
        Ok(DocumentSource {
            mime_type: source["mime_type"].as_str().unwrap_or_default().to_string(),
            bytes,
            extracted_text: source["extracted_text"].as_str().map(str::to_string),
            profile: profile.into(),
        })
    }

    async fn advance(
        &self,
        job_id: &str,
        worker_id: &str,
        stage: JobStage,
    ) -> Result<(), RepositoryError> {
        let advanced: ClaimedJob = self
            .rpc(
                "advance_document_ingestion",
                json!({"p_job_id": job_id, "p_worker": worker_id, "p_stage": stage.as_str()}),
            )
            .await?
            .json()
            .await
            .map_err(|error| {
                RepositoryError::permanent(format!("invalid advanced job: {error}"))
            })?;
        ensure_job(advanced, job_id)
    }

    async fn store_extraction(&self, job: &ClaimedJob, text: &str) -> Result<(), RepositoryError> {
        let rows: Vec<Value> = checked(
            self.request(reqwest::Method::PATCH, "file_versions")
                .query(&[
                    ("id", format!("eq.{}", job.file_version_id)),
                    ("org_id", format!("eq.{}", job.org_id)),
                ])
                .header("Prefer", "return=representation"),
        )
        .json(&json!({"extracted_text": text}))
        .send()
        .await?
        .json()
        .await
        .map_err(|error| {
            RepositoryError::permanent(format!("invalid extraction write: {error}"))
        })?;
        if rows.len() == 1 {
            Ok(())
        } else {
            Err(RepositoryError::permanent(
                "the extraction write did not match one document version",
            ))
        }
    }

    async fn upsert_chunks(
        &self,
        job: &ClaimedJob,
        chunks: &[DocumentChunk],
    ) -> Result<Vec<PersistedChunk>, RepositoryError> {
        let rows = chunks
            .iter()
            .map(|chunk| {
                json!({
                    "org_id": job.org_id,
                    "file_id": job.file_id,
                    "file_version_id": job.file_version_id,
                    "chunker_version": job.chunker_version,
                    "ordinal": chunk.ordinal,
                    "page_start": chunk.page_start,
                    "page_end": chunk.page_end,
                    "section_path": chunk.section_path,
                    "content": chunk.content,
                    "token_count": chunk.token_count,
                    "content_sha256": chunk.content_sha256,
                })
            })
            .collect::<Vec<_>>();
        checked(
            self.request(reqwest::Method::POST, "document_chunks")
                .query(&[("on_conflict", "file_version_id,chunker_version,ordinal")])
                .header(
                    "Prefer",
                    "resolution=merge-duplicates,return=representation",
                ),
        )
        .json(&Value::Array(rows))
        .send()
        .await?
        .json()
        .await
        .map_err(|error| RepositoryError::permanent(format!("invalid stored chunks: {error}")))
    }

    async fn missing_chunks(
        &self,
        job: &ClaimedJob,
        chunks: &[PersistedChunk],
    ) -> Result<Vec<PersistedChunk>, RepositoryError> {
        if chunks.is_empty() {
            return Ok(Vec::new());
        }
        let ids = chunks
            .iter()
            .map(|chunk| chunk.id.as_str())
            .collect::<Vec<_>>()
            .join(",");
        let rows: Vec<EmbeddedChunkRow> = checked(
            self.request(reqwest::Method::GET, "document_chunk_embeddings")
                .query(&[
                    ("select", "chunk_id".to_string()),
                    ("org_id", format!("eq.{}", job.org_id)),
                    (
                        "embedding_profile_id",
                        format!("eq.{}", job.embedding_profile_id),
                    ),
                    ("chunk_id", format!("in.({ids})")),
                ]),
        )
        .send()
        .await?
        .json()
        .await
        .map_err(|error| {
            RepositoryError::permanent(format!("invalid stored embeddings: {error}"))
        })?;
        let existing = rows
            .into_iter()
            .map(|row| row.chunk_id)
            .collect::<HashSet<_>>();
        Ok(chunks
            .iter()
            .filter(|chunk| !existing.contains(&chunk.id))
            .cloned()
            .collect())
    }

    async fn upsert_embeddings(
        &self,
        job: &ClaimedJob,
        embeddings: &[ChunkEmbedding],
    ) -> Result<(), RepositoryError> {
        let rows = embeddings
            .iter()
            .map(|embedding| {
                json!({
                    "org_id": job.org_id,
                    "chunk_id": embedding.chunk_id,
                    "embedding_profile_id": job.embedding_profile_id,
                    "embedding": vector_literal(&embedding.values),
                })
            })
            .collect::<Vec<_>>();
        let rows: Vec<Value> = checked(
            self.request(reqwest::Method::POST, "document_chunk_embeddings")
                .query(&[("on_conflict", "chunk_id,embedding_profile_id")])
                .header(
                    "Prefer",
                    "resolution=merge-duplicates,return=representation",
                ),
        )
        .json(&Value::Array(rows))
        .send()
        .await?
        .json()
        .await
        .map_err(|error| RepositoryError::permanent(format!("invalid embedding write: {error}")))?;
        if rows.len() == embeddings.len() {
            Ok(())
        } else {
            Err(RepositoryError::permanent(format!(
                "stored {} embeddings for {} chunks",
                rows.len(),
                embeddings.len()
            )))
        }
    }

    async fn complete(
        &self,
        job: &ClaimedJob,
        worker_id: &str,
        intelligence: &Value,
    ) -> Result<(), RepositoryError> {
        let completed: ClaimedJob = self
            .rpc(
                "complete_document_ingestion",
                json!({"p_job_id": job.id, "p_worker": worker_id, "p_intelligence": intelligence}),
            )
            .await?
            .json()
            .await
            .map_err(|error| {
                RepositoryError::permanent(format!("invalid completed job: {error}"))
            })?;
        ensure_job(completed, &job.id)
    }

    async fn fail(
        &self,
        job: &ClaimedJob,
        worker_id: &str,
        failure: &JobFailure,
    ) -> Result<(), RepositoryError> {
        let failed: ClaimedJob = self
            .rpc(
                "fail_document_ingestion",
                json!({
                    "p_job_id": job.id,
                    "p_worker": worker_id,
                    "p_error_code": failure.code,
                    "p_error_detail": failure.detail,
                    "p_retryable": failure.retryable,
                }),
            )
            .await?
            .json()
            .await
            .map_err(|error| RepositoryError::permanent(format!("invalid failed job: {error}")))?;
        ensure_job(failed, &job.id)
    }
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

#[derive(Deserialize)]
struct EmbeddedChunkRow {
    chunk_id: String,
}

fn vector_literal(values: &[f32]) -> String {
    let values = values
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    format!("[{values}]")
}

fn ensure_job(job: ClaimedJob, expected_id: &str) -> Result<(), RepositoryError> {
    if job.id == expected_id {
        Ok(())
    } else {
        Err(RepositoryError::permanent(
            "the database returned a different document job",
        ))
    }
}
