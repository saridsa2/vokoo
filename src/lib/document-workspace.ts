export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

const ACCEPTED_DOCUMENT_TYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
]);

export type CompilerEvidence = {
    page: number | null;
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

export function formatDocumentSize(bytes: number | null): string {
    if (bytes === null) return "Unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
