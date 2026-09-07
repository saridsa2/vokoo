"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useNotify } from "@/components/application/notifications/notification-provider";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { IconDocument, SearchLg } from "@/components/icons";
import { useResource } from "@/hooks/use-resource";
import { useSession } from "@/hooks/use-session";
import {
    documentUploadProblem,
    formatDocumentSize,
    normalizeCompilerRecommendations,
    selectDocument,
    type DocumentIntelligence,
    type WorkspaceDocument,
} from "@/lib/document-workspace";
import { api } from "@/utils/api-client";
import { timeAgo } from "@/utils/format";

type RawInspection = Omit<DocumentIntelligence, "recommendations"> & {
    recommendations: Array<{
        compiler_id: string;
        confidence: number;
        reason: string;
        evidence: Array<{ page: number | null; text: string }>;
    }>;
};

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
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    useEffect(() => {
        setSelectedId((current) => selectDocument(records, current));
    }, [records]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle ? records.filter((document) => document.name.toLowerCase().includes(needle)) : records;
    }, [records, query]);
    const selected = records.find((document) => document.id === selectedId) ?? null;

    async function upload(file: File) {
        const problem = documentUploadProblem(file);
        if (problem) {
            notify.failure("Could not add the document", new Error(problem));
            return;
        }
        if (!context) return;
        setIsUploading(true);
        try {
            const { data } = await api.uploadDocument<WorkspaceDocument>(
                { name: file.name, mime_type: canonicalMimeType(file), content_base64: await sourceBase64(file) },
                context,
            );
            await refresh();
            setSelectedId(data.id);
            notify.success("Document added", "Workspace Intelligence can inspect this source now.");
        } catch (cause) {
            notify.failure("Could not add the document", cause);
        } finally {
            setIsUploading(false);
            if (picker.current) picker.current.value = "";
        }
    }

    async function analyze() {
        if (!selected || !context) return;
        setIsAnalyzing(true);
        try {
            await api.analyzeDocument<RawInspection>(selected.id, context);
            await refresh();
            notify.success("Document reviewed", "Workspace Intelligence has updated its recommendations.");
        } catch (cause) {
            notify.failure("Could not review the document", cause);
        } finally {
            setIsAnalyzing(false);
        }
    }

    return (
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
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
                            if (file) void upload(file);
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
                                    <p className="mt-1 text-sm text-tertiary">Version {selected.current_version} · {formatDocumentSize(selected.size_bytes)}{selected.updated_at ? ` · Updated ${timeAgo(selected.updated_at)}` : ""}</p>
                                </div>
                                <Badge size="sm" type="pill-color" color={selected.intelligence ? "success" : "gray"}>{selected.intelligence ? "Reviewed" : "Ready"}</Badge>
                            </div>
                        </header>

                        <div className="min-h-0 flex-1 overflow-y-auto p-6">
                            <div className="mx-auto flex max-w-3xl flex-col gap-5">
                                <div className="flex items-start justify-between gap-4 border-b border-secondary pb-4">
                                    <div>
                                        <h3 className="text-md font-semibold text-primary">Workspace Intelligence</h3>
                                        <p className="mt-1 max-w-2xl text-sm text-tertiary">Identifies the source and recommends registered compilers. It does not create or publish workspace artifacts.</p>
                                    </div>
                                    <Button size="sm" color="secondary" isLoading={isAnalyzing} showTextWhileLoading onClick={analyze}>{selected.intelligence ? "Review again" : "Review document"}</Button>
                                </div>

                                <IntelligenceResult intelligence={selected.intelligence} />
                            </div>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}

function IntelligenceResult({ intelligence }: { intelligence: DocumentIntelligence | null }) {
    if (!intelligence) {
        return (
            <div className="rounded-xl border border-dashed border-secondary px-6 py-10 text-center">
                <p className="text-sm font-medium text-primary">Not reviewed yet</p>
                <p className="mt-1 text-sm text-tertiary">Review this version to see what it contains and which compiler fits it.</p>
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
                        {recommendation.evidence.length > 0 && (
                            <div className="mt-4 flex flex-col gap-3">
                                <p className="text-xs font-medium text-tertiary">Evidence in this version</p>
                                {recommendation.evidence.map((evidence, index) => (
                                    <blockquote key={`${evidence.page}-${index}`} className="border-l-2 border-brand pl-3 text-sm text-tertiary">
                                        “{evidence.text}”{evidence.page ? <span className="ml-2 text-xs text-quaternary">Page {evidence.page}</span> : null}
                                    </blockquote>
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
