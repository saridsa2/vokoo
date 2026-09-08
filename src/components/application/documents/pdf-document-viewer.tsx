"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
    pdfPointBoxToViewport,
    type DocumentLayoutPage,
    type SelectedLayoutSpan,
} from "@/lib/document-workspace";

type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;
type PdfLoadingTask = import("pdfjs-dist").PDFDocumentLoadingTask;

type PdfDocumentViewerProps = {
    source: Blob | null;
    pages: DocumentLayoutPage[];
    highlights: SelectedLayoutSpan[];
    targetPage: number | null;
    error?: string | null;
};

export function PdfDocumentViewer({ source, pages, highlights, targetPage, error }: PdfDocumentViewerProps) {
    const [document, setDocument] = useState<PdfDocument | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const pageRefs = useRef(new Map<number, HTMLElement>());

    useEffect(() => {
        let cancelled = false;
        let activeTask: PdfLoadingTask | null = null;
        setDocument(null);
        setLoadError(null);
        if (!source) return;
        void (async () => {
            try {
                const pdfjs = await import("pdfjs-dist");
                pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                    "pdfjs-dist/build/pdf.worker.min.mjs",
                    import.meta.url,
                ).toString();
                activeTask = pdfjs.getDocument({ data: new Uint8Array(await source.arrayBuffer()) });
                const activeDocument = await activeTask.promise;
                if (!cancelled) setDocument(activeDocument);
            } catch (cause) {
                if (!cancelled) {
                    setLoadError(cause instanceof Error ? cause.message : "The PDF could not be opened.");
                }
            }
        })();
        return () => {
            cancelled = true;
            if (activeTask) void activeTask.destroy();
        };
    }, [source]);

    useEffect(() => {
        if (!targetPage || !document) return;
        pageRefs.current.get(targetPage)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [document, targetPage]);

    const layoutPages = useMemo(
        () => new Map(pages.map((page) => [page.page_number, page])),
        [pages],
    );
    const highlightsByPage = useMemo(() => {
        const grouped = new Map<number, SelectedLayoutSpan[]>();
        for (const highlight of highlights) {
            grouped.set(highlight.page_number, [...(grouped.get(highlight.page_number) ?? []), highlight]);
        }
        return grouped;
    }, [highlights]);

    if (error || loadError) {
        return (
            <div className="grid h-full min-h-80 place-items-center p-8 text-center">
                <div>
                    <p className="text-sm font-medium text-primary">The source preview is unavailable</p>
                    <p className="mt-1 max-w-md text-sm text-tertiary">{error ?? loadError}</p>
                </div>
            </div>
        );
    }
    if (!source || !document) {
        return <div className="grid h-full min-h-80 place-items-center text-sm text-tertiary">Loading source…</div>;
    }

    return (
        <div className="h-full overflow-y-auto bg-secondary px-3 py-5 sm:px-5" aria-label="PDF document viewer">
            <div className="mx-auto flex max-w-[900px] flex-col gap-5">
                {Array.from({ length: document.numPages }, (_, index) => {
                    const pageNumber = index + 1;
                    return (
                        <PdfPage
                            key={pageNumber}
                            document={document}
                            pageNumber={pageNumber}
                            layoutPage={layoutPages.get(pageNumber)}
                            highlights={highlightsByPage.get(pageNumber) ?? []}
                            register={(element) => {
                                if (element) pageRefs.current.set(pageNumber, element);
                                else pageRefs.current.delete(pageNumber);
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function PdfPage({
    document,
    pageNumber,
    layoutPage,
    highlights,
    register,
}: {
    document: PdfDocument;
    pageNumber: number;
    layoutPage?: DocumentLayoutPage;
    highlights: SelectedLayoutSpan[];
    register: (element: HTMLElement | null) => void;
}) {
    const wrapper = useRef<HTMLElement | null>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const [visible, setVisible] = useState(false);
    const [width, setWidth] = useState(0);
    const [pageSize, setPageSize] = useState(() => ({
        width: layoutPage?.width_points ?? 612,
        height: layoutPage?.height_points ?? 792,
    }));

    useEffect(() => {
        const element = wrapper.current;
        if (!element) return;
        register(element);
        const resize = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        resize.observe(element);
        const intersection = new IntersectionObserver(
            ([entry]) => setVisible(entry.isIntersecting),
            { rootMargin: "800px 0px" },
        );
        intersection.observe(element);
        return () => {
            register(null);
            resize.disconnect();
            intersection.disconnect();
        };
    }, [register]);

    useEffect(() => {
        if (!visible || !width || !canvas.current) return;
        let cancelled = false;
        let renderTask: import("pdfjs-dist").RenderTask | null = null;
        void document.getPage(pageNumber).then((page) => {
            if (cancelled || !canvas.current) return;
            const base = page.getViewport({ scale: 1 });
            setPageSize({ width: base.width, height: base.height });
            const scale = width / base.width;
            const viewport = page.getViewport({ scale });
            const ratio = window.devicePixelRatio || 1;
            canvas.current.width = Math.ceil(viewport.width * ratio);
            canvas.current.height = Math.ceil(viewport.height * ratio);
            canvas.current.style.width = `${viewport.width}px`;
            canvas.current.style.height = `${viewport.height}px`;
            const context = canvas.current.getContext("2d");
            if (!context) return;
            renderTask = page.render({
                canvas: canvas.current,
                canvasContext: context,
                viewport,
                transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
            });
            return renderTask.promise;
        }).catch((cause) => {
            if (!cancelled && cause?.name !== "RenderingCancelledException") console.error(cause);
        });
        return () => {
            cancelled = true;
            renderTask?.cancel();
        };
    }, [document, pageNumber, visible, width]);

    const scale = width / pageSize.width;
    const geometryPage = layoutPage ?? {
        page_number: pageNumber,
        width_points: pageSize.width,
        height_points: pageSize.height,
    };

    return (
        <section
            ref={(element) => {
                wrapper.current = element;
            }}
            aria-label={`Page ${pageNumber}`}
            className="relative w-full overflow-hidden bg-primary shadow-xs ring-1 ring-secondary"
            style={{ aspectRatio: `${pageSize.width} / ${pageSize.height}` }}
        >
            <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden="true" />
            {width > 0 && highlights.map((highlight, index) => {
                const rectangle = pdfPointBoxToViewport(highlight.bbox, geometryPage, scale);
                return (
                    <button
                        key={`${highlight.item_id}-${index}`}
                        type="button"
                        aria-label={`Evidence on page ${pageNumber}`}
                        className="absolute rounded-sm bg-warning-primary/25 ring-2 ring-warning-primary/70 focus:ring-4"
                        style={{
                            left: rectangle.x,
                            top: rectangle.y,
                            width: rectangle.width,
                            height: rectangle.height,
                        }}
                    />
                );
            })}
            <span className="absolute right-2 bottom-2 rounded bg-primary/90 px-2 py-1 text-xs text-tertiary shadow-xs">
                {pageNumber}
            </span>
        </section>
    );
}
