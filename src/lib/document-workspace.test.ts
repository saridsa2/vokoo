import assert from "node:assert/strict";
import test from "node:test";
import {
    type DocumentLayoutItem,
    type DocumentVersion,
    type WorkspaceDocument,
    canRecompileWithCapabilities,
    canRequestCompilerCapability,
    clampDocumentInspectorWidth,
    compilerGapPresentation,
    documentProcessingLabel,
    documentUploadProblem,
    normalizeCompilerRecommendations,
    normalizeCompilerRunReport,
    normalizeDocumentEvidence,
    pdfPointBoxToViewport,
    selectDocument,
    selectDocumentVersion,
    selectEvidenceLayout,
    shouldPollCompilerRun,
    shouldPollDocumentJob,
    validateHistoricalSearch,
} from "./document-workspace";

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const compilerReportWithRequest = (status: string, overrides: Record<string, unknown> = {}) => ({
    run: {
        id: uuid("1"),
        file_id: uuid("2"),
        file_version_id: uuid("3"),
        compiler_id: "care_path",
        status: "completed_with_gaps",
        provider: "minimax",
        model: "MiniMax-M2.1",
        compiler_version: "care-path-v1",
        prompt_version: "care-path-prompt-v1",
        attempt_count: 1,
        max_attempts: 3,
        summary: null,
        coverage: { gap_count: 1 },
        last_error_code: null,
        created_at: "2026-09-08T00:00:00Z",
        started_at: "2026-09-08T00:00:01Z",
        completed_at: "2026-09-08T00:00:03Z",
        updated_at: "2026-09-08T00:00:03Z",
    },
    steps: [],
    gaps: [
        {
            id: uuid("4"),
            step_id: null,
            code: "unsupported_action_actor",
            severity: "blocking",
            recommendation_id: "HLT-1",
            explanation: "Clinician work needs a supported task node.",
            missing_capability: "clinical.task",
            details: { actor: "clinician", what: "Review the patient" },
            presentation: {
                title: "Care-team work cannot be created",
                capability_label: "Create work for a clinician",
                class: "missing_capability",
                requestable: true,
            },
            capability_request: {
                id: uuid("5"),
                gap_id: uuid("4"),
                capability_key: "clinical.task",
                requested_contract: { actor: "clinician", what: "Review the patient" },
                status,
                workspace_note: "Needed for transplant review.",
                operator_response: null,
                delivery_reference: null,
                active_resolution_id: status === "resolved" ? uuid("6") : null,
                created_at: "2026-09-08T00:00:04Z",
                updated_at: "2026-09-08T00:00:04Z",
            },
            review_status: "open",
            resolution_note: null,
            created_at: "2026-09-08T00:00:02Z",
            updated_at: "2026-09-08T00:00:02Z",
            ...overrides,
        },
    ],
    artifacts: [],
    evidence: [],
});

test("presents only known compiler gaps as requestable capabilities", () => {
    assert.deepEqual(compilerGapPresentation("threshold_requires_mapping", "clinical.threshold_mapping"), {
        title: "Clinical threshold cannot be evaluated",
        capabilityLabel: "Evaluate a clinical observation threshold",
        class: "missing_mapping",
        requestable: true,
    });
    assert.deepEqual(compilerGapPresentation("unsupported_action_actor", "clinical.task"), {
        title: "Care-team work cannot be created",
        capabilityLabel: "Create work for a clinician",
        class: "missing_capability",
        requestable: true,
    });
    assert.deepEqual(compilerGapPresentation("unknown_code", "unknown.capability"), {
        title: "Compiler gap",
        capabilityLabel: null,
        class: "unknown",
        requestable: false,
    });
});

test("normalizes every capability request state and enables recompilation only after resolution", () => {
    for (const status of ["requested", "under_review", "needs_information", "delivering", "resolved", "declined", "cancelled"]) {
        const report = normalizeCompilerRunReport(compilerReportWithRequest(status));
        assert.equal(report?.gaps[0].capability_request?.status, status);
        assert.equal(canRequestCompilerCapability(report!.gaps[0]), false);
        assert.equal(canRecompileWithCapabilities(report!), status === "resolved");
    }
});

test("drops malformed requests and never trusts payload requestability for unknown gaps", () => {
    const malformed = normalizeCompilerRunReport(
        compilerReportWithRequest("requested", {
            capability_request: { status: "requested" },
        }),
    );
    assert.equal(malformed?.gaps[0].capability_request, null);
    assert.equal(canRequestCompilerCapability(malformed!.gaps[0]), true);

    const unknown = normalizeCompilerRunReport(
        compilerReportWithRequest("requested", {
            code: "invented_gap",
            missing_capability: "invented.capability",
            presentation: {
                title: "Trust me",
                capability_label: "Unsafe capability",
                class: "missing_capability",
                requestable: true,
            },
            capability_request: null,
        }),
    );
    assert.equal(unknown?.gaps[0].presentation.requestable, false);
    assert.equal(canRequestCompilerCapability(unknown!.gaps[0]), false);
});

test("keeps the document inspector usable without crowding out the document", () => {
    assert.equal(clampDocumentInspectorWidth(200, 1_600), 320);
    assert.equal(clampDocumentInspectorWidth(520, 1_600), 520);
    assert.equal(clampDocumentInspectorWidth(900, 1_600), 640);
    assert.equal(clampDocumentInspectorWidth(520, 850), 320);
});

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
    spans: [
        {
            page_number: 3,
            bbox: { left: 72, top: 700, right: 300, bottom: 680, origin: "BOTTOMLEFT" },
            char_start: 0,
            char_end: 12,
        },
    ],
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
            layoutItem({
                id: "later",
                ordinal: 4,
                spans: [
                    {
                        page_number: 5,
                        bbox: { left: 10, top: 40, right: 30, bottom: 20, origin: "BOTTOMLEFT" },
                        char_start: 0,
                        char_end: 4,
                    },
                ],
            }),
            layoutItem(),
            layoutItem({ id: "unrelated", chunk_ids: ["chunk-2"] }),
        ],
        "chunk-1",
        9,
    );

    assert.equal(selection.page, 3);
    assert.equal(selection.spans.length, 2);
    assert.deepEqual(
        selection.spans.map((span) => span.item_id),
        ["layout-1", "later"],
    );
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
    assert.match(documentUploadProblem({ name: "scan.png", type: "image/png", size: 2_000 }) ?? "", /PDF, Word, or plain text/);
    assert.match(documentUploadProblem({ name: "large.pdf", type: "application/pdf", size: 20 * 1024 * 1024 }) ?? "", /15 MB/);
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

    assert.deepEqual(
        recommendations.map((item) => item.compiler_id),
        ["care_path"],
    );
    assert.equal(recommendations[0].label, "Care path compiler");
});

test("merges duplicate recommendations for the same registered compiler", () => {
    const recommendations = normalizeCompilerRecommendations([
        {
            compiler_id: "care_path",
            confidence: 0.85,
            reason: "A pediatric pathway is present.",
            evidence: [{ page: 8, text: "Review children monthly." }],
        },
        {
            compiler_id: "care_path",
            confidence: 0.95,
            reason: "The source defines a lifelong transplant pathway.",
            evidence: [
                { page: 90, text: "Lifelong follow-up is recommended." },
                { page: 8, text: "Review children monthly." },
            ],
        },
    ]);

    assert.equal(recommendations.length, 1);
    assert.equal(recommendations[0].confidence, 0.95);
    assert.equal(recommendations[0].reason, "The source defines a lifelong transplant pathway.");
    assert.deepEqual(
        recommendations[0].evidence.map((item) => item.page),
        [8, 90],
    );
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

test("normalizes compiler reports, sorts trace steps, and retains deleted artifacts", () => {
    const report = normalizeCompilerRunReport({
        run: {
            id: uuid("1"),
            file_id: uuid("2"),
            file_version_id: uuid("3"),
            compiler_id: "care_path",
            status: "completed_with_gaps",
            provider: "minimax",
            model: "MiniMax-M2.1",
            compiler_version: "care-path-v1",
            prompt_version: "care-path-prompt-v1",
            attempt_count: 1,
            max_attempts: 3,
            summary: "Compiled one monitoring path.",
            coverage: { agent_count: 1, flow_count: 1, gap_count: 1 },
            last_error_code: null,
            created_at: "2026-09-08T00:00:00Z",
            started_at: "2026-09-08T00:00:01Z",
            completed_at: "2026-09-08T00:00:03Z",
            updated_at: "2026-09-08T00:00:03Z",
        },
        steps: [
            {
                id: uuid("5"),
                sequence: 2,
                kind: "validate",
                status: "completed",
                task_key: "validation",
                result: { agent_count: 1 },
                created_at: "2026-09-08T00:00:02Z",
            },
            {
                id: uuid("4"),
                sequence: 1,
                kind: "plan",
                status: "completed",
                task_key: "supervisor",
                result: { summary: "Found monitoring guidance." },
                created_at: "2026-09-08T00:00:01Z",
            },
        ],
        gaps: [
            {
                id: uuid("6"),
                step_id: null,
                code: "unsupported_action",
                severity: "warning",
                recommendation_id: "NG28-1.6.1",
                explanation: "Medication prescribing is outside the catalogue.",
                missing_capability: "prescribe.medication",
                details: { action_key: "review-medication" },
                evidence: [{ chunk_id: uuid("10"), excerpt: "Consider treatment escalation.", role: "requirement" }],
                review_status: "open",
                resolution_note: null,
                created_at: "2026-09-08T00:00:02Z",
                updated_at: "2026-09-08T00:00:02Z",
            },
        ],
        artifacts: [
            {
                id: uuid("7"),
                artifact_type: "flow",
                stable_key: "hba1c-monitoring",
                role: "care_path",
                agent_id: null,
                flow_id: uuid("8"),
                created_at: "2026-09-08T00:00:03Z",
            },
            {
                id: uuid("9"),
                artifact_type: "agent",
                stable_key: "deleted-agent",
                role: "conversation",
                agent_id: null,
                flow_id: null,
                created_at: "2026-09-08T00:00:03Z",
            },
        ],
        evidence: [
            {
                id: uuid("11"),
                artifact_id: uuid("7"),
                target_path: "flow.nodes.request",
                chunk_id: uuid("10"),
                excerpt: "Review HbA1c every three to six months.",
                recommendation_id: "NG28-1.6.1",
                evidence_role: "timing",
                created_at: "2026-09-08T00:00:03Z",
            },
        ],
    });

    assert.ok(report);
    assert.deepEqual(
        report.steps.map((step) => step.sequence),
        [1, 2],
    );
    assert.equal(report.gaps[0].severity, "warning");
    assert.equal(report.gaps[0].evidence[0].chunk_id, uuid("10"));
    assert.equal(report.artifacts[1].agent_id, null);
    assert.equal(report.evidence[0].target_path, "flow.nodes.request");
});

test("rejects unknown compiler states and discards malformed nested report rows", () => {
    const base = {
        id: uuid("1"),
        file_id: uuid("2"),
        file_version_id: uuid("3"),
        compiler_id: "care_path",
        provider: "minimax",
        model: "MiniMax-M2.1",
        compiler_version: "care-path-v1",
        prompt_version: "care-path-prompt-v1",
        attempt_count: 0,
        max_attempts: 3,
        summary: null,
        coverage: {},
        last_error_code: null,
        created_at: "2026-09-08T00:00:00Z",
        started_at: null,
        completed_at: null,
        updated_at: "2026-09-08T00:00:00Z",
    };
    assert.equal(normalizeCompilerRunReport({ run: { ...base, status: "invented" }, steps: [], gaps: [], artifacts: [], evidence: [] }), null);

    const report = normalizeCompilerRunReport({
        run: { ...base, status: "queued" },
        steps: [{ id: "not-a-uuid", sequence: 1, kind: "plan", status: "completed", result: {}, created_at: "now" }],
        gaps: [
            {
                id: uuid("8"),
                step_id: null,
                code: "unsupported_action_actor",
                severity: "blocking",
                recommendation_id: "HLT-1",
                explanation: "Clinician work needs a supported task node.",
                missing_capability: "clinical.task",
                details: ["not", "an", "object"],
                evidence: [],
                review_status: "open",
                resolution_note: null,
                created_at: "now",
                updated_at: "now",
            },
        ],
        artifacts: [
            { id: uuid("4"), artifact_type: "flow", stable_key: "bad", role: "care_path", flow_id: "javascript:alert(1)", agent_id: null, created_at: "now" },
        ],
        evidence: [
            {
                id: uuid("5"),
                artifact_id: uuid("4"),
                target_path: "<script>",
                chunk_id: uuid("6"),
                excerpt: "unsafe",
                evidence_role: "timing",
                created_at: "now",
            },
            {
                id: uuid("7"),
                artifact_id: uuid("4"),
                target_path: "flow.nodes.safe",
                chunk_id: "bad",
                excerpt: "unsafe",
                evidence_role: "timing",
                created_at: "now",
            },
        ],
    });
    assert.ok(report);
    assert.equal(report.steps.length, 0);
    assert.equal(report.gaps.length, 0);
    assert.equal(report.artifacts.length, 0);
    assert.equal(report.evidence.length, 0);
});

test("polls only active compiler states", () => {
    for (const status of ["queued", "planning", "compiling", "validating", "materializing"] as const) {
        assert.equal(shouldPollCompilerRun({ status }), true);
    }
    for (const status of ["completed", "completed_with_gaps", "failed", "cancelled"] as const) {
        assert.equal(shouldPollCompilerRun({ status }), false);
    }
    assert.equal(shouldPollCompilerRun(null), false);
});
