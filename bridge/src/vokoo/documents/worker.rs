use std::fmt;
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    chunk_document, extract_document, ChunkConfig, ChunkEmbedding, ClaimedJob, DocumentMetrics,
    EmbedError, Embedder, EmbeddingProfile, GeminiEmbedder, JobFailure, JobRepository, JobStage,
    PersistedChunk, RepositoryError, MAX_EMBEDDING_BATCH,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RunOutcome {
    Idle,
    Processed { job_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorkerError {
    Retryable(String),
    Permanent(String),
}

impl WorkerError {
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Retryable(_))
    }

    fn failure(&self) -> JobFailure {
        match self {
            Self::Retryable(detail) => JobFailure {
                code: "document_processing_retryable".into(),
                detail: detail.clone(),
                retryable: true,
            },
            Self::Permanent(detail) => JobFailure {
                code: "document_processing_permanent".into(),
                detail: detail.clone(),
                retryable: false,
            },
        }
    }
}

impl fmt::Display for WorkerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Retryable(message) | Self::Permanent(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for WorkerError {}

impl From<RepositoryError> for WorkerError {
    fn from(error: RepositoryError) -> Self {
        if error.is_retryable() {
            Self::Retryable(error.to_string())
        } else {
            Self::Permanent(error.to_string())
        }
    }
}

impl From<EmbedError> for WorkerError {
    fn from(error: EmbedError) -> Self {
        if error.is_retryable() {
            Self::Retryable(error.to_string())
        } else {
            Self::Permanent(error.to_string())
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct EvidenceChunk {
    pub chunk_id: String,
    pub version_id: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub section_path: Vec<String>,
    pub text: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct DocumentEvidence {
    pub outline: Vec<String>,
    pub representative_chunks: Vec<EvidenceChunk>,
    pub compiler_matches: Vec<String>,
}

#[async_trait]
pub trait EmbeddingFactory: Send + Sync {
    async fn create(
        &self,
        org_id: &str,
        profile: &EmbeddingProfile,
    ) -> Result<Arc<dyn Embedder>, WorkerError>;
}

#[async_trait]
pub trait DocumentClassifier: Send + Sync {
    async fn classify(
        &self,
        job: &ClaimedJob,
        evidence: &DocumentEvidence,
    ) -> Result<Value, WorkerError>;
}

pub struct GeminiEmbeddingFactory {
    supabase_url: String,
    service_key: String,
    gemini_base_url: String,
}

impl GeminiEmbeddingFactory {
    pub fn new(
        supabase_url: impl Into<String>,
        service_key: impl Into<String>,
        gemini_base_url: impl Into<String>,
    ) -> Self {
        Self {
            supabase_url: supabase_url.into(),
            service_key: service_key.into(),
            gemini_base_url: gemini_base_url.into(),
        }
    }
}

#[async_trait]
impl EmbeddingFactory for GeminiEmbeddingFactory {
    async fn create(
        &self,
        org_id: &str,
        profile: &EmbeddingProfile,
    ) -> Result<Arc<dyn Embedder>, WorkerError> {
        let secret = super::super::graph::vendor_secret(
            &self.supabase_url,
            &self.service_key,
            org_id,
            "gemini",
        )
        .await
        .ok_or_else(|| {
            WorkerError::Permanent("no Gemini platform credential is configured".into())
        })?;
        let embedder = GeminiEmbedder::new(&secret, profile.clone(), &self.gemini_base_url)?;
        Ok(Arc::new(embedder))
    }
}

pub struct WorkspaceIntelligenceClassifier {
    supabase_url: String,
    service_key: String,
}

impl WorkspaceIntelligenceClassifier {
    pub fn new(supabase_url: impl Into<String>, service_key: impl Into<String>) -> Self {
        Self {
            supabase_url: supabase_url.into(),
            service_key: service_key.into(),
        }
    }
}

#[async_trait]
impl DocumentClassifier for WorkspaceIntelligenceClassifier {
    async fn classify(
        &self,
        job: &ClaimedJob,
        evidence: &DocumentEvidence,
    ) -> Result<Value, WorkerError> {
        let inspection = super::super::intelligence::inspect_document_evidence(
            &self.supabase_url,
            &self.service_key,
            &job.org_id,
            evidence,
        )
        .await
        .map_err(|problem| {
            if problem.starts_with("no ") || problem.contains("cannot inspect documents") {
                WorkerError::Permanent(problem)
            } else {
                WorkerError::Retryable(problem)
            }
        })?;
        serde_json::to_value(inspection)
            .map_err(|error| WorkerError::Permanent(format!("invalid document routing: {error}")))
    }
}

pub struct DocumentWorker {
    jobs: Arc<dyn JobRepository>,
    embeddings: Arc<dyn EmbeddingFactory>,
    classifier: Arc<dyn DocumentClassifier>,
    worker_id: String,
    chunk_config: ChunkConfig,
    metrics: Arc<DocumentMetrics>,
}

impl DocumentWorker {
    pub fn new(
        jobs: Arc<dyn JobRepository>,
        embeddings: Arc<dyn EmbeddingFactory>,
        classifier: Arc<dyn DocumentClassifier>,
        worker_id: impl Into<String>,
    ) -> Self {
        Self {
            jobs,
            embeddings,
            classifier,
            worker_id: worker_id.into(),
            chunk_config: ChunkConfig::default(),
            metrics: Arc::new(DocumentMetrics::default()),
        }
    }

    pub fn with_metrics(mut self, metrics: Arc<DocumentMetrics>) -> Self {
        self.metrics = metrics;
        self
    }

    pub fn metrics(&self) -> Arc<DocumentMetrics> {
        Arc::clone(&self.metrics)
    }

    pub async fn run_once(&self) -> Result<RunOutcome, WorkerError> {
        let Some(job) = self.jobs.claim(&self.worker_id).await? else {
            self.metrics.increment("document_worker_idle_total");
            return Ok(RunOutcome::Idle);
        };

        self.metrics.set_leased(true);
        let outcome = match self.process(&job).await {
            Ok(()) => Ok(RunOutcome::Processed {
                job_id: job.id.clone(),
            }),
            Err(problem) => {
                self.metrics.increment(if problem.is_retryable() {
                    "document_jobs_retryable_failed_total"
                } else {
                    "document_jobs_permanent_failed_total"
                });
                match self
                    .jobs
                    .fail(&job, &self.worker_id, &problem.failure())
                    .await
                {
                    Ok(()) => Err(problem),
                    Err(failure_problem) => Err(failure_problem.into()),
                }
            }
        };
        self.metrics.set_leased(false);
        outcome
    }

    async fn process(&self, job: &ClaimedJob) -> Result<(), WorkerError> {
        let source = self.jobs.load_source(job).await?;
        let started = Instant::now();
        let extracted = extract_document(&source.mime_type, &source.bytes)
            .map_err(|error| WorkerError::Permanent(error.to_string()))?;
        self.metrics
            .stage_millis("extracting", started.elapsed().as_millis());
        self.metrics
            .add("document_extracted_pages_total", extracted.pages.len());
        self.metrics.add(
            "document_extracted_characters_total",
            extracted.text.chars().count(),
        );
        if source.extracted_text.as_deref() != Some(extracted.text.as_str()) {
            self.jobs.store_extraction(job, &extracted.text).await?;
        }

        self.renew_and_advance(job, JobStage::Chunking).await?;
        let started = Instant::now();
        let chunks = chunk_document(&extracted, &self.chunk_config);
        self.metrics
            .stage_millis("chunking", started.elapsed().as_millis());
        if chunks.is_empty() {
            return Err(WorkerError::Permanent(
                "the document produced no indexable chunks".into(),
            ));
        }
        let persisted = self.jobs.upsert_chunks(job, &chunks).await?;
        self.metrics
            .add("document_chunks_persisted_total", persisted.len());

        self.renew_and_advance(job, JobStage::Embedding).await?;
        let missing = self.jobs.missing_chunks(job, &persisted).await?;
        if !missing.is_empty() {
            let embedder = self.embeddings.create(&job.org_id, &source.profile).await?;
            for batch in missing.chunks(MAX_EMBEDDING_BATCH) {
                let texts = batch
                    .iter()
                    .map(|chunk| chunk.content.clone())
                    .collect::<Vec<_>>();
                let started = Instant::now();
                let vectors = embedder.embed_documents(&texts).await?;
                self.metrics
                    .stage_millis("gemini", started.elapsed().as_millis());
                let embeddings = batch
                    .iter()
                    .zip(vectors)
                    .map(|(chunk, values)| ChunkEmbedding {
                        chunk_id: chunk.id.clone(),
                        values,
                    })
                    .collect::<Vec<_>>();
                self.jobs.upsert_embeddings(job, &embeddings).await?;
                self.metrics
                    .add("document_embeddings_persisted_total", embeddings.len());
                self.jobs.renew_lease(&job.id, &self.worker_id).await?;
            }
        }

        self.renew_and_advance(job, JobStage::Classifying).await?;
        let evidence = build_evidence(job, &persisted);
        let started = Instant::now();
        let intelligence = self.classifier.classify(job, &evidence).await?;
        self.metrics
            .stage_millis("classifying", started.elapsed().as_millis());
        self.jobs
            .complete(job, &self.worker_id, &intelligence)
            .await?;
        self.metrics.increment("document_jobs_completed_total");
        Ok(())
    }

    async fn renew_and_advance(
        &self,
        job: &ClaimedJob,
        stage: JobStage,
    ) -> Result<(), WorkerError> {
        self.jobs.renew_lease(&job.id, &self.worker_id).await?;
        self.jobs.advance(&job.id, &self.worker_id, stage).await?;
        Ok(())
    }
}

fn build_evidence(job: &ClaimedJob, chunks: &[PersistedChunk]) -> DocumentEvidence {
    let mut outline = Vec::new();
    for chunk in chunks {
        if !chunk.section_path.is_empty() {
            let section = chunk.section_path.join(" > ");
            if !outline.contains(&section) {
                outline.push(section);
            }
        }
    }
    let compiler_matches = chunks
        .iter()
        .any(|chunk| {
            let content = chunk.content.to_ascii_lowercase();
            [
                "recommend",
                "monitor",
                "follow-up",
                "follow up",
                "escalat",
                "review",
            ]
            .iter()
            .any(|needle| content.contains(needle))
        })
        .then(|| "care_path".to_string())
        .into_iter()
        .collect();
    let representative_chunks = chunks
        .iter()
        .take(16)
        .map(|chunk| EvidenceChunk {
            chunk_id: chunk.id.clone(),
            version_id: job.file_version_id.clone(),
            page_start: chunk.page_start,
            page_end: chunk.page_end,
            section_path: chunk.section_path.clone(),
            text: chunk.content.chars().take(4_000).collect(),
        })
        .collect();
    DocumentEvidence {
        outline,
        representative_chunks,
        compiler_matches,
    }
}
