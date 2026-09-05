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
    /** Legacy v2 entry point. Graph v3 selects an explicit trigger instead. */
    start?: string;
    nodes: FlowNode[];
    transitions: FlowTransition[];
    /** Values carried for the length of one call. */
    variables: { name: string; type: string }[];
};

export type FlowFamily = "call" | "integration" | "care_path" | "message" | "general";

export type FlowEntryPoint = {
    event: string;
    key?: string;
};

export type TriggerEntry = {
    event: string;
    key: string;
    nodeId: string;
};

type EntryCapableNode = {
    id: string;
    type: string;
    implementation?: string;
};

type EntryCapableGraph = {
    nodes: EntryCapableNode[];
};

export type Flow = {
    id: string;
    name: string;
    description: string | null;
    status: string;
    graph: FlowGraph | null;
    /** What capabilities and triggers this flow is allowed to contain. */
    family?: FlowFamily;
    /**
     * The event this flow handles. It stays on the row rather than living only
     * in the graph because `number_flows` and the bridge's `resolve_for_event`
     * both query it, and neither can read into graph JSON.
     */
    trigger_event?: string;
    updated_at?: string;
};

export const EMPTY_GRAPH: FlowGraph = { version: 2, start: "", nodes: [], transitions: [], variables: [] };

const DEFAULT_TRIGGER_OUTCOME: Record<string, string> = {
    "call.answered": "started",
    "call.ended": "caller_hung_up",
    "call.failed": "engine_failed",
};

function eventForTriggerImplementation(implementation: string): string {
    const encoded = implementation.slice("trigger.".length);
    const separator = encoded.indexOf("_");
    return separator < 0 ? encoded : `${encoded.slice(0, separator)}.${encoded.slice(separator + 1)}`;
}

function triggerImplementationForEvent(event: string): string {
    return `trigger.${event.replace(".", "_")}`;
}

/** Every explicit graph entry, in storage order. Selection never depends on that order. */
export function triggerEntries(graph: FlowGraph): TriggerEntry[] {
    return graph.nodes.flatMap((node) => {
        if (!node.implementation.startsWith("trigger.")) return [];
        return [
            {
                event: eventForTriggerImplementation(node.implementation),
                key: typeof node.config.key === "string" && node.config.key.trim() ? node.config.key.trim() : "default",
                nodeId: node.id,
            },
        ];
    });
}

/** The exact trigger node for an incoming event, or null when this flow does not handle it. */
export function entryNodeId(graph: FlowGraph, entry: FlowEntryPoint): string | null {
    const key = entry.key?.trim() || "default";
    return triggerEntries(graph).find((candidate) => candidate.event === entry.event && candidate.key === key)?.nodeId ?? null;
}

function isTriggerNode(node: EntryCapableNode): boolean {
    return (node.implementation ?? node.type).startsWith("trigger.");
}

/** Trigger nodes are graph roots and can never be the target of an edge. */
export function canConnectToNode(node: EntryCapableNode): boolean {
    return !isTriggerNode(node);
}

/** Ordinary nodes are removable; a trigger is removable while another entry remains. */
export function canDeleteTrigger(graph: EntryCapableGraph, nodeId: string): boolean {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    if (!isTriggerNode(node)) return true;
    return graph.nodes.filter(isTriggerNode).length > 1;
}

/**
 * Upgrade the legacy singleton entry point in memory without changing its work.
 * Saving the returned graph is the compatibility-first v2 -> v3 migration.
 */
export function normalizeFlowGraph(flow: Flow): FlowGraph {
    const source = readGraph(flow);
    if (triggerEntries(source).length > 0) {
        return source.version === 3 ? source : { ...source, version: 3 };
    }

    const event = flow.trigger_event ?? "call.answered";
    const implementation = triggerImplementationForEvent(event);
    const head = source.nodes.find((node) => node.id === source.start) ?? source.nodes[0];
    let id = "trigger";
    while (source.nodes.some((node) => node.id === id)) id = `${id}_1`;

    const trigger: FlowNode = {
        id,
        type: "trigger",
        implementation,
        name: event
            .split(".")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" "),
        position: head ? { x: head.position.x - 380, y: head.position.y } : { x: 0, y: 0 },
        config: {},
    };
    const transitions = head
        ? [
              {
                  id: `${id}-start`,
                  from: id,
                  outcome: DEFAULT_TRIGGER_OUTCOME[event] ?? "started",
                  to: head.id,
              },
              ...source.transitions,
          ]
        : source.transitions;

    return { ...source, version: 3, start: id, nodes: [trigger, ...source.nodes], transitions };
}

/** A stored graph, defaulted. A flow created through the generic route has none. */
export function readGraph(flow: Flow | null | undefined): FlowGraph {
    const graph = flow?.graph;
    if (!graph || !Array.isArray(graph.nodes)) return EMPTY_GRAPH;
    return {
        version: graph.version ?? 2,
        ...(typeof graph.start === "string" ? { start: graph.start } : {}),
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
    const entries = triggerEntries(graph);

    if (!graph.nodes.length) return [{ message: "This flow has no nodes yet." }];

    if (entries.length === 0 && graph.version >= 3) {
        problems.push({ message: "This flow has no trigger." });
    } else if (entries.length === 0 && (!graph.start || !ids.has(graph.start))) {
        problems.push({ message: "No node is marked as the one that answers the call." });
    }

    const seenEntries = new Set<string>();
    for (const entry of entries) {
        const identity = `${entry.event}\u0000${entry.key}`;
        if (seenEntries.has(identity)) {
            problems.push({
                nodeId: entry.nodeId,
                message: `This flow already has a trigger for ${entry.event} (${entry.key}).`,
            });
        }
        seenEntries.add(identity);
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
    const reached = new Set<string>(entries.length > 0 ? entries.map((entry) => entry.nodeId) : graph.start ? [graph.start] : []);
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
