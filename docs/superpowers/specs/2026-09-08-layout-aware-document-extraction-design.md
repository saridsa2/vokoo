# Layout-Aware Document Extraction

**Date:** 2026-09-08

**Status:** Approved in conversation
**Scope:** Provider-neutral extraction, a VPS Docling provider, normalized page geometry, source rendering, and evidence highlighting

## Context

Vokoo already stores immutable document versions, processes them through a durable worker, embeds structure-aware chunks with the operator-managed Gemini credential, and passes retrieved evidence to Workspace Intelligence. The current extractor uses `pdftotext -layout`. It retains page numbers but discards page dimensions, element bounds, reading order, tables, and the distinction between body content and repeated page furniture.

That loss is visible in two places. Search results cannot open and highlight their source passage, and the Documents workspace renders detached text cards while leaving most of the screen empty. It also contributes to oversized chunks and repeated NICE headers entering retrieval.

## Decisions

### The VPS is the initial extraction provider

The existing `vokoo-document-worker` remains the control plane and initial compute plane. A `DocumentExtractionProvider` boundary accepts immutable source bytes and returns one Vokoo extraction artifact. The first implementation invokes a pinned `docling-rs` executable on the VPS. The current built-in extractor remains a fallback for supported non-PDF formats and for installations where Docling has not yet been configured.

The bridge and call binaries do not link Docling, PDFium, or its ONNX dependencies. Only the document worker invokes the external executable. The executable path, expected version, timeout, and model paths are deployment configuration.

A later Modal provider must implement the same request/result contract. It may change where computation occurs, but it must not introduce Modal identifiers, storage formats, or credentials into the browser, database schema, chunker, Workspace Intelligence, or compiler.

### Vokoo owns the canonical extraction model

Docling JSON is an input format, not Vokoo's persistence contract. The provider normalizes it into:

- an extraction identity containing provider, provider version, schema version, source hash, duration, and warnings;
- ordered pages with width and height in PDF points;
- ordered semantic items with stable provider references, parent references, label, body/furniture layer, text, and section path;
- one or more source spans per item, each with page number, bounding box, coordinate origin, and character span;
- table structure and provider-specific details only in bounded metadata.

Bounding boxes are persisted in PDF points using a bottom-left origin. Browser helpers convert them to PDF.js viewport coordinates at render time. Vokoo stores the raw provider artifact on the extraction row for diagnosis and reproducibility, but no application query depends on its internal shape.

### Derived layout is versioned and replaceable

`document_extractions` records attempts for one immutable `file_version`. `file_versions.active_extraction_id` identifies the extraction used by rendering, chunking, retrieval, and compilation. Re-extraction creates a new row and atomically switches the active reference only after the complete normalized artifact is stored.

`document_pages`, `document_layout_items`, and `document_layout_spans` are tenant-scoped derived tables. `document_chunk_layout_items` connects search chunks to their source items. Cascading deletion is limited to derived records; source versions remain protected by the existing immutability trigger.

### Chunking ranks semantic children and expands context

The next chunker version consumes ordered body items rather than collapsed multi-page text. Page furniture is never embedded. A retrievable child is normally one recommendation, paragraph, list item, or table row, bounded to 320 approximate tokens. Its stored context includes its section path and adjacent siblings up to 900 tokens. Search ranks the child text and returns the expanded context plus the linked item spans.

This directly addresses exact-threshold passages being hidden inside very large chunks. It also preserves the context needed by Workspace Intelligence and the care-path compiler.

### The original source is the visual authority

The control-plane API exposes an authenticated, tenant-scoped source endpoint for a named document version and a layout endpoint for its active extraction. It does not place source bytes in list responses or public object URLs.

The Documents workspace becomes a three-pane layout on large screens:

1. a collapsible document rail, approximately 280 px;
2. a flexible PDF.js viewer that consumes the current empty gutter;
3. a 380-420 px search, intelligence, and compiler panel.

Selecting search or compiler evidence navigates the viewer to the first referenced page and overlays every linked source span. Historical versions render their own immutable source and extraction. Non-PDF sources use a structured text preview and the same right pane. On narrow screens, viewer and intelligence become tabs.

### Security and failure semantics

Only authenticated organization members may read source bytes or normalized layout for their organization. The document worker uses the existing service-role boundary. Provider stderr is length-limited and scrubbed before it becomes a job error; source text and bytes are never logged.

Provider execution has a hard timeout and output-size ceiling. Invalid JSON, a source-hash mismatch, impossible page numbers, non-finite dimensions, invalid boxes, or cross-page references make the extraction permanently fail. Process launch, timeout, and resource exhaustion are retryable. Persistence is transactional and idempotent for a job attempt.

If Docling is unavailable, PDF jobs fail visibly rather than silently producing the old low-fidelity representation once the Docling provider is selected. The old extractor remains an explicit provider choice, not an implicit fallback that changes output quality without recording it.

## Initial Acceptance Test

The initial VPS test uses the uploaded NICE NG28 PDF and records:

- Docling revision and model inventory;
- page count, extraction duration, peak container/process memory, and artifact size;
- heading and recommendation-number recovery;
- table and multi-column reading order on sampled pages;
- repeated header/footer suppression from indexed content;
- the top result for an HbA1c threshold query;
- alignment of at least one highlighted result in the PDF.js viewer.

CPU is tested first with layout and TableFormer enabled and OCR skipped for the digital PDF. GPU is not required for acceptance. OCR-heavy documents may later be routed to a GPU-capable provider.

## Non-goals

- This phase does not compile the document into flows or agents.
- It does not move embeddings, Workspace Intelligence, or PostgreSQL to Modal.
- It does not make Docling's RAG subsystem authoritative.
- It does not expose source documents through unauthenticated URLs.
- It does not process live patient data during the spike.

## Dependency and Licensing

The VPS runtime pins docling.rs to commit `5a4f78e583672b8018af7f6963e4601ea7d7f705` (workspace version `1.37.0`) for the initial benchmark. Upgrading it is an explicit change followed by the NG28 acceptance corpus. If its binary or source is redistributed in Vokoo deployment artifacts, the upstream MIT copyright and license notice must be retained.
