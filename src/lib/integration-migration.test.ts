import assert from "node:assert/strict";
import test from "node:test";
import type { FlowGraph } from "@/utils/flow-graph";
import { previewLegacyIntegrationMigration } from "./integration-migration.ts";

const legacy: FlowGraph = {
    version: 3,
    variables: [],
    nodes: [
        { id: "ended", type: "trigger", implementation: "trigger.call_ended", name: "Call ended", position: { x: 0, y: 0 }, config: {} },
        { id: "extract", type: "custom", implementation: "intelligence", name: "Process call", position: { x: 300, y: 0 }, config: { shape_id: "schema-1" } },
        { id: "send", type: "custom", implementation: "http.request", name: "Send", position: { x: 600, y: 0 }, config: { url: "https://crm.test" } },
    ],
    transitions: [
        { id: "a", from: "ended", outcome: "we_ended", to: "extract" },
        { id: "b", from: "extract", outcome: "filled", to: "send" },
    ],
};

const call: FlowGraph = {
    version: 3,
    variables: [],
    nodes: [{ id: "answered", type: "trigger", implementation: "trigger.call_answered", name: "Answered", position: { x: 0, y: 0 }, config: {} }],
    transitions: [],
};

test("preview moves call extraction into the call flow and leaves a reusable integration", () => {
    const preview = previewLegacyIntegrationMigration(legacy, call, "integration-1");

    assert.deepEqual(
        preview.integration.nodes.map((node) => node.implementation),
        ["trigger.integration_invoked", "http.request"],
    );
    assert.equal(preview.integration.nodes[0].config.input_schema_id, "schema-1");
    assert.ok(preview.call.nodes.some((node) => node.implementation === "trigger.call_ended"));
    assert.ok(preview.call.nodes.some((node) => node.implementation === "intelligence"));
    const invoke = preview.call.nodes.find((node) => node.implementation === "integration.invoke");
    assert.equal(invoke?.config.target_flow_id, "integration-1");
    assert.equal(invoke?.config.input, "={{ $json }}");
    const endedId = preview.call.nodes.find((node) => node.implementation === "trigger.call_ended")?.id;
    assert.deepEqual(
        preview.call.transitions
            .filter((edge) => edge.from === endedId)
            .map((edge) => edge.outcome)
            .sort(),
        ["caller_hung_up", "we_ended"],
    );
});

test("preview refuses a graph that is not the legacy call-ended extraction shape", () => {
    assert.throws(
        () =>
            previewLegacyIntegrationMigration(
                { ...legacy, nodes: legacy.nodes.filter((node) => node.implementation !== "intelligence") },
                call,
                "integration-1",
            ),
        /extraction node/,
    );
});

test("preview refuses to overwrite an existing call-ended route", () => {
    const occupiedCall: FlowGraph = {
        ...call,
        nodes: [
            ...call.nodes,
            { id: "call-ended", type: "trigger", implementation: "trigger.call_ended", name: "Ended", position: { x: 0, y: 200 }, config: {} },
            { id: "existing", type: "custom", implementation: "var.set", name: "Existing", position: { x: 300, y: 200 }, config: {} },
        ],
        transitions: [{ id: "existing-route", from: "call-ended", outcome: "we_ended", to: "existing" }],
    };

    assert.throws(
        () => previewLegacyIntegrationMigration(legacy, occupiedCall, "integration-1"),
        /choose how to merge it manually/,
    );
});
