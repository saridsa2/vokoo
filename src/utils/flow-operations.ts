/**
 * Every change to a flow, as a pure function.
 *
 * The graph is one value. An operation takes it and returns a new one, so undo
 * is a stack of graphs rather than a log of things to reverse, and nothing can
 * half-apply.
 *
 * Operations that can fail return a result rather than throwing or quietly
 * returning the graph unchanged. A caller has to be able to tell someone *why*
 * a connection was refused, and "nothing happened" is the one answer that
 * cannot be explained.
 *
 * Consistency rules live here, not in the screen: deleting a node takes its
 * transitions with it, and one outcome leads to exactly one node. A screen that
 * forgot either would leave a graph that renders and cannot run.
 */

import type { CatalogueNodeType } from "./capability-registry";
import type { FlowGraph, FlowNode, FlowTransition } from "./flow-graph";

/** Implementation id to its catalogue row — what the screen already holds. */
export type NodeRegistry = Map<string, CatalogueNodeType>;

export type OperationFailure =
    | { kind: "node-not-found"; nodeId: string }
    | { kind: "unknown-implementation"; implementation: string }
    | { kind: "self-loop" }
    | { kind: "unknown-outcome"; nodeId: string; outcome: string }
    | { kind: "no-outcomes"; nodeId: string }
    | { kind: "duplicate-variable"; name: string }
    | { kind: "variable-not-found"; name: string };

export type Result<T> = { ok: true; value: T } | { ok: false; failure: OperationFailure };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (failure: OperationFailure): Result<never> => ({ ok: false, failure });

/** What to tell someone when an operation is refused. */
export function explain(failure: OperationFailure): string {
    switch (failure.kind) {
        case "node-not-found":
            return "That node is no longer in the flow.";
        case "unknown-implementation":
            return `This version does not know how to run “${failure.implementation}”.`;
        case "self-loop":
            return "A node cannot lead to itself.";
        case "unknown-outcome":
            return `That node does not finish as “${failure.outcome}”.`;
        case "no-outcomes":
            return "This node ends the call, so nothing can follow it.";
        case "duplicate-variable":
            return `A value called “${failure.name}” already exists.`;
        case "variable-not-found":
            return `There is no value called “${failure.name}”.`;
    }
}

const findNode = (graph: FlowGraph, id: string) => graph.nodes.find((node) => node.id === id);

const outcomesOf = (registry: NodeRegistry, node: FlowNode) => registry.get(node.implementation)?.outcomes ?? [];

/**
 * Ids are generated here rather than by the caller so nothing can invent a
 * duplicate. Short and prefixed: an id read aloud in a bug report should say
 * what it is.
 */
let counter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

/* ------------------------------------------------------------------- nodes */

export function addNode(
    graph: FlowGraph,
    registry: NodeRegistry,
    implementation: string,
    position: { x: number; y: number },
): Result<{ graph: FlowGraph; nodeId: string }> {
    const definition = registry.get(implementation);
    if (!definition) return fail({ kind: "unknown-implementation", implementation });

    const node: FlowNode = {
        id: nextId("n"),
        type: definition.node_type,
        implementation,
        name: definition.label,
        position,
        // Defaults come from the registry's declared fields, so a new node is
        // valid on arrival wherever the registry says what "valid" is.
        config: Object.fromEntries(
            definition.fields.filter((field) => field.default !== undefined).map((field) => [field.key, field.default]),
        ),
    };

    // The first node placed on an empty canvas is the one that answers, because
    // a flow with nodes and no entry point is never what anyone meant.
    const start = graph.nodes.length === 0 ? node.id : graph.start;

    return ok({ graph: { ...graph, start, nodes: [...graph.nodes, node] }, nodeId: node.id });
}

export function moveNode(graph: FlowGraph, nodeId: string, position: { x: number; y: number }): Result<FlowGraph> {
    if (!findNode(graph, nodeId)) return fail({ kind: "node-not-found", nodeId });
    return ok({
        ...graph,
        nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
    });
}

export function renameNode(graph: FlowGraph, nodeId: string, name: string): Result<FlowGraph> {
    if (!findNode(graph, nodeId)) return fail({ kind: "node-not-found", nodeId });
    return ok({ ...graph, nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, name } : node)) });
}

/**
 * Merge settings into a node.
 *
 * Merged rather than replaced so a form can write one field at a time. Keys the
 * registry does not declare are dropped instead of refused — a stale form
 * sending an obsolete key should not block someone from editing the rest.
 */
export function configureNode(
    graph: FlowGraph,
    registry: NodeRegistry,
    nodeId: string,
    changes: Record<string, unknown>,
): Result<FlowGraph> {
    const node = findNode(graph, nodeId);
    if (!node) return fail({ kind: "node-not-found", nodeId });

    const declared = new Set((registry.get(node.implementation)?.fields ?? []).map((field) => field.key));
    const accepted = Object.fromEntries(Object.entries(changes).filter(([key]) => declared.has(key)));

    return ok({
        ...graph,
        nodes: graph.nodes.map((candidate) =>
            candidate.id === nodeId ? { ...candidate, config: { ...candidate.config, ...accepted } } : candidate,
        ),
    });
}

export function deleteNode(graph: FlowGraph, nodeId: string): Result<FlowGraph> {
    if (!findNode(graph, nodeId)) return fail({ kind: "node-not-found", nodeId });

    const remaining = graph.nodes.filter((node) => node.id !== nodeId);

    return ok({
        ...graph,
        // Leaving `start` pointing at a node that is gone gives a flow that
        // looks complete and cannot answer. Promote the next node instead of
        // emptying it, so the common case of deleting the first node while
        // rearranging does not leave the flow broken.
        start: graph.start === nodeId ? (remaining[0]?.id ?? "") : graph.start,
        nodes: remaining,
        transitions: graph.transitions.filter(
            (transition) => transition.from !== nodeId && transition.to !== nodeId,
        ),
    });
}

/**
 * Copy a node, with nothing wired to it.
 *
 * Neither its inbound nor its outbound transitions come along. Inbound
 * especially: redirecting them would silently move every caller who reached the
 * original onto the copy, which is a change to the flow's behaviour dressed up
 * as a copy.
 */
export function duplicateNode(graph: FlowGraph, nodeId: string): Result<{ graph: FlowGraph; nodeId: string }> {
    const original = findNode(graph, nodeId);
    if (!original) return fail({ kind: "node-not-found", nodeId });

    const copy: FlowNode = {
        ...original,
        id: nextId("n"),
        name: `${original.name} copy`,
        position: { x: original.position.x + 40, y: original.position.y + 40 },
        config: { ...original.config },
    };

    return ok({ graph: { ...graph, nodes: [...graph.nodes, copy] }, nodeId: copy.id });
}

export function setStartNode(graph: FlowGraph, nodeId: string): Result<FlowGraph> {
    if (!findNode(graph, nodeId)) return fail({ kind: "node-not-found", nodeId });
    return ok({ ...graph, start: nodeId });
}

/* ------------------------------------------------------------- transitions */

export function addTransition(
    graph: FlowGraph,
    registry: NodeRegistry,
    from: string,
    outcome: string,
    to: string,
): Result<FlowGraph> {
    const source = findNode(graph, from);
    if (!source) return fail({ kind: "node-not-found", nodeId: from });
    if (!findNode(graph, to)) return fail({ kind: "node-not-found", nodeId: to });
    if (from === to) return fail({ kind: "self-loop" });

    const outcomes = outcomesOf(registry, source);
    if (outcomes.length === 0) return fail({ kind: "no-outcomes", nodeId: from });
    if (!outcomes.some((candidate) => candidate.id === outcome)) {
        return fail({ kind: "unknown-outcome", nodeId: from, outcome });
    }

    // One transition per outcome. A second would make the flow ambiguous, so it
    // replaces rather than joins — which is also what someone rewiring a line
    // expects to happen.
    const transition: FlowTransition = { id: nextId("t"), from, outcome, to };

    return ok({
        ...graph,
        transitions: [
            ...graph.transitions.filter(
                (existing) => !(existing.from === from && existing.outcome === outcome),
            ),
            transition,
        ],
    });
}

export function deleteTransition(graph: FlowGraph, transitionId: string): Result<FlowGraph> {
    return ok({ ...graph, transitions: graph.transitions.filter((t) => t.id !== transitionId) });
}

/* --------------------------------------------------------------- variables */

export function addVariable(graph: FlowGraph, name: string, type: string): Result<FlowGraph> {
    if (graph.variables.some((variable) => variable.name === name)) {
        return fail({ kind: "duplicate-variable", name });
    }
    return ok({ ...graph, variables: [...graph.variables, { name, type }] });
}

export function removeVariable(graph: FlowGraph, name: string): Result<FlowGraph> {
    if (!graph.variables.some((variable) => variable.name === name)) {
        return fail({ kind: "variable-not-found", name });
    }
    return ok({ ...graph, variables: graph.variables.filter((variable) => variable.name !== name) });
}

export function renameVariable(graph: FlowGraph, name: string, nextName: string): Result<FlowGraph> {
    if (!graph.variables.some((variable) => variable.name === name)) {
        return fail({ kind: "variable-not-found", name });
    }
    if (graph.variables.some((variable) => variable.name === nextName)) {
        return fail({ kind: "duplicate-variable", name: nextName });
    }
    return ok({
        ...graph,
        variables: graph.variables.map((variable) =>
            variable.name === name ? { ...variable, name: nextName } : variable,
        ),
    });
}
