//! Immutable document extraction, chunking, embedding and retrieval.
//!
//! This module is deliberately separate from call execution. Documents are
//! processed after upload and the resulting evidence is later consumed by
//! Workspace Intelligence and compiler agents.

mod chunk;
mod embedding;
mod extract;
mod jobs;
mod metrics;
mod provider;
mod search;
mod worker;

pub use chunk::{chunk_document, ChunkConfig, DocumentChunk, CHUNKER_VERSION};
pub use embedding::{
    EmbedError, EmbedErrorKind, Embedder, EmbeddingProfile, GeminiEmbedder, MAX_EMBEDDING_BATCH,
};
pub use extract::{
    extract_document, DocumentError, ExtractedDocument, ExtractedPage, StructuralBlock,
    StructuralKind, DOCX_MIME,
};
pub use jobs::{
    ChunkEmbedding, ClaimedJob, DocumentSource, JobFailure, JobRepository, JobStage,
    PersistedChunk, PostgrestJobRepository, RepositoryError,
};
pub use metrics::DocumentMetrics;
pub use provider::{
    normalize_docling_json, ContentLayer, DoclingCommandProvider, DocumentExtractionProvider,
    ExtractionRequest, LayoutBox, LayoutItem, LayoutSpan, ModalDoclingProvider,
    NormalizedExtraction, NormalizedPage, ProviderError, ProviderErrorKind, LAYOUT_SCHEMA_VERSION,
};
pub use search::{
    document_search_router, DocumentSearchRequest, DocumentSearchResponse, DocumentSearchResult,
    DocumentSearchService, DocumentSearcher, HistoricalDocumentVersion, SearchError,
};
pub use worker::{
    DocumentClassifier, DocumentEvidence, DocumentWorker, EmbeddingFactory, EvidenceChunk,
    GeminiEmbeddingFactory, RunOutcome, WorkerError, WorkspaceIntelligenceClassifier,
};
