use std::collections::{BTreeMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use rustvani::vokoo::documents::{
    ChunkEmbedding, ClaimedJob, DocumentChunk, DocumentClassifier, DocumentEvidence,
    DocumentSource, DocumentWorker, EmbedError, Embedder, EmbeddingFactory, EmbeddingProfile,
    JobFailure, JobRepository, JobStage, PersistedChunk, PostgrestJobRepository, RepositoryError,
    RunOutcome, WorkerError,
};
use serde_json::{json, Value};

#[derive(Default)]
struct RepoState {
    claims: VecDeque<ClaimedJob>,
    source: Option<DocumentSource>,
    events: Vec<String>,
    chunks: BTreeMap<usize, PersistedChunk>,
    embedded: HashSet<String>,
    failures: Vec<JobFailure>,
    completions: Vec<Value>,
    extraction_writes: usize,
}

#[derive(Default)]
struct FakeRepo(Mutex<RepoState>);

#[async_trait]
impl JobRepository for FakeRepo {
    async fn claim(&self, _worker_id: &str) -> Result<Option<ClaimedJob>, RepositoryError> {
        Ok(self.0.lock().unwrap().claims.pop_front())
    }

    async fn renew_lease(&self, _job_id: &str, _worker_id: &str) -> Result<(), RepositoryError> {
        self.0.lock().unwrap().events.push("renew".into());
        Ok(())
    }

    async fn load_source(&self, _job: &ClaimedJob) -> Result<DocumentSource, RepositoryError> {
        self.0
            .lock()
            .unwrap()
            .source
            .clone()
            .ok_or_else(|| RepositoryError::permanent("missing fake source"))
    }

    async fn advance(
        &self,
        _job_id: &str,
        _worker_id: &str,
        stage: JobStage,
    ) -> Result<(), RepositoryError> {
        self.0
            .lock()
            .unwrap()
            .events
            .push(format!("stage:{stage:?}"));
        Ok(())
    }

    async fn store_extraction(&self, _job: &ClaimedJob, text: &str) -> Result<(), RepositoryError> {
        let mut state = self.0.lock().unwrap();
        state.extraction_writes += 1;
        state.events.push("extracted".into());
        if let Some(source) = state.source.as_mut() {
            source.extracted_text = Some(text.to_string());
        }
        Ok(())
    }

    async fn upsert_chunks(
        &self,
        _job: &ClaimedJob,
        chunks: &[DocumentChunk],
    ) -> Result<Vec<PersistedChunk>, RepositoryError> {
        let mut state = self.0.lock().unwrap();
        state.events.push("chunks".into());
        for chunk in chunks {
            state.chunks.insert(
                chunk.ordinal,
                PersistedChunk {
                    id: format!("chunk-{}", chunk.ordinal),
                    ordinal: chunk.ordinal,
                    page_start: chunk.page_start,
                    page_end: chunk.page_end,
                    section_path: chunk.section_path.clone(),
                    content: chunk.content.clone(),
                    token_count: chunk.token_count,
                    content_sha256: chunk.content_sha256.clone(),
                },
            );
        }
        Ok(state.chunks.values().cloned().collect())
    }

    async fn missing_chunks(
        &self,
        _job: &ClaimedJob,
        chunks: &[PersistedChunk],
    ) -> Result<Vec<PersistedChunk>, RepositoryError> {
        let state = self.0.lock().unwrap();
        Ok(chunks
            .iter()
            .filter(|chunk| !state.embedded.contains(&chunk.id))
            .cloned()
            .collect())
    }

    async fn upsert_embeddings(
        &self,
        _job: &ClaimedJob,
        embeddings: &[ChunkEmbedding],
    ) -> Result<(), RepositoryError> {
        let mut state = self.0.lock().unwrap();
        state.events.push("embeddings".into());
        for embedding in embeddings {
            state.embedded.insert(embedding.chunk_id.clone());
        }
        Ok(())
    }

    async fn complete(
        &self,
        _job: &ClaimedJob,
        _worker_id: &str,
        intelligence: &Value,
    ) -> Result<(), RepositoryError> {
        let mut state = self.0.lock().unwrap();
        state.events.push("complete".into());
        state.completions.push(intelligence.clone());
        Ok(())
    }

    async fn fail(
        &self,
        _job: &ClaimedJob,
        _worker_id: &str,
        failure: &JobFailure,
    ) -> Result<(), RepositoryError> {
        let mut state = self.0.lock().unwrap();
        state.events.push("fail".into());
        state.failures.push(failure.clone());
        Ok(())
    }
}

#[derive(Default)]
struct FakeEmbedder {
    calls: Mutex<Vec<Vec<String>>>,
    responses: Mutex<VecDeque<Result<Vec<Vec<f32>>, EmbedError>>>,
}

#[async_trait]
impl Embedder for FakeEmbedder {
    async fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        self.calls.lock().unwrap().push(texts.to_vec());
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Ok(vec![vec![0.1; 768]; texts.len()]))
    }

    async fn embed_query(&self, _query: &str) -> Result<Vec<f32>, EmbedError> {
        unreachable!("the ingestion worker embeds documents only")
    }
}

struct FakeFactory {
    embedder: Arc<FakeEmbedder>,
    creates: Mutex<usize>,
}

#[async_trait]
impl EmbeddingFactory for FakeFactory {
    async fn create(
        &self,
        _org_id: &str,
        _profile: &EmbeddingProfile,
    ) -> Result<Arc<dyn Embedder>, WorkerError> {
        *self.creates.lock().unwrap() += 1;
        Ok(self.embedder.clone())
    }
}

#[derive(Default)]
struct FakeClassifier(Mutex<Vec<DocumentEvidence>>);

#[async_trait]
impl DocumentClassifier for FakeClassifier {
    async fn classify(
        &self,
        _job: &ClaimedJob,
        evidence: &DocumentEvidence,
    ) -> Result<Value, WorkerError> {
        self.0.lock().unwrap().push(evidence.clone());
        Ok(json!({"summary": "care guideline", "recommendations": []}))
    }
}

fn job() -> ClaimedJob {
    ClaimedJob {
        id: "job-1".into(),
        org_id: "org-1".into(),
        file_id: "file-1".into(),
        file_version_id: "version-1".into(),
        chunker_version: "clinical-structure-v1".into(),
        embedding_profile_id: "gemini-embedding-2-768".into(),
        stage: JobStage::Extracting,
        attempt_count: 1,
        max_attempts: 5,
    }
}

fn source(bytes: Vec<u8>) -> DocumentSource {
    DocumentSource {
        mime_type: "text/markdown".into(),
        bytes,
        extracted_text: None,
        profile: EmbeddingProfile {
            id: "gemini-embedding-2-768".into(),
            provider_model_id: "gemini-embedding-2".into(),
            dimensions: 768,
            document_prefix: "title: none | text: {content}".into(),
            query_prefix: "task: search result | query: {content}".into(),
        },
    }
}

fn harness(
    claims: Vec<ClaimedJob>,
    document: Option<DocumentSource>,
) -> (
    Arc<FakeRepo>,
    Arc<FakeEmbedder>,
    Arc<FakeFactory>,
    Arc<FakeClassifier>,
    DocumentWorker,
) {
    let repo = Arc::new(FakeRepo::default());
    {
        let mut state = repo.0.lock().unwrap();
        state.claims = claims.into();
        state.source = document;
    }
    let embedder = Arc::new(FakeEmbedder::default());
    let factory = Arc::new(FakeFactory {
        embedder: embedder.clone(),
        creates: Mutex::new(0),
    });
    let classifier = Arc::new(FakeClassifier::default());
    let worker = DocumentWorker::new(
        repo.clone(),
        factory.clone(),
        classifier.clone(),
        "worker-1",
    );
    (repo, embedder, factory, classifier, worker)
}

#[tokio::test]
async fn idle_worker_does_not_call_a_provider() {
    let (_, embedder, factory, _, worker) = harness(vec![], None);

    assert_eq!(worker.run_once().await.unwrap(), RunOutcome::Idle);
    assert!(embedder.calls.lock().unwrap().is_empty());
    assert_eq!(*factory.creates.lock().unwrap(), 0);
}

#[tokio::test]
async fn successful_work_persists_each_stage_and_cited_evidence() {
    let bytes = b"# Diabetes\n\nMonitor HbA1c and escalate when control remains poor.".to_vec();
    let (repo, embedder, _, classifier, worker) = harness(vec![job()], Some(source(bytes)));

    assert_eq!(
        worker.run_once().await.unwrap(),
        RunOutcome::Processed {
            job_id: "job-1".into()
        }
    );

    let state = repo.0.lock().unwrap();
    assert_eq!(state.embedded.len(), state.chunks.len());
    assert_eq!(state.completions.len(), 1);
    assert_eq!(state.failures.len(), 0);
    assert_eq!(
        state.events,
        vec![
            "extracted",
            "renew",
            "stage:Chunking",
            "chunks",
            "renew",
            "stage:Embedding",
            "embeddings",
            "renew",
            "renew",
            "stage:Classifying",
            "complete",
        ]
    );
    drop(state);
    assert_eq!(embedder.calls.lock().unwrap().len(), 1);
    let evidence = classifier.0.lock().unwrap();
    assert_eq!(evidence[0].compiler_matches, vec!["care_path"]);
    assert_eq!(evidence[0].representative_chunks[0].version_id, "version-1");
    assert_eq!(evidence[0].representative_chunks[0].chunk_id, "chunk-0");
    let metrics = worker.metrics().render();
    assert!(metrics.contains("document_jobs_completed_total 1"));
    assert!(!metrics.contains("job-1"));
    assert!(!metrics.contains("version-1"));
    assert!(!metrics.contains("Monitor HbA1c"));
}

#[tokio::test]
async fn retryable_embedding_failure_leaves_chunks_and_records_retry() {
    let bytes = b"# Follow-up\n\nReview symptoms after fourteen days.".to_vec();
    let (repo, embedder, _, _, worker) = harness(vec![job()], Some(source(bytes)));
    embedder
        .responses
        .lock()
        .unwrap()
        .push_back(Err(EmbedError::retryable("rate limited", None)));

    let problem = worker.run_once().await.unwrap_err();

    assert!(problem.is_retryable());
    let state = repo.0.lock().unwrap();
    assert!(!state.chunks.is_empty());
    assert!(state.embedded.is_empty());
    assert_eq!(state.failures.len(), 1);
    assert!(state.failures[0].retryable);
}

#[tokio::test]
async fn corrupt_source_is_a_permanent_failure_before_any_provider_call() {
    let mut document = source(b"not a zip".to_vec());
    document.mime_type =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into();
    let (repo, embedder, _, _, worker) = harness(vec![job()], Some(document));

    let problem = worker.run_once().await.unwrap_err();

    assert!(matches!(problem, WorkerError::Permanent(_)));
    assert!(embedder.calls.lock().unwrap().is_empty());
    assert!(!repo.0.lock().unwrap().failures[0].retryable);
}

#[tokio::test]
async fn retries_skip_existing_extraction_and_embeddings_without_duplicates() {
    let bytes = b"# Monitoring\n\nMonitor symptoms and review the result.".to_vec();
    let mut document = source(bytes.clone());
    document.extracted_text = Some(String::from_utf8(bytes).unwrap());
    let (repo, embedder, factory, _, worker) = harness(vec![job(), job()], Some(document));

    worker.run_once().await.unwrap();
    worker.run_once().await.unwrap();

    let state = repo.0.lock().unwrap();
    assert_eq!(state.extraction_writes, 0);
    assert_eq!(state.chunks.len(), 1);
    assert_eq!(state.embedded.len(), 1);
    assert_eq!(state.completions.len(), 2);
    assert_eq!(embedder.calls.lock().unwrap().len(), 1);
    assert_eq!(*factory.creates.lock().unwrap(), 1);
}

#[tokio::test]
async fn partial_embedding_restart_sends_only_missing_chunks() {
    let mut text = String::from("# Monitoring\n\n");
    for _ in 0..300 {
        text.push_str("Monitor symptoms and record the result every day. ");
    }
    let (repo, embedder, _, _, worker) = harness(vec![job()], Some(source(text.into_bytes())));
    repo.0.lock().unwrap().embedded.insert("chunk-0".into());

    worker.run_once().await.unwrap();

    let state = repo.0.lock().unwrap();
    assert!(state.chunks.len() > 1);
    assert_eq!(state.embedded.len(), state.chunks.len());
    let sent = embedder
        .calls
        .lock()
        .unwrap()
        .iter()
        .map(Vec::len)
        .sum::<usize>();
    assert_eq!(sent, state.chunks.len() - 1);
}

#[derive(Clone, Default)]
struct PostgrestState {
    requests: Arc<Mutex<Vec<(HeaderMap, Value)>>>,
    responses: Arc<Mutex<VecDeque<Value>>>,
}

async fn fake_postgrest(
    State(state): State<PostgrestState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Json<Value> {
    state.requests.lock().unwrap().push((headers, body));
    Json(state.responses.lock().unwrap().pop_front().unwrap())
}

async fn postgrest(responses: Vec<Value>) -> (String, PostgrestState, tokio::task::JoinHandle<()>) {
    let state = PostgrestState {
        requests: Arc::new(Mutex::new(Vec::new())),
        responses: Arc::new(Mutex::new(responses.into())),
    };
    let app = Router::new()
        .route(
            "/rest/v1/rpc/claim_document_ingestion",
            post(fake_postgrest),
        )
        .route(
            "/rest/v1/rpc/advance_document_ingestion",
            post(fake_postgrest),
        )
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), state, task)
}

#[tokio::test]
async fn postgrest_claim_uses_service_auth_and_typed_idle_response() {
    let (base, state, server) = postgrest(vec![Value::Null]).await;
    let repository = PostgrestJobRepository::new(base, "service-secret").unwrap();

    assert_eq!(repository.claim("worker-a").await.unwrap(), None);
    let requests = state.requests.lock().unwrap();
    assert_eq!(requests[0].0["apikey"], "service-secret");
    assert_eq!(requests[0].0["authorization"], "Bearer service-secret");
    assert_eq!(requests[0].1["p_worker"], "worker-a");
    server.abort();
}

#[tokio::test]
async fn state_changing_rpc_rejects_a_different_returned_job() {
    let mut different = serde_json::to_value(job()).unwrap();
    different["id"] = json!("different-job");
    let (base, _, server) = postgrest(vec![different]).await;
    let repository = PostgrestJobRepository::new(base, "service-secret").unwrap();

    let problem = repository
        .advance("job-1", "worker-a", JobStage::Chunking)
        .await
        .unwrap_err();

    assert!(!problem.is_retryable());
    assert!(problem.to_string().contains("different document job"));
    server.abort();
}
