"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { useNotify } from "@/components/application/notifications/notification-provider";
import { PdfDocumentViewer } from "@/components/application/documents/pdf-document-viewer";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { IconDocument, SearchLg } from "@/components/icons";
import { useResource } from "@/hooks/use-resource";
import { useSession } from "@/hooks/use-session";
import {
    canCancelCompilerRun,
    compilerStatusLabel,
    documentUploadProblem,
    documentProcessingLabel,
    formatDocumentSize,
    normalizeCompilerRunReport,
    normalizeDocumentEvidence,
    normalizeCompilerRecommendations,
    selectDocument,
    selectDocumentVersion,
    selectEvidenceLayout,
    shouldPollDocumentJob,
    shouldPollCompilerRun,
    validateHistoricalSearch,
    type DocumentJob,
    type CompilerEvidence,
    type CompilerRunReport,
    type DocumentIntelligence,
    type DocumentLayout,
    type DocumentVersion,
    type WorkspaceDocument,
} from "@/lib/document-workspace";
import { api, type DocumentSearchResult } from "@/utils/api-client";
import { timeAgo } from "@/utils/format";

async function sourceBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunk = 32_768;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
}

function canonicalMimeType(file: File): string {
    if (file.type) return file.type;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "pdf") return "application/pdf";
    if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (extension === "md") return "text/markdown";
    return "text/plain";
}

export function DocumentsScreen() {
    const { records, isLoading, error, refresh } = useResource<WorkspaceDocument>("files");
    const { context } = useSession();
    const notify = useNotify();
    const picker = useRef<HTMLInputElement>(null);
    const replacementPicker = useRef<HTMLInputElement>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [versions, setVersions] = useState<DocumentVersion[]>([]);
    const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
    const [job, setJob] = useState<DocumentJob | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [semanticQuery, setSemanticQuery] = useState("");
    const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([]);
    const [unavailableDocuments, setUnavailableDocuments] = useState(0);
    const [isSearching, setIsSearching] = useState(false);
    const [source, setSource] = useState<Blob | null>(null);
    const [sourceText, setSourceText] = useState("");
    const [layout, setLayout] = useState<DocumentLayout | null>(null);
    const [sourceError, setSourceError] = useState<string | null>(null);
    const [selectedEvidence, setSelectedEvidence] = useState<Pick<CompilerEvidence, "chunk_id" | "page"> | null>(null);
    const [compilerReport, setCompilerReport] = useState<CompilerRunReport | null>(null);
    const [isStartingCompiler, setIsStartingCompiler] = useState(false);
    const [isCancellingCompiler, setIsCancellingCompiler] = useState(false);

    useEffect(() => {
        setSelectedId((current) => selectDocument(records, current));
    }, [records]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle ? records.filter((document) => document.name.toLowerCase().includes(needle)) : records;
    }, [records, query]);
    const selected = records.find((document) => document.id === selectedId) ?? null;

    const loadVersions = useCallback(async (document: WorkspaceDocument) => {
        if (!context) return [];
        const { data } = await api.listDocumentVersions<DocumentVersion>(document.id, context);
        setVersions(data);
        setSelectedVersionId((current) =>
            selectDocumentVersion(data, current, document.current_version),
        );
        return data;
    }, [context]);

    useEffect(() => {
        setJob((current) => current?.file_id === selected?.id ? current : null);
        setCompilerReport(null);
        setSearchResults([]);
        setUnavailableDocuments(0);
        if (!selected) {
            setVersions([]);
            setSelectedVersionId(null);
            return;
        }
        void loadVersions(selected).catch((cause) =>
            notify.failure("Could not load document versions", cause),
        );
    }, [selected?.id, selected?.current_version, loadVersions]);

    useEffect(() => {
        if (!context || !shouldPollDocumentJob(job)) return;
        const timer = window.setTimeout(() => {
            void api
                .getDocumentJob(job!.id, context)
                .then(async ({ data }) => {
                    setJob(data);
                    if (!shouldPollDocumentJob(data) && selected) {
                        await Promise.all([refresh(), loadVersions(selected)]);
                    }
                })
                .catch((cause) => notify.failure("Could not refresh document progress", cause));
        }, 1_500);
        return () => window.clearTimeout(timer);
    }, [context, job, loadVersions, notify, refresh, selected]);

    const selectedVersion =
        versions.find((version) => version.id === selectedVersionId) ?? null;
    const intelligence = normalizeDocumentEvidence(
        selectedVersion?.intelligence ??
            (selectedVersion?.version === selected?.current_version ? selected?.intelligence : null),
    );
    const carePathRecommended = intelligence?.recommendations.some((item) => item.compiler_id === "care_path") ?? false;
    const stage = job && job.file_version_id === selectedVersion?.id
        ? job.stage
        : selectedVersion?.status ?? selected?.status ?? "queued";

    useEffect(() => {
        let cancelled = false;
        setSource(null);
        setSourceText("");
        setLayout(null);
        setSourceError(null);
        setSelectedEvidence(null);
        if (!context || !selected || !selectedVersion) return;
        void Promise.all([
            api.documentSource(selected.id, selectedVersion.version, context),
            api.documentLayout(selected.id, selectedVersion.version, context),
        ]).then(async ([blob, response]) => {
            if (cancelled) return;
            setSource(blob);
            setLayout(response.data);
            if (selectedVersion.mime_type !== "application/pdf") setSourceText(await blob.text());
        }).catch((cause) => {
            if (!cancelled) setSourceError(cause instanceof Error ? cause.message : "The source could not be loaded.");
        });
        return () => {
            cancelled = true;
        };
    }, [context, selected?.id, selectedVersion?.id]);

    const evidenceSelection = useMemo(
        () => selectEvidenceLayout(
            layout?.items ?? [],
            selectedEvidence?.chunk_id,
            selectedEvidence?.page ?? null,
        ),
        [layout?.items, selectedEvidence],
    );

    const loadCompilerReport = useCallback(async (runId: string) => {
        if (!context) return null;
        const response = await api.getCompilerRun(runId, context);
        const normalized = normalizeCompilerRunReport(response.data);
        if (!normalized) throw new Error("The compiler returned an invalid report.");
        setCompilerReport(normalized);
        return normalized;
    }, [context]);

    useEffect(() => {
        if (!compilerReport || !shouldPollCompilerRun(compilerReport.run)) return;
        const timer = window.setTimeout(() => {
            void loadCompilerReport(compilerReport.run.id)
                .catch((cause) => notify.failure("Could not refresh compiler progress", cause));
        }, 1_500);
        return () => window.clearTimeout(timer);
    }, [compilerReport, loadCompilerReport, notify]);

    useEffect(() => {
        if (
            !context ||
            !selected ||
            !selectedVersion ||
            job?.file_version_id === selectedVersion.id ||
            ["indexed", "ready", "failed", "permanent_failed"].includes(selectedVersion.status)
        ) return;
        void api
            .processDocumentVersion(selected.id, selectedVersion.version, context)
            .then(({ data }) => setJob(data.job))
            .catch((cause) => notify.failure("Could not resume document progress", cause));
    }, [context, job?.file_version_id, notify, selected, selectedVersion]);

    async function upload(file: File, replacement = false) {
        const problem = documentUploadProblem(file);
        if (problem) {
            notify.failure("Could not add the document", new Error(problem));
            return;
        }
        if (!context) return;
        setIsUploading(true);
        try {
            const body = {
                mime_type: canonicalMimeType(file),
                content_base64: await sourceBase64(file),
            };
            if (replacement && selected) {
                const { data: version } = await api.uploadDocumentVersion<DocumentVersion>(
                    selected.id,
                    body,
                    context,
                );
                const { data } = await api.processDocumentVersion(
                    selected.id,
                    version.version,
                    context,
                );
                setJob(data.job);
                setSelectedVersionId(version.id);
                await Promise.all([refresh(), loadVersions({ ...selected, current_version: version.version })]);
                notify.success("New version uploaded", "Indexing continues in the background.");
            } else {
                const { data } = await api.uploadDocument<WorkspaceDocument>(
                    { name: file.name, ...body },
                    context,
                );
                const queued = await api.analyzeDocument<{ job: DocumentJob }>(data.id, context);
                setJob(queued.data.job);
                await refresh();
                setSelectedId(data.id);
                notify.success("Document added", "Indexing continues in the background.");
            }
        } catch (cause) {
            notify.failure(replacement ? "Could not upload the new version" : "Could not add the document", cause);
        } finally {
            setIsUploading(false);
            if (picker.current) picker.current.value = "";
            if (replacementPicker.current) replacementPicker.current.value = "";
        }
    }

    async function processVersion() {
        if (!selected || !selectedVersion || !context) return;
        setIsProcessing(true);
        try {
            const { data } = await api.processDocumentVersion(
                selected.id,
                selectedVersion.version,
                context,
            );
            setJob(data.job);
            notify.success("Document queued", "Processing resumes from the last completed stage.");
        } catch (cause) {
            notify.failure("Could not process the document", cause);
        } finally {
            setIsProcessing(false);
        }
    }

    async function searchDocument() {
        if (!selected || !selectedVersion || !context) return;
        const request = selectedVersion.version === selected.current_version
            ? { query: semanticQuery, limit: 10, document_ids: [selected.id] }
            : {
                  query: semanticQuery,
                  limit: 10,
                  versions: [{ document_id: selected.id, version: selectedVersion.version }],
              };
        const problem = validateHistoricalSearch(request);
        if (problem) {
            notify.failure("Could not search the document", new Error(problem));
            return;
        }
        setIsSearching(true);
        try {
            const { data } = await api.searchDocuments(request, context);
            setSearchResults(data.results);
            setUnavailableDocuments(data.unavailable_current_documents);
        } catch (cause) {
            notify.failure("Could not search the document", cause);
        } finally {
            setIsSearching(false);
        }
    }

    async function startCompiler() {
        if (!selected || !selectedVersion || !context || selectedVersion.status !== "indexed" || !carePathRecommended) return;
        setIsStartingCompiler(true);
        try {
            const { data } = await api.startDocumentCompilation(selected.id, selectedVersion.version, "care_path", context);
            await loadCompilerReport(data.id);
            notify.success("Compilation started", "The compiler is creating cited workspace drafts in the background.");
        } catch (cause) {
            notify.failure("Could not start compilation", cause);
        } finally {
            setIsStartingCompiler(false);
        }
    }

    async function cancelCompiler() {
        if (!compilerReport || !context || !canCancelCompilerRun(compilerReport.run)) return;
        setIsCancellingCompiler(true);
        try {
            await api.cancelCompilerRun(compilerReport.run.id, context);
            await loadCompilerReport(compilerReport.run.id);
            notify.success("Compilation cancelled", "No workspace drafts were created by this run.");
        } catch (cause) {
            notify.failure("Could not cancel compilation", cause);
        } finally {
            setIsCancellingCompiler(false);
        }
    }

    return (
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-secondary lg:border-r">
                <div className="flex items-center justify-between px-5 py-4">
                    <h1 className="text-sm font-semibold text-primary">Documents</h1>
                    <span className="text-sm text-tertiary">{query ? `${visible.length}/${records.length}` : records.length}</span>
                </div>
                <div className="flex flex-col gap-3 px-4 pb-3">
                    <input
                        ref={picker}
                        type="file"
                        accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown"
                        className="sr-only"
                        aria-label="Choose a document"
                        onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void upload(file, false);
                        }}
                    />
                    <input
                        ref={replacementPicker}
                        type="file"
                        accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown"
                        className="sr-only"
                        aria-label="Choose a new document version"
                        onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void upload(file, true);
                        }}
                    />
                    <Button size="sm" className="w-full" isLoading={isUploading} showTextWhileLoading onClick={() => picker.current?.click()}>
                        Add document
                    </Button>
                    {records.length > 0 && (
                        <Input
                            size="sm"
                            icon={SearchLg}
                            placeholder="Search documents"
                            aria-label="Search documents"
                            value={query}
                            onChange={(value) => setQuery(String(value))}
                        />
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                    {isLoading && Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="mb-1 flex gap-3 px-3 py-3">
                            <div className="size-8 animate-pulse rounded-md bg-secondary" />
                            <div className="flex flex-1 flex-col gap-2"><div className="h-3 w-2/3 animate-pulse rounded bg-secondary" /><div className="h-2.5 w-1/2 animate-pulse rounded bg-secondary" /></div>
                        </div>
                    ))}
                    {!isLoading && error && <p className="px-3 py-8 text-sm text-error-primary">{error.message}</p>}
                    {!isLoading && !error && records.length === 0 && (
                        <div className="px-4 py-10 text-center">
                            <IconDocument className="mx-auto size-6 text-quaternary" />
                            <p className="mt-3 text-sm font-medium text-primary">Add the first source</p>
                            <p className="mt-1 text-sm text-tertiary">Guidelines, policies, and reference documents remain versioned here.</p>
                        </div>
                    )}
                    {!isLoading && records.length > 0 && visible.length === 0 && <p className="px-3 py-8 text-center text-sm text-tertiary">Nothing matches “{query}”.</p>}
                    {visible.map((document) => (
                        <button
                            key={document.id}
                            type="button"
                            onClick={() => setSelectedId(document.id)}
                            className={`mb-0.5 flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition duration-100 ${document.id === selectedId ? "bg-active" : "hover:bg-primary_hover"}`}
                        >
                            <IconDocument className="mt-0.5 size-4 shrink-0 text-tertiary" />
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-primary">{document.name}</span>
                                <span className="block truncate text-xs text-tertiary">Version {document.current_version} · {formatDocumentSize(document.size_bytes)}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                {!selected ? (
                    <div className="grid flex-1 place-items-center p-8"><p className="text-sm text-tertiary">{isLoading ? "Loading…" : "Select a document."}</p></div>
                ) : (
                    <>
                        <header className="shrink-0 border-b border-secondary px-6 py-5">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <h2 className="truncate text-xl font-semibold text-primary">{selected.name}</h2>
                                    <p className="mt-1 text-sm text-tertiary">
                                        Version {selectedVersion?.version ?? selected.current_version}
                                        {selectedVersion && selectedVersion.version !== selected.current_version ? " · Historical" : " · Current"}
                                        {` · ${formatDocumentSize(selectedVersion?.size_bytes ?? selected.size_bytes)}`}
                                        {selected.updated_at ? ` · Updated ${timeAgo(selected.updated_at)}` : ""}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {versions.length > 0 ? (
                                        <select
                                            aria-label="Document version"
                                            className="h-9 rounded-lg border border-primary bg-primary px-3 text-sm text-primary outline-none focus:ring-2 focus:ring-brand"
                                            value={selectedVersionId ?? ""}
                                            onChange={(event) => {
                                                setSelectedVersionId(event.currentTarget.value);
                                                setJob(null);
                                                setCompilerReport(null);
                                                setSearchResults([]);
                                            }}
                                        >
                                            {versions.map((version) => (
                                                <option key={version.id} value={version.id}>
                                                    Version {version.version}{version.version === selected.current_version ? " (current)" : ""}
                                                </option>
                                            ))}
                                        </select>
                                    ) : null}
                                    <Button
                                        size="sm"
                                        color="secondary"
                                        isLoading={isUploading}
                                        showTextWhileLoading
                                        onClick={() => replacementPicker.current?.click()}
                                    >
                                        Upload new version
                                    </Button>
                                    <Badge
                                        size="sm"
                                        type="pill-color"
                                        color={stage === "indexed" || stage === "ready" ? "success" : stage === "permanent_failed" || stage === "failed" ? "error" : "gray"}
                                    >
                                        {documentProcessingLabel(stage)}
                                    </Badge>
                                </div>
                            </div>
                        </header>

                        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
                            <div className="min-h-[50vh] min-w-0 overflow-hidden border-secondary xl:min-h-0 xl:border-r">
                                {selectedVersion?.mime_type === "application/pdf" ? (
                                    <PdfDocumentViewer
                                        source={source}
                                        pages={layout?.pages ?? []}
                                        highlights={evidenceSelection.spans}
                                        targetPage={evidenceSelection.page}
                                        error={sourceError}
                                    />
                                ) : (
                                    <div className="h-full overflow-auto bg-secondary p-5">
                                        {sourceError ? (
                                            <p className="text-sm text-error-primary">{sourceError}</p>
                                        ) : (
                                            <pre className="mx-auto min-h-full max-w-3xl whitespace-pre-wrap bg-primary p-6 text-sm leading-6 text-secondary shadow-xs ring-1 ring-secondary">
                                                {sourceText || "Loading source…"}
                                            </pre>
                                        )}
                                    </div>
                                )}
                            </div>
                            <aside className="min-h-0 overflow-y-auto p-5">
                              <div className="flex flex-col gap-5">
                                <div className="flex items-start justify-between gap-4 border-b border-secondary pb-4">
                                    <div>
                                        <h3 className="text-md font-semibold text-primary">Workspace Intelligence</h3>
                                        <p className="mt-1 max-w-2xl text-sm text-tertiary">Identifies the source and recommends registered compilers. It does not create or publish workspace artifacts.</p>
                                    </div>
                                    {stage !== "indexed" && stage !== "ready" ? (
                                        <Button
                                            size="sm"
                                            color="secondary"
                                            isLoading={isProcessing}
                                            showTextWhileLoading
                                            onClick={processVersion}
                                        >
                                            {stage === "permanent_failed" || stage === "failed" ? "Retry processing" : "Process version"}
                                        </Button>
                                    ) : null}
                                </div>

                                {shouldPollDocumentJob(job) ? (
                                    <div
                                        className="rounded-xl bg-secondary px-5 py-4 ring-1 ring-secondary"
                                        role="status"
                                        aria-live="polite"
                                        aria-label="Document processing progress"
                                    >
                                        <p className="text-sm font-medium text-primary">{documentProcessingLabel(job!.stage)}</p>
                                        <p className="mt-1 text-sm text-tertiary">
                                            Attempt {job!.attempt_count} of {job!.max_attempts}. You can leave this page while the worker continues.
                                        </p>
                                    </div>
                                ) : null}

                                {(stage === "permanent_failed" || stage === "failed") ? (
                                    <div className="rounded-xl border border-error-primary px-5 py-4" role="alert">
                                        <p className="text-sm font-medium text-error-primary">This version could not be indexed</p>
                                        <p className="mt-1 text-sm text-tertiary">
                                            {job?.last_error_detail ?? selectedVersion?.processing_error?.detail ?? "Correct the source or provider configuration, then retry."}
                                        </p>
                                    </div>
                                ) : null}

                                <IntelligenceResult
                                    intelligence={intelligence}
                                    version={selectedVersion?.version ?? selected.current_version}
                                    onEvidence={setSelectedEvidence}
                                    canCompile={selectedVersion?.status === "indexed" && carePathRecommended && !compilerReport}
                                    isCompiling={isStartingCompiler}
                                    onCompile={startCompiler}
                                />

                                {compilerReport ? (
                                    <CompilerReview
                                        report={compilerReport}
                                        isCancelling={isCancellingCompiler}
                                        onCancel={cancelCompiler}
                                        onEvidence={(chunkId) => setSelectedEvidence({ chunk_id: chunkId, page: null })}
                                    />
                                ) : null}

                                <section className="border-t border-secondary pt-5" aria-labelledby="document-search-title">
                                    <h3 id="document-search-title" className="text-md font-semibold text-primary">Search this document</h3>
                                    <p className="mt-1 text-sm text-tertiary">
                                        Semantic and exact-term search stays on {selectedVersion?.version === selected.current_version ? "the current version" : `historical version ${selectedVersion?.version ?? selected.current_version}`}.
                                    </p>
                                    <form
                                        className="mt-3 flex gap-2"
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            void searchDocument();
                                        }}
                                    >
                                        <Input
                                            aria-label="Search document contents"
                                            placeholder="Find a recommendation or clinical identifier"
                                            value={semanticQuery}
                                            onChange={(value) => setSemanticQuery(String(value))}
                                        />
                                        <Button type="submit" isLoading={isSearching} showTextWhileLoading>
                                            Search
                                        </Button>
                                    </form>
                                    {unavailableDocuments > 0 ? (
                                        <p className="mt-3 text-sm text-warning-primary" role="status">
                                            This current document is still indexing, so no older version was substituted.
                                        </p>
                                    ) : null}
                                    {searchResults.length > 0 ? (
                                        <ol className="mt-4 flex flex-col gap-3">
                                            {searchResults.map((result) => (
                                                <li key={result.chunk_id} className="overflow-hidden rounded-xl ring-1 ring-secondary">
                                                    <button
                                                        type="button"
                                                        className="w-full px-4 py-3 text-left hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                                                        onClick={() => setSelectedEvidence({
                                                            chunk_id: result.chunk_id,
                                                            page: result.page_start,
                                                        })}
                                                    >
                                                        <p className="text-sm leading-6 text-secondary">{result.text}</p>
                                                        <p className="mt-2 text-xs text-quaternary">
                                                            Version {result.version}
                                                            {result.page_start ? ` · Page ${result.page_start}${result.page_end && result.page_end !== result.page_start ? `–${result.page_end}` : ""}` : ""}
                                                            {result.section_path.length ? ` · ${result.section_path.join(" › ")}` : ""}
                                                        </p>
                                                    </button>
                                                </li>
                                            ))}
                                        </ol>
                                    ) : null}
                                </section>
                              </div>
                            </aside>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}

function IntelligenceResult({
    intelligence,
    version,
    onEvidence,
    canCompile,
    isCompiling,
    onCompile,
}: {
    intelligence: DocumentIntelligence | null;
    version: number;
    onEvidence: (evidence: Pick<CompilerEvidence, "chunk_id" | "page">) => void;
    canCompile: boolean;
    isCompiling: boolean;
    onCompile: () => void;
}) {
    if (!intelligence) {
        return (
            <div className="rounded-xl border border-dashed border-secondary px-6 py-10 text-center">
                <p className="text-sm font-medium text-primary">Not reviewed yet</p>
                <p className="mt-1 text-sm text-tertiary">Index this version to see what it contains and which compiler fits it.</p>
            </div>
        );
    }
    const recommendations = normalizeCompilerRecommendations(intelligence.recommendations);
    return (
        <div className="flex flex-col gap-5">
            <p className="max-w-2xl text-sm leading-6 text-secondary">{intelligence.summary}</p>
            {recommendations.length === 0 ? (
                <div className="rounded-xl bg-secondary px-5 py-4 ring-1 ring-secondary">
                    <p className="text-sm font-medium text-primary">No compiler recommended</p>
                    <p className="mt-1 text-sm text-tertiary">This document remains available as workspace knowledge.</p>
                </div>
            ) : recommendations.map((recommendation) => (
                <article key={recommendation.compiler_id} className="overflow-hidden rounded-xl ring-1 ring-secondary">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-secondary bg-secondary px-5 py-4">
                        <div>
                            <p className="text-sm font-semibold text-primary">{recommendation.label}</p>
                            <p className="mt-1 text-sm text-tertiary">This document can be converted into a workflow draft.</p>
                        </div>
                        <Badge size="sm" type="pill-color" color="brand">{Math.round(recommendation.confidence * 100)}% match</Badge>
                    </div>
                    <div className="px-5 py-4">
                        <p className="text-sm text-secondary">{recommendation.reason}</p>
                        {canCompile ? (
                            <Button size="sm" className="mt-4" isLoading={isCompiling} showTextWhileLoading onClick={onCompile}>
                                Compile into workflow
                            </Button>
                        ) : null}
                        {recommendation.evidence.length > 0 && (
                            <div className="mt-4 flex flex-col gap-3">
                        <p className="text-xs font-medium text-tertiary">Evidence in version {version}</p>
                                {recommendation.evidence.map((evidence, index) => (
                                    <button
                                        key={`${evidence.page}-${index}`}
                                        type="button"
                                        className="border-l-2 border-brand py-1 pl-3 text-left text-sm text-tertiary hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-brand"
                                        onClick={() => onEvidence(evidence)}
                                    >
                                        “{evidence.text}”
                                        <span className="ml-2 text-xs text-quaternary">
                                            {evidence.page ? `Page ${evidence.page}${evidence.page_end && evidence.page_end !== evidence.page ? `–${evidence.page_end}` : ""}` : "Location unavailable"}
                                            {evidence.section_path?.length ? ` · ${evidence.section_path.join(" › ")}` : ""}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </article>
            ))}
            {intelligence.gaps.length > 0 && (
                <div>
                    <p className="text-sm font-medium text-primary">Needs attention</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-tertiary">{intelligence.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
                </div>
            )}
        </div>
    );
}

function traceSummary(step: CompilerRunReport["steps"][number]): string {
    if (typeof step.result.summary === "string" && step.result.summary.trim()) return step.result.summary;
    const counts = ["agent_count", "flow_count", "gap_count", "task_count"].flatMap((key) =>
        typeof step.result[key] === "number" ? [`${String(key).replace("_", " ")}: ${step.result[key]}`] : [],
    );
    if (counts.length) return counts.join(" · ");
    if (step.result.output_stored === true) return "Compiler output stored for deterministic validation.";
    return step.status === "completed" ? "Completed." : step.error_code ?? step.status;
}

function CompilerReview({
    report,
    isCancelling,
    onCancel,
    onEvidence,
}: {
    report: CompilerRunReport;
    isCancelling: boolean;
    onCancel: () => void;
    onEvidence: (chunkId: string) => void;
}) {
    const active = shouldPollCompilerRun(report.run);
    const artifactsById = new Map(report.artifacts.map((artifact) => [artifact.id, artifact]));
    const coverage = report.run.coverage;
    return (
        <section className="border-t border-secondary pt-5" aria-labelledby="compiler-review-title">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 id="compiler-review-title" className="text-md font-semibold text-primary">Compiler review</h3>
                    <p className="mt-1 text-sm text-tertiary">{report.run.summary ?? "The compiler run is retained with its cited decisions and gaps."}</p>
                </div>
                {canCancelCompilerRun(report.run) ? (
                    <Button size="sm" color="secondary-destructive" isLoading={isCancelling} showTextWhileLoading onClick={onCancel}>
                        Cancel
                    </Button>
                ) : null}
            </div>

            <div className="mt-4 rounded-xl bg-secondary px-4 py-3 ring-1 ring-secondary" role="status" aria-live="polite" aria-label="Compiler progress">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-primary">{compilerStatusLabel(report.run.status)}</p>
                    <span className="text-xs text-tertiary">Attempt {report.run.attempt_count}/{report.run.max_attempts}</span>
                </div>
                {active ? <p className="mt-1 text-xs text-tertiary">You can leave this page while the durable worker continues.</p> : null}
                {report.run.status === "failed" ? <p className="mt-1 text-xs text-error-primary">Error: {report.run.last_error_code ?? "compiler_failed"}</p> : null}
            </div>

            {!active && report.run.status !== "cancelled" ? (
                <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Compilation coverage">
                    {(["flow_count", "agent_count", "gap_count"] as const).map((key) => (
                        <div key={key} className="rounded-lg border border-secondary px-3 py-2">
                            <p className="text-lg font-semibold text-primary">{coverage[key] ?? 0}</p>
                            <p className="text-xs text-tertiary">{key === "flow_count" ? "Flows" : key === "agent_count" ? "Agents" : "Gaps"}</p>
                        </div>
                    ))}
                </div>
            ) : null}

            {report.artifacts.length > 0 ? (
                <div className="mt-5">
                    <p className="text-sm font-medium text-primary">Generated drafts</p>
                    <ul className="mt-2 space-y-2">
                        {report.artifacts.map((artifact) => {
                            const resourceId = artifact.artifact_type === "flow" ? artifact.flow_id : artifact.agent_id;
                            const href = resourceId ? (artifact.artifact_type === "flow" ? `/flows/${resourceId}` : `/team/${resourceId}`) : null;
                            return (
                                <li key={artifact.id} className="rounded-lg border border-secondary px-3 py-2 text-sm">
                                    {href ? <Link className="font-medium text-brand-secondary hover:underline" href={href}>{artifact.stable_key}</Link> : <span className="font-medium text-tertiary">{artifact.stable_key}</span>}
                                    <span className="ml-2 text-xs text-quaternary">{artifact.artifact_type}{href ? " · Draft" : " · Unavailable (deleted)"}</span>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="mt-2 text-xs text-tertiary"><code>escalate.notify</code> creates trackable escalation work.</p>
                </div>
            ) : null}

            {report.gaps.length > 0 ? (
                <div className="mt-5">
                    <p className="text-sm font-medium text-primary">Gaps requiring review</p>
                    <ul className="mt-2 space-y-3">
                        {report.gaps.map((gap) => (
                            <li key={gap.id} className="rounded-lg border border-warning-primary px-3 py-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-primary">{gap.code}</span>
                                    <Badge size="sm" type="pill-color" color={gap.severity === "blocking" ? "error" : gap.severity === "warning" ? "warning" : "gray"}>{gap.severity}</Badge>
                                </div>
                                <p className="mt-1 text-sm text-tertiary">{gap.explanation}</p>
                                {gap.missing_capability ? <p className="mt-1 text-xs text-quaternary">Missing capability: {gap.missing_capability}</p> : null}
                                {gap.evidence.map((evidence, index) => (
                                    <button key={`${evidence.chunk_id}-${index}`} type="button" className="mt-2 block border-l-2 border-brand pl-2 text-left text-xs text-tertiary hover:bg-primary_hover" onClick={() => onEvidence(evidence.chunk_id)}>
                                        “{evidence.excerpt}”
                                    </button>
                                ))}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {report.evidence.length > 0 ? (
                <div className="mt-5">
                    <p className="text-sm font-medium text-primary">Artifact evidence</p>
                    <ul className="mt-2 space-y-2">
                        {report.evidence.map((evidence) => (
                            <li key={evidence.id}>
                                <button type="button" className="w-full rounded-lg border border-secondary px-3 py-2 text-left hover:bg-primary_hover" onClick={() => onEvidence(evidence.chunk_id)}>
                                    <p className="text-xs font-medium text-primary">{artifactsById.get(evidence.artifact_id)?.stable_key ?? "Generated artifact"} · {evidence.target_path}</p>
                                    <p className="mt-1 line-clamp-3 text-xs text-tertiary">“{evidence.excerpt}”</p>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {report.steps.length > 0 ? (
                <details className="mt-5 rounded-lg border border-secondary px-3 py-3">
                    <summary className="cursor-pointer text-sm font-medium text-primary">Structured trace ({report.steps.length})</summary>
                    <ol className="mt-3 space-y-3">
                        {report.steps.map((step) => (
                            <li key={step.id} className="text-xs text-tertiary">
                                <p className="font-medium text-primary">{step.sequence}. {step.kind}{step.task_key ? ` · ${step.task_key}` : ""}</p>
                                <p className="mt-0.5">{traceSummary(step)}</p>
                                <p className="mt-0.5 text-quaternary">
                                    {step.page_start ? `Page ${step.page_start}${step.page_end && step.page_end !== step.page_start ? `–${step.page_end}` : ""} · ` : ""}
                                    {step.duration_ms !== null ? `${step.duration_ms} ms` : step.status}
                                </p>
                            </li>
                        ))}
                    </ol>
                </details>
            ) : null}
        </section>
    );
}
