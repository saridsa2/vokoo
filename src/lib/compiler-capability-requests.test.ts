import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOperatorCapabilityAdapters, normalizeOperatorCapabilityRequests, operatorActions } from "./compiler-capability-requests";

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

test("offers only valid operator actions for the request state", () => {
    assert.deepEqual(operatorActions({ status: "requested" }), ["review", "decline"]);
    assert.deepEqual(operatorActions({ status: "under_review" }), ["resolve_existing", "request_information", "deliver", "decline"]);
    assert.deepEqual(operatorActions({ status: "resolved" }), []);
});

test("normalizes the safe operator queue contract", () => {
    const requests = normalizeOperatorCapabilityRequests([
        {
            id: uuid("1"),
            org_id: uuid("2"),
            organization_name: "Heart Transplant Unit",
            run_id: uuid("3"),
            gap_id: uuid("4"),
            capability_key: "clinical.task",
            requested_contract: { actor: "clinician", what: "Review prophylaxis" },
            contract_digest: "a".repeat(64),
            status: "requested",
            workspace_note: null,
            operator_response: null,
            delivery_reference: null,
            active_resolution_id: null,
            demand_count: 3,
            created_at: "2026-09-10T00:00:00Z",
            updated_at: "2026-09-10T00:00:00Z",
        },
        { id: "unsafe" },
    ]);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].organization_name, "Heart Transplant Unit");
    assert.equal(requests[0].demand_count, 3);
    assert.deepEqual(requests[0].requested_contract, { actor: "clinician", what: "Review prophylaxis" });
});

test("keeps only registered adapters with compatible active nodes", () => {
    const adapters = normalizeOperatorCapabilityAdapters([
        {
            adapter_key: "clinical-task-escalate-notify-v1",
            adapter_version: 1,
            capability_key: "clinical.task",
            label: "Create clinician work with a care-team notification",
            mapping_schema: { required: ["to", "urgency"] },
            compatible_nodes: [{ id: "escalate.notify", label: "Notify care team" }],
        },
        { adapter_key: "bad", compatible_nodes: [] },
    ]);

    assert.equal(adapters.length, 1);
    assert.deepEqual(adapters[0].compatible_nodes, [{ id: "escalate.notify", label: "Notify care team" }]);
});
