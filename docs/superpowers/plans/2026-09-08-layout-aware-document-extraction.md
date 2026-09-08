# Layout-Aware Document Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract PDFs through a provider-neutral Docling boundary on the VPS, persist normalized page geometry, and open highlighted evidence in a space-efficient PDF viewer.

**Architecture:** `vokoo-document-worker` calls a configured local Docling executable and converts its JSON into Vokoo-owned layout types. PostgreSQL stores an immutable extraction artifact and normalized pages/items/spans; authenticated control-plane endpoints expose source and layout to a three-pane PDF.js document workspace. A later Modal adapter consumes and produces the same contracts.

**Tech Stack:** Rust 2021, Tokio, Docling.rs CLI 1.37.0, PostgreSQL 17/Supabase, Next.js 16, React 19, PDF.js

**Spec:** `docs/superpowers/specs/2026-09-08-layout-aware-document-extraction-design.md`

## Global Constraints

- Pin docling.rs to commit `5a4f78e583672b8018af7f6963e4601ea7d7f705` for the initial benchmark.
- Do not link Docling, PDFium, or ONNX into call-related binaries.
- Vokoo's normalized artifact is the only provider contract used outside the provider module.
- Keep all source and layout reads authenticated and organization-scoped.
- Do not log document bytes or extracted clinical text.
- Preserve unrelated worktree changes and the upstream MIT notice.

---

### Task 1: Provider-neutral extraction contract and Docling normalization

**Files:**
- Create: `bridge/src/vokoo/documents/provider.rs`
- Create: `bridge/tests/fixtures/documents/docling-layout.json`
- Modify: `bridge/src/vokoo/documents/mod.rs`
- Modify: `bridge/tests/document_pipeline.rs`

**Interfaces:**
- Produces: `ExtractionRequest { mime_type, source_sha256, bytes }`, `DocumentExtractionProvider::extract`, `NormalizedExtraction`, `NormalizedPage`, `LayoutItem`, `LayoutSpan`, and `DoclingCommandProvider`.
- Consumes: a `docling-rs --to json --heading-hierarchy --skip-ocr <staged-file>` executable whose stdout is DoclingDocument JSON.

- [ ] **Step 1: Add a failing normalization test** that loads the hand-checked fixture and asserts two ordered pages, heading/list labels, section ancestry, bottom-left boxes, and exclusion of a repeated top-margin item from `indexable_text()`.
- [ ] **Step 2: Run `cargo test --manifest-path bridge/Cargo.toml --test document_pipeline docling_layout`** and confirm it fails because the provider types do not exist.
- [ ] **Step 3: Implement the normalized types and a strict Docling JSON parser.** Resolve body `$ref` values, retain reading order and parents, validate page and box bounds, infer repeated page furniture from normalized text plus top/bottom position, and return a stable `layout-v1` artifact.
- [ ] **Step 4: Add a failing executable-boundary test** using a temporary shell fixture that records arguments and emits the JSON fixture; assert MIME-derived staging, `--skip-ocr`, `--heading-hierarchy`, timeout/error classification, and cleanup.
- [ ] **Step 5: Implement `DocumentExtractionProvider` and `DoclingCommandProvider`** using `tokio::process::Command`, a configured executable path, hard timeout, bounded stdout/stderr, and source hash verification.
- [ ] **Step 6: Run the focused tests and `cargo test --manifest-path bridge/Cargo.toml --test document_pipeline`.**
- [ ] **Step 7: Commit with `feat: add layout-aware document extraction provider`.**

### Task 2: Persist active normalized extractions

**Files:**
- Create: `supabase/migrations/0125_document_layout.sql`
- Create: `supabase/tests/0125_document_layout.sql`
- Modify: `bridge/src/vokoo/documents/jobs.rs`
- Modify: `bridge/src/vokoo/documents/worker.rs`
- Modify: `bridge/tests/document_worker.rs`

**Interfaces:**
- Produces: `JobRepository::store_layout(job, extraction)`, tenant-scoped extraction/page/item/span tables, `activate_document_extraction`, and chunk-to-layout links.
- Consumes: `NormalizedExtraction` from Task 1 and the existing leased ingestion job.

- [ ] **Step 1: Write a failing SQL test** proving cross-tenant rows fail, incomplete extractions cannot activate, activation atomically replaces the active pointer, furniture is retained but not linked as indexable content, and source immutability still holds.
- [ ] **Step 2: Run the migration test against the development database** and confirm it fails because the layout tables and RPC do not exist.
- [ ] **Step 3: Add the migration** with `document_extractions`, `document_pages`, `document_layout_items`, `document_layout_spans`, `document_chunk_layout_items`, composite tenant foreign keys, RLS, and an atomic service-role activation RPC.
- [ ] **Step 4: Add a failing worker test** asserting layout persistence occurs after extraction and before chunk persistence, and that a retry of the same job does not duplicate the active extraction.
- [ ] **Step 5: Extend the repository and worker** to store the normalized artifact and use its indexable body items as the `ExtractedDocument` input to chunking while retaining explicit fallback extraction for non-PDF sources.
- [ ] **Step 6: Run `cargo test --manifest-path bridge/Cargo.toml --test document_worker` and the SQL test.**
- [ ] **Step 7: Commit with `feat: persist normalized document layout`.**

### Task 3: Serve immutable sources and active layout

**Files:**
- Modify: `server/src/main.rs`
- Modify: `src/utils/api-client.ts`
- Modify: `src/lib/document-workspace.ts`
- Modify: `src/lib/document-workspace.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/documents/:id/versions/:version/source`, `GET /api/v1/documents/:id/versions/:version/layout`, `api.documentSource`, and `api.documentLayout`.
- Consumes: the active extraction schema from Task 2 and existing bearer/org headers.

- [ ] **Step 1: Add failing Rust route tests** for current and historical source retrieval, wrong-tenant 404 behavior, correct content type, and a version without an active layout returning processing state rather than another version's layout.
- [ ] **Step 2: Run the focused `server` tests** and confirm the routes return 404 before registration.
- [ ] **Step 3: Implement tenant-scoped source and layout handlers.** Stream source bytes without logging or serializing them into ordinary JSON envelopes; return Vokoo `layout-v1` JSON for the active extraction only.
- [ ] **Step 4: Add failing TypeScript tests** for bottom-left PDF-point boxes converting to top-left viewport rectangles and for search results selecting the first linked page.
- [ ] **Step 5: Add client types and helpers** for pages, items, spans, source blobs, viewport conversion, and evidence navigation.
- [ ] **Step 6: Run `cargo test --manifest-path server/Cargo.toml` and `npm run test:flows`.**
- [ ] **Step 7: Commit with `feat: expose document sources and layout`.**

### Task 4: Three-pane PDF viewer and evidence highlights

**Files:**
- Create: `src/components/application/documents/pdf-document-viewer.tsx`
- Modify: `src/components/application/screens/documents-screen.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `PdfDocumentViewer({ source, pages, highlights, targetPage })` and a responsive document workspace.
- Consumes: source/layout APIs from Task 3 and layout item identifiers returned with search evidence.

- [ ] **Step 1: Install the pinned compatible `pdfjs-dist` package** and record the lockfile change.
- [ ] **Step 2: Add a failing document-workspace behavior test** proving a result with several spans groups overlays by page and preserves all boxes.
- [ ] **Step 3: Implement `PdfDocumentViewer`.** Load the authenticated source blob, configure a local PDF.js worker asset, render visible pages into canvases, overlay accessible highlight buttons, navigate to the target page, revoke object URLs, and report load failures without hiding the intelligence pane.
- [ ] **Step 4: Refactor the screen into a 280 px document rail, flexible viewer, and 400 px intelligence pane.** Move existing summary, recommendations, job status, and search cards into the right pane; clicking evidence changes the viewer target and highlights; retain structured text preview for non-PDF documents.
- [ ] **Step 5: Run `npm run test:flows`, `npm run build`, and inspect `/files` at desktop and narrow widths.**
- [ ] **Step 6: Commit with `feat: render highlighted document evidence`.**

### Task 5: VPS Docling installation and NG28 acceptance run

**Files:**
- Create: `deploy/document-extractor/Dockerfile`
- Create: `deploy/document-extractor/NOTICE.docling-rs`
- Modify: `deploy/vokoo-document-worker.service`
- Modify: `deploy/README.md`
- Create: `docs/benchmarks/ng28-docling-vps.md`

**Interfaces:**
- Produces: a pinned CPU Docling runtime and an auditable NG28 extraction report.
- Consumes: Task 1's command contract and the existing Hostinger document-worker deployment.

- [ ] **Step 1: Build the pinned Docling image** with layout and TableFormer models, English OCR assets available but `--skip-ocr` used for NG28, and the upstream MIT notice retained.
- [ ] **Step 2: Smoke-test `docling-rs --version` and conversion of `bridge/tests/fixtures/documents/guideline.pdf`** inside the image; assert JSON schema, page geometry, and non-empty provenance.
- [ ] **Step 3: Configure the VPS worker** with the explicit executable path, expected version, model paths, timeout, and output limit; restart only the document worker.
- [ ] **Step 4: Requeue the uploaded NG28 version and capture** page count, duration, peak memory, artifact size, warnings, furniture count, and heading/recommendation samples without copying document text into service logs.
- [ ] **Step 5: Query `HbA1c 58 mmol/mol` in the UI** and record whether the correct child ranks first and whether its highlight aligns with the original PDF page.
- [ ] **Step 6: Record pass/fail evidence in `docs/benchmarks/ng28-docling-vps.md`.** A failure leaves Docling configured but does not switch the active extraction.
- [ ] **Step 7: Run the full Rust, SQL, TypeScript, and production-build gates, then commit with `test: record NG28 layout extraction benchmark`.**
