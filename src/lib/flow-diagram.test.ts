import assert from "node:assert/strict";
import { test } from "node:test";

import { diagramToFlowGraph, flowToDiagram } from "./flow-diagram.ts";
import type { Flow } from "../utils/flow-graph.ts";

function callFlow(): Flow {
    return {
        id: "flow-1",
        name: "Reception and follow-up",
        description: null,
        status: "draft",
        family: "call",
        trigger_event: "call.answered",
        graph: {
            version: 3,
            nodes: [
                {
                    id: "answered",
                    type: "trigger",
                    implementation: "trigger.call_answered",
                    name: "Call answered",
                    position: { x: 0, y: 0 },
                    config: {},
                },
                {
                    id: "ended",
                    type: "trigger",
                    implementation: "trigger.call_ended",
                    name: "Call ended",
                    position: { x: 0, y: 240 },
                    config: { key: "default" },
                },
                {
                    id: "agent",
                    type: "custom",
                    implementation: "agent",
                    name: "Receptionist",
                    position: { x: 320, y: 0 },
                    config: { agent_id: "agent-1" },
                },
                {
                    id: "extract",
                    type: "custom",
                    implementation: "intelligence",
                    name: "Process call",
                    position: { x: 320, y: 240 },
                    config: { schema_id: "lead" },
                },
            ],
            transitions: [
                { id: "answer-agent", from: "answered", outcome: "started", to: "agent" },
                { id: "ended-extract", from: "ended", outcome: "caller_hung_up", to: "extract" },
            ],
            variables: [{ name: "lead", type: "object" }],
        },
    };
}

test("carries the stored flow family through canvas metadata", () => {
    const diagram = flowToDiagram(callFlow());

    assert.equal(JSON.parse(diagram.context).family, "call");
});

test("uses the catalogue label when a stored node has no name", () => {
    const flow = callFlow();
    delete (flow.graph?.nodes[0] as Partial<NonNullable<Flow["graph"]>["nodes"][number]>).name;

    const diagram = flowToDiagram(flow);

    assert.equal(diagram.graph.nodes[0].name, "Call answered");
});

test("round-trips every trigger without writing a singleton v3 start", () => {
    const flow = callFlow();
    const graph = diagramToFlowGraph(flowToDiagram(flow), flow.graph);

    assert.equal(graph.version, 3);
    assert.equal("start" in graph, false);
    assert.deepEqual(
        graph.nodes
            .filter((node) => node.implementation.startsWith("trigger."))
            .map((node) => ({ id: node.id, implementation: node.implementation, key: node.config.key ?? "default" })),
        [
            { id: "answered", implementation: "trigger.call_answered", key: "default" },
            { id: "ended", implementation: "trigger.call_ended", key: "default" },
        ],
    );
    assert.deepEqual(graph.transitions, flow.graph?.transitions);
    assert.deepEqual(graph.variables, [{ name: "lead", type: "object" }]);
});
