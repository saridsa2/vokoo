import assert from "node:assert/strict";
import test from "node:test";

import {
    documentUploadProblem,
    normalizeCompilerRecommendations,
    selectDocument,
    type WorkspaceDocument,
} from "./document-workspace";

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
