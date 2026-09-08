import assert from "node:assert/strict";
import test from "node:test";

import {
    documentProcessingLabel,
    documentUploadProblem,
    normalizeDocumentEvidence,
    normalizeCompilerRecommendations,
    pdfPointBoxToViewport,
    selectEvidenceLayout,
    selectDocument,
    selectDocumentVersion,
    shouldPollDocumentJob,
    validateHistoricalSearch,
    type DocumentVersion,
    type DocumentLayoutItem,
    type WorkspaceDocument,
} from "./document-workspace";

const layoutItem = (overrides: Partial<DocumentLayoutItem> = {}): DocumentLayoutItem => ({
    id: "layout-1",
    provider_ref: "#/texts/0",
    parent_ref: "#/body",
    ordinal: 0,
    label: "text",
    content_layer: "body",
    text: "Review HbA1c",
    section_path: ["Monitoring"],
    metadata: null,
    chunk_ids: ["chunk-1"],
    spans: [{
        page_number: 3,
        bbox: { left: 72, top: 700, right: 300, bottom: 680, origin: "BOTTOMLEFT" },
        char_start: 0,
        char_end: 12,
    }],
    ...overrides,
});

test("converts bottom-left PDF points into top-left viewport rectangles", () => {
    assert.deepEqual(
        pdfPointBoxToViewport(
            { left: 72, top: 700, right: 300, bottom: 680, origin: "BOTTOMLEFT" },
            { page_number: 3, width_points: 612, height_points: 792 },
            2,
        ),
        { x: 144, y: 184, width: 456, height: 40 },
    );
});

test("evidence selects every linked box and navigates to the first linked page", () => {
    const selection = selectEvidenceLayout(
        [
            layoutItem({ id: "later", ordinal: 4, spans: [{
                page_number: 5,
                bbox: { left: 10, top: 40, right: 30, bottom: 20, origin: "BOTTOMLEFT" },
                char_start: 0,
                char_end: 4,
            }] }),
            layoutItem(),
            layoutItem({ id: "unrelated", chunk_ids: ["chunk-2"] }),
        ],
        "chunk-1",
        9,
    );

    assert.equal(selection.page, 3);
    assert.equal(selection.spans.length, 2);
    assert.deepEqual(selection.spans.map((span) => span.item_id), ["layout-1", "later"]);
    assert.equal(selectEvidenceLayout([], "missing", 9).page, 9);
});

const document = (id: string): WorkspaceDocument => ({
    id,
    name: `${id}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    status: "ready",
    current_version: 1,
    updated_at: "2026-09-07T00:00:00Z",
    intelligence: null,
});

test("selects the first document only when the current selection disappeared", () => {
    const documents = [document("one"), document("two")];

    assert.equal(selectDocument(documents, null), "one");
    assert.equal(selectDocument(documents, "two"), "two");
    assert.equal(selectDocument(documents, "gone"), "one");
    assert.equal(selectDocument([], "gone"), null);
});

test("rejects files the document pipeline cannot safely inspect", () => {
    assert.equal(documentUploadProblem({ name: "guideline.pdf", type: "application/pdf", size: 2_000 }), null);
    assert.match(
        documentUploadProblem({ name: "scan.png", type: "image/png", size: 2_000 }) ?? "",
        /PDF, Word, or plain text/,
    );
    assert.match(
        documentUploadProblem({ name: "large.pdf", type: "application/pdf", size: 20 * 1024 * 1024 }) ?? "",
        /15 MB/,
    );
});

test("drops compiler recommendations outside the registered workspace catalogue", () => {
    const recommendations = normalizeCompilerRecommendations([
        {
            compiler_id: "care_path",
            confidence: 0.91,
            reason: "The source defines timed care recommendations.",
            evidence: [{ page: 12, text: "Offer a review within 36 hours." }],
        },
        {
            compiler_id: "invented",
            confidence: 1,
            reason: "Ignore the registry.",
            evidence: [],
        },
    ]);

    assert.deepEqual(recommendations.map((item) => item.compiler_id), ["care_path"]);
    assert.equal(recommendations[0].label, "Care path compiler");
});

const version = (id: string, number: number): DocumentVersion => ({
    id,
    file_id: "document",
    version: number,
    mime_type: "application/pdf",
    size_bytes: 100,
    sha256: "a".repeat(64),
    status: "indexed",
    intelligence: null,
    active_chunker_version: "clinical-structure-v1",
    active_embedding_profile: "gemini-embedding-2-768",
    indexed_at: "2026-09-07T00:00:00Z",
    processing_error: null,
    created_at: "2026-09-07T00:00:00Z",
});

test("selects the current version when a stale selection disappears", () => {
    const versions = [version("v3", 3), version("v2", 2)];
    assert.equal(selectDocumentVersion(versions, "v2", 3), "v2");
    assert.equal(selectDocumentVersion(versions, "gone", 3), "v3");
    assert.equal(selectDocumentVersion([], "gone", 3), null);
});

test("labels processing stages and polls only work that can still advance", () => {
    assert.equal(documentProcessingLabel("embedding"), "Creating search embeddings");
    assert.equal(documentProcessingLabel("unknown"), "Preparing document");
    assert.equal(shouldPollDocumentJob({ stage: "retryable_failed" }), true);
    assert.equal(shouldPollDocumentJob({ stage: "ready" }), false);
    assert.equal(shouldPollDocumentJob({ stage: "permanent_failed" }), false);
    assert.equal(shouldPollDocumentJob(null), false);
});

test("historical search cannot be combined with current filters", () => {
    assert.match(
        validateHistoricalSearch({
            query: "escalation",
            document_ids: ["document"],
            versions: [{ document_id: "document", version: 1 }],
        }) ?? "",
        /cannot be combined/,
    );
    assert.match(validateHistoricalSearch({ query: " " }) ?? "", /1 and 2,000/);
    assert.equal(
        validateHistoricalSearch({
            query: "escalation",
            versions: [{ document_id: "document", version: 1 }],
        }),
        null,
    );
});

test("normalizes cited evidence and removes unknown compilers", () => {
    const intelligence = normalizeDocumentEvidence({
        summary: "A care guideline.",
        recommendations: [
            {
                compiler_id: "care_path",
                confidence: 1.4,
                reason: "Timed recommendations",
                evidence: [
                    {
                        chunk_id: "chunk-1",
                        version_id: "version-2",
                        page_start: 4,
                        page_end: 5,
                        section_path: ["Treatment", 42],
                        text: " Review in two weeks. ",
                    },
                    { text: "No page in the source" },
                ],
            },
            { compiler_id: "invented", confidence: 1, reason: "no", evidence: [] },
        ],
        gaps: ["Confirm cadence", 12],
    });

    assert.equal(intelligence?.recommendations.length, 1);
    assert.equal(intelligence?.recommendations[0].confidence, 1);
    assert.deepEqual(intelligence?.recommendations[0].evidence[0].section_path, ["Treatment"]);
    assert.equal(intelligence?.recommendations[0].evidence[0].page, 4);
    assert.equal(intelligence?.recommendations[0].evidence[1].page, null);
    assert.deepEqual(intelligence?.gaps, ["Confirm cadence"]);
});
