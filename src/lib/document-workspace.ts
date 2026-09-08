export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

const ACCEPTED_DOCUMENT_TYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
]);

export type CompilerEvidence = {
    page: number | null;
    page_end?: number | null;
    chunk_id?: string | null;
    version_id?: string | null;
    section_path?: string[];
    text: string;
};

export type CompilerRecommendation = {
    compiler_id: "care_path";
    label: string;
    confidence: number;
    reason: string;
    evidence: CompilerEvidence[];
};

export type RawCompilerRecommendation = Omit<CompilerRecommendation, "compiler_id" | "label"> & {
    compiler_id: string;
};

export type DocumentIntelligence = {
    summary: string;
    recommendations: CompilerRecommendation[];
    gaps: string[];
    analyzed_at?: string;
};

export type WorkspaceDocument = {
    id: string;
    name: string;
    mime_type: string | null;
    size_bytes: number | null;
    status: string;
    current_version: number;
    updated_at?: string;
    intelligence: DocumentIntelligence | null;
};

export type DocumentVersion = {
    id: string;
    file_id: string;
    version: number;
    mime_type: string;
    size_bytes: number;
    sha256: string;
    status: string;
    intelligence: DocumentIntelligence | null;
    active_chunker_version: string | null;
    active_embedding_profile: string | null;
    indexed_at: string | null;
    processing_error: { code?: string; detail?: string; retryable?: boolean } | null;
    created_at: string;
};

export type DocumentJob = {
    id: string;
    file_id: string;
    file_version_id: string;
    stage: string;
    attempt_count: number;
    max_attempts: number;
    available_at: string;
    last_error_code: string | null;
    last_error_detail: string | null;
    created_at: string;
    updated_at: string;
};

export type DocumentLayoutPage = {
    page_number: number;
    width_points: number;
    height_points: number;
};

export type DocumentLayoutBox = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    origin: "BOTTOMLEFT";
};

export type DocumentLayoutSpan = {
    page_number: number;
    bbox: DocumentLayoutBox;
    char_start: number;
    char_end: number;
};

export type DocumentLayoutItem = {
    id: string;
    provider_ref: string;
    parent_ref: string | null;
    ordinal: number;
    label: string;
    content_layer: "body" | "furniture";
    text: string;
    section_path: string[];
    metadata: unknown;
    chunk_ids: string[];
    spans: DocumentLayoutSpan[];
};

export type DocumentLayout = {
    status: "ready" | "processing";
    schema_version: "layout-v1" | null;
    extraction_id: string | null;
    provider: string | null;
    provider_version: string | null;
    source_sha256: string;
    warnings: unknown[];
    pages: DocumentLayoutPage[];
    items: DocumentLayoutItem[];
};

export type ViewportRectangle = { x: number; y: number; width: number; height: number };

export type SelectedLayoutSpan = DocumentLayoutSpan & { item_id: string };

export function pdfPointBoxToViewport(
    box: DocumentLayoutBox,
    page: DocumentLayoutPage,
    scale: number,
): ViewportRectangle {
    if (box.origin !== "BOTTOMLEFT") throw new Error(`Unsupported PDF coordinate origin: ${box.origin}`);
    return {
        x: box.left * scale,
        y: (page.height_points - box.top) * scale,
        width: (box.right - box.left) * scale,
        height: (box.top - box.bottom) * scale,
    };
}

export function selectEvidenceLayout(
    items: DocumentLayoutItem[],
    chunkId: string | null | undefined,
    fallbackPage: number | null = null,
): { page: number | null; spans: SelectedLayoutSpan[] } {
    const linked = chunkId
        ? items.filter((item) => item.chunk_ids.includes(chunkId)).sort((left, right) => left.ordinal - right.ordinal)
        : [];
    const spans = linked.flatMap((item) =>
        item.spans.map((span) => ({ ...span, item_id: item.id })),
    );
    const firstPage = spans.reduce<number | null>(
        (page, span) => (page === null ? span.page_number : Math.min(page, span.page_number)),
        null,
    );
    return { page: firstPage ?? fallbackPage, spans };
}

export type DocumentEvidence = CompilerEvidence & {
    page_end: number | null;
    chunk_id: string | null;
    version_id: string | null;
    section_path: string[];
};

export type HistoricalDocumentVersion = { document_id: string; version: number };

export type DocumentSearchRequest = {
    query: string;
    limit?: number;
    document_ids?: string[];
    versions?: HistoricalDocumentVersion[];
};

type BrowserFile = Pick<File, "name" | "type" | "size">;

export function documentUploadProblem(file: BrowserFile): string | null {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const supportedByExtension = extension === "pdf" || extension === "docx" || extension === "txt" || extension === "md";
    if (!ACCEPTED_DOCUMENT_TYPES.has(file.type) && !supportedByExtension) {
        return "Choose a PDF, Word, or plain text document.";
    }
    if (file.size === 0) return "The document is empty.";
    if (file.size > MAX_DOCUMENT_BYTES) return "Documents must be 15 MB or smaller.";
    return null;
}

export function selectDocument(documents: WorkspaceDocument[], selectedId: string | null): string | null {
    if (selectedId && documents.some((document) => document.id === selectedId)) return selectedId;
    return documents[0]?.id ?? null;
}

export function selectDocumentVersion(
    versions: DocumentVersion[],
    selectedId: string | null,
    currentVersion: number,
): string | null {
    if (selectedId && versions.some((version) => version.id === selectedId)) return selectedId;
    return versions.find((version) => version.version === currentVersion)?.id ?? versions[0]?.id ?? null;
}

const PROCESSING_LABELS: Record<string, string> = {
    queued: "Queued for indexing",
    extracting: "Extracting source text",
    chunking: "Building clinical sections",
    embedding: "Creating search embeddings",
    classifying: "Workspace Intelligence is reviewing evidence",
    retryable_failed: "Waiting to retry",
    permanent_failed: "Indexing failed",
    failed: "Indexing failed",
    ready: "Indexed",
    indexed: "Indexed",
    analyzed: "Indexed",
};

export function documentProcessingLabel(stage: string): string {
    return PROCESSING_LABELS[stage] ?? "Preparing document";
}

export function shouldPollDocumentJob(job: Pick<DocumentJob, "stage"> | null): boolean {
    return !!job && !["ready", "permanent_failed"].includes(job.stage);
}

export function validateHistoricalSearch(request: DocumentSearchRequest): string | null {
    const length = request.query.trim().length;
    if (length < 1 || length > 2_000) return "Enter between 1 and 2,000 characters.";
    if (request.document_ids && request.versions) {
        return "Current and historical document filters cannot be combined.";
    }
    if (request.versions?.some((item) => !item.document_id || item.version < 1)) {
        return "Choose a valid document version.";
    }
    return null;
}

const COMPILERS = {
    care_path: "Care path compiler",
} as const;

export function normalizeCompilerRecommendations(
    recommendations: RawCompilerRecommendation[],
): CompilerRecommendation[] {
    return recommendations.flatMap((recommendation) => {
        if (!(recommendation.compiler_id in COMPILERS)) return [];
        const compilerId = recommendation.compiler_id as keyof typeof COMPILERS;
        return [{
            ...recommendation,
            compiler_id: compilerId,
            label: COMPILERS[compilerId],
            confidence: Math.max(0, Math.min(1, recommendation.confidence)),
        }];
    });
}

export function normalizeDocumentEvidence(input: unknown): DocumentIntelligence | null {
    if (!input || typeof input !== "object") return null;
    const raw = input as Record<string, unknown>;
    if (typeof raw.summary !== "string") return null;
    const recommendations = Array.isArray(raw.recommendations)
        ? raw.recommendations.flatMap((item): RawCompilerRecommendation[] => {
              if (!item || typeof item !== "object") return [];
              const recommendation = item as Record<string, unknown>;
              if (
                  typeof recommendation.compiler_id !== "string" ||
                  typeof recommendation.reason !== "string" ||
                  typeof recommendation.confidence !== "number"
              ) {
                  return [];
              }
              const evidence = Array.isArray(recommendation.evidence)
                  ? recommendation.evidence.flatMap((entry): DocumentEvidence[] => {
                        if (!entry || typeof entry !== "object") return [];
                        const value = entry as Record<string, unknown>;
                        if (typeof value.text !== "string" || !value.text.trim()) return [];
                        const pageValue = value.page_start ?? value.page;
                        const page = typeof pageValue === "number" && pageValue > 0 ? pageValue : null;
                        const pageEnd =
                            typeof value.page_end === "number" && value.page_end >= (page ?? 1)
                                ? value.page_end
                                : page;
                        return [{
                            text: value.text.trim(),
                            page,
                            page_end: pageEnd,
                            chunk_id: typeof value.chunk_id === "string" ? value.chunk_id : null,
                            version_id: typeof value.version_id === "string" ? value.version_id : null,
                            section_path: Array.isArray(value.section_path)
                                ? value.section_path.filter((part): part is string => typeof part === "string")
                                : [],
                        }];
                    })
                  : [];
              return [{
                  compiler_id: recommendation.compiler_id,
                  confidence: recommendation.confidence,
                  reason: recommendation.reason,
                  evidence,
              }];
          })
        : [];
    return {
        summary: raw.summary,
        recommendations: normalizeCompilerRecommendations(recommendations),
        gaps: Array.isArray(raw.gaps)
            ? raw.gaps.filter((gap): gap is string => typeof gap === "string")
            : [],
        analyzed_at: typeof raw.analyzed_at === "string" ? raw.analyzed_at : undefined,
    };
}

export function formatDocumentSize(bytes: number | null): string {
    if (bytes === null) return "Unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
