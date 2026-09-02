/**
 * A call flow, as the console handles it.
 *
 * The stored shape is a graph in `flows.graph`: nodes with named outcomes, and
 * transitions that leave a specific outcome. Leaving an *outcome* rather than a
 * node is the whole design — an agent finishes as `wants_human` and the flow
 * decides what that means, which is what lets one agent serve two clinics that
 * escalate differently.
 *
 * A node carries two identifiers. `type` is the primitive the engine runs —
 * condition, loop, var, code or custom — and `implementation` names the registry
 * entry that supplies its configuration shape, its outcomes and its label. The
 * engine dispatches on the first and knows nothing about the second.
 *
 * Kept apart from React Flow's own types. The canvas is a rendering of a flow,
 * not the flow itself, and a stored graph should not change shape because a
 * drawing library did.
 */

export type FlowNode = {
    id: string;
    /** The primitive the engine runs: condition · loop · var · code · custom. */
    type: string;
    /** Which registry entry supplies the config shape, outcomes and label. */
    implementation: string;
    name: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
};

export type FlowTransition = {
    id: string;
    from: string;
    /** The outcome it leaves by. A transition leaves an outcome, never a node. */
    outcome: string;
    to: string;
};

export type FlowGraph = {
    version: number;
    /** The node that answers the call. */
    start: string;
    nodes: FlowNode[];
    transitions: FlowTransition[];
    /** Values carried for the length of one call. */
    variables: { name: string; type: string }[];
};

export type Flow = {
    id: string;
    name: string;
    description: string | null;
    status: string;
    graph: FlowGraph | null;
    /**
     * The event this flow handles. It stays on the row rather than living only
     * in the graph because `number_flows` and the bridge's `resolve_for_event`
     * both query it, and neither can read into graph JSON.
     */
    trigger_event?: string;
    updated_at?: string;
};

export const EMPTY_GRAPH: FlowGraph = { version: 2, start: "", nodes: [], transitions: [], variables: [] };

/** A stored graph, defaulted. A flow created through the generic route has none. */
export function readGraph(flow: Flow | null | undefined): FlowGraph {
    const graph = flow?.graph;
    if (!graph || !Array.isArray(graph.nodes)) return EMPTY_GRAPH;
    return {
        version: graph.version ?? 2,
        start: graph.start ?? "",
        nodes: graph.nodes,
        transitions: Array.isArray(graph.transitions) ? graph.transitions : [],
        variables: Array.isArray(graph.variables) ? graph.variables : [],
    };
}

export type FlowProblem = { nodeId?: string; message: string };

/**
 * What would stop this flow answering a call.
 *
 * The same checks the database makes when a flow is released, run here so they
 * appear while the flow is being drawn rather than at the end. Half-connected is
 * a normal state mid-edit, so these are shown, not enforced.
 */
export function checkGraph(graph: FlowGraph, knownTypes: Set<string>): FlowProblem[] {
    const problems: FlowProblem[] = [];
    const ids = new Set(graph.nodes.map((node) => node.id));

    if (!graph.nodes.length) return [{ message: "This flow has no nodes yet." }];

    if (!graph.start || !ids.has(graph.start)) {
        problems.push({ message: "No node is marked as the one that answers the call." });
    }

    for (const node of graph.nodes) {
        if (!knownTypes.has(node.implementation)) {
            problems.push({ nodeId: node.id, message: `“${node.name}” is a kind of node this version does not know.` });
        }
    }

    for (const transition of graph.transitions) {
        if (!ids.has(transition.from) || !ids.has(transition.to)) {
            problems.push({ message: "A transition points at a node that is no longer here." });
        }
    }

    // A node nothing leads to never runs. Worth saying while it can still be
    // connected, rather than after a caller has fallen down the gap.
    const reached = new Set<string>([graph.start]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const transition of graph.transitions) {
            if (reached.has(transition.from) && !reached.has(transition.to)) {
                reached.add(transition.to);
                grew = true;
            }
        }
    }
    for (const node of graph.nodes) {
        if (!reached.has(node.id)) {
            problems.push({ nodeId: node.id, message: `Nothing leads to “${node.name}”, so it never runs.` });
        }
    }

    return problems;
}

/** Outcomes of a node with no transition — the caller would stop there. */
export function danglingOutcomes(graph: FlowGraph, node: FlowNode, outcomes: { id: string }[]): string[] {
    const used = new Set(graph.transitions.filter((t) => t.from === node.id).map((t) => t.outcome));
    return outcomes.filter((outcome) => !used.has(outcome.id)).map((outcome) => outcome.id);
}
