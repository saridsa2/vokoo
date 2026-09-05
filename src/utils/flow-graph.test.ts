import assert from "node:assert/strict";
import { test } from "node:test";

import {
    checkGraph,
    entryNodeId,
    normalizeFlowGraph,
    triggerEntries,
    type Flow,
    type FlowGraph,
} from "./flow-graph.ts";

const knownTypes = new Set(["trigger.call_answered", "trigger.call_ended", "agent", "intelligence"]);

function multiTriggerGraph(): FlowGraph {
    return {
        version: 3,
        nodes: [
            {
                id: "answer",
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
                position: { x: 0, y: 200 },
                config: { key: "default" },
            },
            {
                id: "during",
                type: "custom",
                implementation: "agent",
                name: "Receptionist",
                position: { x: 300, y: 0 },
                config: {},
            },
            {
                id: "after",
                type: "custom",
                implementation: "intelligence",
                name: "Process call",
                position: { x: 300, y: 200 },
                config: {},
            },
        ],
        transitions: [
            { id: "answered-agent", from: "answer", outcome: "started", to: "during" },
            { id: "ended-process", from: "ended", outcome: "caller_hung_up", to: "after" },
        ],
        variables: [],
    };
}

test("selects a trigger by event and defaults its key", () => {
    const graph = multiTriggerGraph();

    assert.equal(entryNodeId(graph, { event: "call.answered" }), "answer");
    assert.equal(entryNodeId(graph, { event: "call.ended", key: "default" }), "ended");
});

test("does not fall through to another trigger when an entry is missing", () => {
    assert.equal(entryNodeId(multiTriggerGraph(), { event: "message.received" }), null);
});

test("enumerates triggers without depending on node order", () => {
    const graph = multiTriggerGraph();
    graph.nodes.reverse();

    assert.deepEqual(
        triggerEntries(graph)
            .sort((left, right) => left.event.localeCompare(right.event))
            .map(({ event, key, nodeId }) => ({ event, key, nodeId })),
        [
            { event: "call.answered", key: "default", nodeId: "answer" },
            { event: "call.ended", key: "default", nodeId: "ended" },
        ],
    );
});

test("validates reachability from every trigger", () => {
    assert.deepEqual(checkGraph(multiTriggerGraph(), knownTypes), []);
});

test("rejects two triggers with the same event and key", () => {
    const graph = multiTriggerGraph();
    graph.nodes.push({
        id: "answer-again",
        type: "trigger",
        implementation: "trigger.call_answered",
        name: "Another answered trigger",
        position: { x: 0, y: 400 },
        config: { key: "default" },
    });

    assert.match(
        checkGraph(graph, knownTypes).map((problem) => problem.message).join("\n"),
        /already has a trigger for call\.answered/i,
    );
});

test("normalizes a legacy start into one explicit trigger without changing its work", () => {
    const legacy: Flow = {
        id: "legacy",
        name: "Legacy reception",
        description: null,
        status: "draft",
        trigger_event: "call.answered",
        graph: {
            version: 2,
            start: "during",
            nodes: [
                {
                    id: "during",
                    type: "custom",
                    implementation: "agent",
                    name: "Receptionist",
                    position: { x: 300, y: 0 },
                    config: {},
                },
            ],
            transitions: [],
            variables: [{ name: "language", type: "string" }],
        },
    };

    const normalized = normalizeFlowGraph(legacy);

    assert.equal(normalized.version, 3);
    assert.equal(normalized.nodes.find((node) => node.id === "during")?.name, "Receptionist");
    assert.deepEqual(normalized.variables, [{ name: "language", type: "string" }]);
    assert.deepEqual(triggerEntries(normalized), [
        { event: "call.answered", key: "default", nodeId: "trigger" },
    ]);
    assert.deepEqual(normalized.transitions, [
        { id: "trigger-start", from: "trigger", outcome: "started", to: "during" },
    ]);
});

test("leaves a graph that already has explicit triggers structurally unchanged", () => {
    const graph = multiTriggerGraph();
    const flow: Flow = {
        id: "current",
        name: "Current reception",
        description: null,
        status: "draft",
        trigger_event: "call.answered",
        graph,
    };

    assert.deepEqual(normalizeFlowGraph(flow), graph);
});
