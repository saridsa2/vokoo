export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

const MIN_DOCUMENT_INSPECTOR_WIDTH = 320;
const MAX_DOCUMENT_INSPECTOR_WIDTH = 640;
const MIN_DOCUMENT_VIEWER_WIDTH = 530;

export function clampDocumentInspectorWidth(width: number, workspaceWidth: number): number {
    const availableMaximum = Math.max(MIN_DOCUMENT_INSPECTOR_WIDTH, Math.min(MAX_DOCUMENT_INSPECTOR_WIDTH, workspaceWidth - MIN_DOCUMENT_VIEWER_WIDTH));
    return Math.round(Math.min(availableMaximum, Math.max(MIN_DOCUMENT_INSPECTOR_WIDTH, width)));
}

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

export const COMPILER_RUN_STATUSES = [
    "queued",
    "planning",
    "compiling",
    "validating",
    "materializing",
    "completed",
    "completed_with_gaps",
    "failed",
    "cancelled",
] as const;

export type CompilerRunStatus = (typeof COMPILER_RUN_STATUSES)[number];
export type CompilerStepKind = "plan" | "retrieve" | "extract" | "reconcile" | "resolve" | "lower" | "validate" | "materialize";
export type CompilerStepStatus = "started" | "completed" | "failed" | "skipped";
export type CompilerGapSeverity = "info" | "warning" | "blocking";
export type CompilerEvidenceRole = "requirement" | "threshold" | "timing" | "exception" | "population" | "escalation";
export type CompilerGapClass =
    | "missing_capability"
    | "missing_mapping"
    | "ambiguous_evidence"
    | "insufficient_evidence"
    | "safety_conflict"
    | "unknown";

export type CompilerGapPresentation = {
    title: string;
    capabilityLabel: string | null;
    class: CompilerGapClass;
    requestable: boolean;
};

export const COMPILER_CAPABILITY_REQUEST_STATUSES = [
    "requested",
    "under_review",
    "needs_information",
    "delivering",
    "resolved",
    "declined",
    "cancelled",
] as const;

export type CompilerCapabilityRequestStatus = (typeof COMPILER_CAPABILITY_REQUEST_STATUSES)[number];

export type CompilerCapabilityRequest = {
    id: string;
    gap_id: string;
    capability_key: string;
    requested_contract: Record<string, unknown>;
    status: CompilerCapabilityRequestStatus;
    workspace_note: string | null;
    operator_response: string | null;
    delivery_reference: string | null;
    active_resolution_id: string | null;
    created_at: string;
    updated_at: string;
};

export type CompilerRun = {
    id: string;
    file_id: string;
    file_version_id: string;
    compiler_id: "care_path";
    status: CompilerRunStatus;
    provider: string;
    model: string;
    compiler_version: string;
    prompt_version: string;
    attempt_count: number;
    max_attempts: number;
    summary: string | null;
    coverage: Record<string, number>;
    last_error_code: string | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    updated_at: string;
    parent_run_id: string | null;
    resolution_digest: string | null;
};

export type CompilerStep = {
    id: string;
    sequence: number;
    kind: CompilerStepKind;
    status: CompilerStepStatus;
    task_key: string | null;
    page_start: number | null;
    page_end: number | null;
    input_refs: Record<string, unknown>;
    result: Record<string, unknown>;
    input_tokens: number | null;
    output_tokens: number | null;
    duration_ms: number | null;
    retry_count: number;
    error_code: string | null;
    created_at: string;
};

export type CompilerGapEvidence = {
    chunk_id: string;
    excerpt: string;
    role: CompilerEvidenceRole;
    recommendation_id: string | null;
};

export type CompilerGap = {
    id: string;
    step_id: string | null;
    code: string;
    severity: CompilerGapSeverity;
    recommendation_id: string;
    explanation: string;
    missing_capability: string | null;
    details: Record<string, unknown>;
    presentation: CompilerGapPresentation;
    capability_request: CompilerCapabilityRequest | null;
    evidence: CompilerGapEvidence[];
    review_status: "open" | "accepted" | "resolved";
    resolution_note: string | null;
    created_at: string;
    updated_at: string;
};

export type CompilerArtifact = {
    id: string;
    artifact_type: "agent" | "flow";
    stable_key: string;
    role: string;
    agent_id: string | null;
    flow_id: string | null;
    created_at: string;
};

export type CompilerArtifactEvidence = {
    id: string;
    artifact_id: string;
    target_path: string;
    chunk_id: string;
    excerpt: string;
    recommendation_id: string;
    evidence_role: CompilerEvidenceRole;
    created_at: string;
};

export type CompilerRunReport = {
    run: CompilerRun;
    steps: CompilerStep[];
    gaps: CompilerGap[];
    artifacts: CompilerArtifact[];
    evidence: CompilerArtifactEvidence[];
};

const ACTIVE_COMPILER_STATUSES = new Set<CompilerRunStatus>(["queued", "planning", "compiling", "validating", "materializing"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_PATH_PATTERN = /^(?:agent|flow)(?:\.[A-Za-z0-9_-]+)+$/;
const STEP_KINDS = new Set<CompilerStepKind>(["plan", "retrieve", "extract", "reconcile", "resolve", "lower", "validate", "materialize"]);
const STEP_STATUSES = new Set<CompilerStepStatus>(["started", "completed", "failed", "skipped"]);
const GAP_SEVERITIES = new Set<CompilerGapSeverity>(["info", "warning", "blocking"]);
const REVIEW_STATUSES = new Set<CompilerGap["review_status"]>(["open", "accepted", "resolved"]);
const EVIDENCE_ROLES = new Set<CompilerEvidenceRole>(["requirement", "threshold", "timing", "exception", "population", "escalation"]);
const CAPABILITY_REQUEST_STATUSES = new Set<CompilerCapabilityRequestStatus>(COMPILER_CAPABILITY_REQUEST_STATUSES);

type RequestableGapDefinition = Omit<CompilerGapPresentation, "requestable"> & {
    capability: string;
};

const REQUESTABLE_GAP_PRESENTATION: Readonly<Record<string, RequestableGapDefinition>> = {
    threshold_requires_mapping: {
        title: "Clinical threshold cannot be evaluated",
        capability: "clinical.threshold_mapping",
        capabilityLabel: "Evaluate a clinical observation threshold",
        class: "missing_mapping",
    },
    unsupported_action_actor: {
        title: "Care-team work cannot be created",
        capability: "clinical.task",
        capabilityLabel: "Create work for a clinician",
        class: "missing_capability",
    },
};

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function uuidOrNull(value: unknown): string | null {
    return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function nonnegativeNumberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function compilerGapPresentation(code: string, missingCapability: string | null): CompilerGapPresentation {
    const definition = REQUESTABLE_GAP_PRESENTATION[code];
    if (!definition) {
        return {
            title: "Compiler gap",
            capabilityLabel: null,
            class: "unknown",
            requestable: false,
        };
    }
    if (missingCapability !== definition.capability) {
        return {
            title: definition.title,
            capabilityLabel: null,
            class: definition.class,
            requestable: false,
        };
    }
    return {
        title: definition.title,
        capabilityLabel: definition.capabilityLabel,
        class: definition.class,
        requestable: true,
    };
}

export function canRequestCompilerCapability(gap: CompilerGap): boolean {
    return gap.presentation.requestable && gap.capability_request === null;
}

export function canRecompileWithCapabilities(report: CompilerRunReport): boolean {
    return report.gaps.some(
        (gap) => gap.capability_request?.status === "resolved" && gap.capability_request.active_resolution_id !== null,
    );
}

export function compilerCapabilityRequestStatusLabel(status: CompilerCapabilityRequestStatus): string {
    return (
        {
            requested: "Requested",
            under_review: "Under review",
            needs_information: "More information needed",
            delivering: "Being delivered",
            resolved: "Resolved",
            declined: "Declined",
            cancelled: "Cancelled",
        } satisfies Record<CompilerCapabilityRequestStatus, string>
    )[status];
}

export function shouldPollCompilerRun(run: Pick<CompilerRun, "status"> | null): boolean {
    return !!run && ACTIVE_COMPILER_STATUSES.has(run.status);
}

export function canCancelCompilerRun(run: Pick<CompilerRun, "status"> | null): boolean {
    return !!run && ["queued", "planning", "compiling", "validating"].includes(run.status);
}

export function compilerStatusLabel(status: CompilerRunStatus): string {
    return (
        {
            queued: "Queued",
            planning: "Planning the care journey",
            compiling: "Compiling cited recommendations",
            validating: "Checking workflow safety",
            materializing: "Creating workspace drafts",
            completed: "Drafts ready",
            completed_with_gaps: "Drafts ready with gaps",
            failed: "Compilation failed",
            cancelled: "Compilation cancelled",
        } satisfies Record<CompilerRunStatus, string>
    )[status];
}

export function normalizeCompilerRunReport(input: unknown): CompilerRunReport | null {
    const root = record(input);
    const rawRun = record(root?.run);
    const status = rawRun?.status;
    const runId = uuidOrNull(rawRun?.id);
    const fileId = uuidOrNull(rawRun?.file_id);
    const versionId = uuidOrNull(rawRun?.file_version_id);
    if (!rawRun || !runId || !fileId || !versionId || typeof status !== "string" || !(COMPILER_RUN_STATUSES as readonly string[]).includes(status)) return null;
    if (rawRun.compiler_id !== "care_path") return null;
    const requiredStrings = [rawRun.provider, rawRun.model, rawRun.compiler_version, rawRun.prompt_version, rawRun.created_at, rawRun.updated_at];
    if (requiredStrings.some((value) => typeof value !== "string" || !value)) return null;
    if (!Number.isInteger(rawRun.attempt_count) || !Number.isInteger(rawRun.max_attempts)) return null;

    const rawCoverage = record(rawRun.coverage) ?? {};
    const coverage = Object.fromEntries(
        Object.entries(rawCoverage).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0),
    );
    const run: CompilerRun = {
        id: runId,
        file_id: fileId,
        file_version_id: versionId,
        compiler_id: "care_path",
        status: status as CompilerRunStatus,
        provider: rawRun.provider as string,
        model: rawRun.model as string,
        compiler_version: rawRun.compiler_version as string,
        prompt_version: rawRun.prompt_version as string,
        attempt_count: rawRun.attempt_count as number,
        max_attempts: rawRun.max_attempts as number,
        summary: stringOrNull(rawRun.summary),
        coverage,
        last_error_code: stringOrNull(rawRun.last_error_code),
        created_at: rawRun.created_at as string,
        started_at: stringOrNull(rawRun.started_at),
        completed_at: stringOrNull(rawRun.completed_at),
        updated_at: rawRun.updated_at as string,
        parent_run_id: rawRun.parent_run_id === null || rawRun.parent_run_id === undefined ? null : uuidOrNull(rawRun.parent_run_id),
        resolution_digest: stringOrNull(rawRun.resolution_digest),
    };

    const steps = (Array.isArray(root?.steps) ? root.steps : [])
        .flatMap((value): CompilerStep[] => {
            const item = record(value);
            const id = uuidOrNull(item?.id);
            if (
                !item ||
                !id ||
                !Number.isInteger(item.sequence) ||
                (item.sequence as number) < 1 ||
                typeof item.kind !== "string" ||
                !STEP_KINDS.has(item.kind as CompilerStepKind) ||
                typeof item.status !== "string" ||
                !STEP_STATUSES.has(item.status as CompilerStepStatus) ||
                typeof item.created_at !== "string"
            )
                return [];
            const inputRefs = record(item.input_refs) ?? {};
            const result = record(item.result) ?? {};
            const pageStart = Number.isInteger(item.page_start) && (item.page_start as number) > 0 ? (item.page_start as number) : null;
            const pageEnd = Number.isInteger(item.page_end) && (item.page_end as number) >= (pageStart ?? 1) ? (item.page_end as number) : pageStart;
            return [
                {
                    id,
                    sequence: item.sequence as number,
                    kind: item.kind as CompilerStepKind,
                    status: item.status as CompilerStepStatus,
                    task_key: stringOrNull(item.task_key),
                    page_start: pageStart,
                    page_end: pageEnd,
                    input_refs: inputRefs,
                    result,
                    input_tokens: nonnegativeNumberOrNull(item.input_tokens),
                    output_tokens: nonnegativeNumberOrNull(item.output_tokens),
                    duration_ms: nonnegativeNumberOrNull(item.duration_ms),
                    retry_count: Number.isInteger(item.retry_count) && (item.retry_count as number) >= 0 ? (item.retry_count as number) : 0,
                    error_code: stringOrNull(item.error_code),
                    created_at: item.created_at,
                },
            ];
        })
        .sort((left, right) => left.sequence - right.sequence);

    const gaps = (Array.isArray(root?.gaps) ? root.gaps : []).flatMap((value): CompilerGap[] => {
        const item = record(value);
        const id = uuidOrNull(item?.id);
        if (
            !item ||
            !id ||
            typeof item.code !== "string" ||
            !item.code ||
            typeof item.severity !== "string" ||
            !GAP_SEVERITIES.has(item.severity as CompilerGapSeverity) ||
            typeof item.explanation !== "string" ||
            !item.explanation ||
            typeof item.review_status !== "string" ||
            !REVIEW_STATUSES.has(item.review_status as CompilerGap["review_status"]) ||
            typeof item.created_at !== "string" ||
            typeof item.updated_at !== "string"
        )
            return [];
        const stepId = item.step_id === null ? null : uuidOrNull(item.step_id);
        if (item.step_id !== null && !stepId) return [];
        const details = record(item.details);
        if (!details) return [];
        const presentation = compilerGapPresentation(item.code, stringOrNull(item.missing_capability));
        const rawRequest = record(item.capability_request);
        let capabilityRequest: CompilerCapabilityRequest | null = null;
        if (rawRequest) {
            const requestId = uuidOrNull(rawRequest.id);
            const requestGapId = uuidOrNull(rawRequest.gap_id);
            const requestedContract = record(rawRequest.requested_contract);
            const requestStatus = rawRequest.status;
            const activeResolutionId =
                rawRequest.active_resolution_id === null ? null : uuidOrNull(rawRequest.active_resolution_id);
            if (
                requestId &&
                requestGapId === id &&
                requestedContract &&
                typeof rawRequest.capability_key === "string" &&
                rawRequest.capability_key === item.missing_capability &&
                typeof requestStatus === "string" &&
                CAPABILITY_REQUEST_STATUSES.has(requestStatus as CompilerCapabilityRequestStatus) &&
                typeof rawRequest.created_at === "string" &&
                typeof rawRequest.updated_at === "string" &&
                (rawRequest.active_resolution_id === null || activeResolutionId)
            ) {
                capabilityRequest = {
                    id: requestId,
                    gap_id: requestGapId,
                    capability_key: rawRequest.capability_key,
                    requested_contract: requestedContract,
                    status: requestStatus as CompilerCapabilityRequestStatus,
                    workspace_note: stringOrNull(rawRequest.workspace_note),
                    operator_response: stringOrNull(rawRequest.operator_response),
                    delivery_reference: stringOrNull(rawRequest.delivery_reference),
                    active_resolution_id: activeResolutionId,
                    created_at: rawRequest.created_at,
                    updated_at: rawRequest.updated_at,
                };
            }
        }
        const evidence = (Array.isArray(item.evidence) ? item.evidence : []).flatMap((candidate): CompilerGapEvidence[] => {
            const cited = record(candidate);
            const chunkId = uuidOrNull(cited?.chunk_id);
            if (
                !cited ||
                !chunkId ||
                typeof cited.excerpt !== "string" ||
                !cited.excerpt.trim() ||
                typeof cited.role !== "string" ||
                !EVIDENCE_ROLES.has(cited.role as CompilerEvidenceRole)
            )
                return [];
            return [
                {
                    chunk_id: chunkId,
                    excerpt: cited.excerpt.trim(),
                    role: cited.role as CompilerEvidenceRole,
                    recommendation_id: stringOrNull(cited.recommendation_id),
                },
            ];
        });
        return [
            {
                id,
                step_id: stepId,
                code: item.code,
                severity: item.severity as CompilerGapSeverity,
                recommendation_id: typeof item.recommendation_id === "string" ? item.recommendation_id : "",
                explanation: item.explanation,
                missing_capability: stringOrNull(item.missing_capability),
                details,
                presentation,
                capability_request: capabilityRequest,
                evidence,
                review_status: item.review_status as CompilerGap["review_status"],
                resolution_note: stringOrNull(item.resolution_note),
                created_at: item.created_at,
                updated_at: item.updated_at,
            },
        ];
    });

    const artifacts = (Array.isArray(root?.artifacts) ? root.artifacts : []).flatMap((value): CompilerArtifact[] => {
        const item = record(value);
        const id = uuidOrNull(item?.id);
        if (
            !item ||
            !id ||
            (item.artifact_type !== "agent" && item.artifact_type !== "flow") ||
            typeof item.stable_key !== "string" ||
            !item.stable_key ||
            typeof item.role !== "string" ||
            typeof item.created_at !== "string"
        )
            return [];
        const agentId = item.agent_id === null ? null : uuidOrNull(item.agent_id);
        const flowId = item.flow_id === null ? null : uuidOrNull(item.flow_id);
        if ((item.agent_id !== null && !agentId) || (item.flow_id !== null && !flowId)) return [];
        if ((item.artifact_type === "agent" && flowId) || (item.artifact_type === "flow" && agentId)) return [];
        return [
            {
                id,
                artifact_type: item.artifact_type,
                stable_key: item.stable_key,
                role: item.role,
                agent_id: agentId,
                flow_id: flowId,
                created_at: item.created_at,
            },
        ];
    });

    const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
    const evidence = (Array.isArray(root?.evidence) ? root.evidence : []).flatMap((value): CompilerArtifactEvidence[] => {
        const item = record(value);
        const id = uuidOrNull(item?.id);
        const artifactId = uuidOrNull(item?.artifact_id);
        const chunkId = uuidOrNull(item?.chunk_id);
        if (
            !item ||
            !id ||
            !artifactId ||
            !artifactIds.has(artifactId) ||
            !chunkId ||
            typeof item.target_path !== "string" ||
            !TARGET_PATH_PATTERN.test(item.target_path) ||
            typeof item.excerpt !== "string" ||
            !item.excerpt.trim() ||
            typeof item.evidence_role !== "string" ||
            !EVIDENCE_ROLES.has(item.evidence_role as CompilerEvidenceRole) ||
            typeof item.created_at !== "string"
        )
            return [];
        return [
            {
                id,
                artifact_id: artifactId,
                target_path: item.target_path,
                chunk_id: chunkId,
                excerpt: item.excerpt.trim(),
                recommendation_id: typeof item.recommendation_id === "string" ? item.recommendation_id : "",
                evidence_role: item.evidence_role as CompilerEvidenceRole,
                created_at: item.created_at,
            },
        ];
    });

    return { run, steps, gaps, artifacts, evidence };
}

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

export function pdfPointBoxToViewport(box: DocumentLayoutBox, page: DocumentLayoutPage, scale: number): ViewportRectangle {
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
    const linked = chunkId ? items.filter((item) => item.chunk_ids.includes(chunkId)).sort((left, right) => left.ordinal - right.ordinal) : [];
    const spans = linked.flatMap((item) => item.spans.map((span) => ({ ...span, item_id: item.id })));
    const firstPage = spans.reduce<number | null>((page, span) => (page === null ? span.page_number : Math.min(page, span.page_number)), null);
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

export function selectDocumentVersion(versions: DocumentVersion[], selectedId: string | null, currentVersion: number): string | null {
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

export function normalizeCompilerRecommendations(recommendations: RawCompilerRecommendation[]): CompilerRecommendation[] {
    const byCompiler = new Map<keyof typeof COMPILERS, CompilerRecommendation>();
    for (const recommendation of recommendations) {
        if (!(recommendation.compiler_id in COMPILERS)) continue;
        const compilerId = recommendation.compiler_id as keyof typeof COMPILERS;
        const normalized = {
            ...recommendation,
            compiler_id: compilerId,
            label: COMPILERS[compilerId],
            confidence: Math.max(0, Math.min(1, recommendation.confidence)),
        };
        const existing = byCompiler.get(compilerId);
        if (!existing) {
            byCompiler.set(compilerId, normalized);
            continue;
        }

        const evidence = [...existing.evidence];
        const evidenceKeys = new Set(evidence.map((item) => JSON.stringify(item)));
        for (const item of normalized.evidence) {
            const key = JSON.stringify(item);
            if (!evidenceKeys.has(key)) {
                evidenceKeys.add(key);
                evidence.push(item);
            }
        }
        const strongest = normalized.confidence > existing.confidence ? normalized : existing;
        byCompiler.set(compilerId, { ...strongest, evidence });
    }
    return [...byCompiler.values()];
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
                        const pageEnd = typeof value.page_end === "number" && value.page_end >= (page ?? 1) ? value.page_end : page;
                        return [
                            {
                                text: value.text.trim(),
                                page,
                                page_end: pageEnd,
                                chunk_id: typeof value.chunk_id === "string" ? value.chunk_id : null,
                                version_id: typeof value.version_id === "string" ? value.version_id : null,
                                section_path: Array.isArray(value.section_path)
                                    ? value.section_path.filter((part): part is string => typeof part === "string")
                                    : [],
                            },
                        ];
                    })
                  : [];
              return [
                  {
                      compiler_id: recommendation.compiler_id,
                      confidence: recommendation.confidence,
                      reason: recommendation.reason,
                      evidence,
                  },
              ];
          })
        : [];
    return {
        summary: raw.summary,
        recommendations: normalizeCompilerRecommendations(recommendations),
        gaps: Array.isArray(raw.gaps) ? raw.gaps.filter((gap): gap is string => typeof gap === "string") : [],
        analyzed_at: typeof raw.analyzed_at === "string" ? raw.analyzed_at : undefined,
    };
}

export function formatDocumentSize(bytes: number | null): string {
    if (bytes === null) return "Unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
