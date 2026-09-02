// Between the flow the bridge runs and the diagram the canvas draws.
//
// They are the same graph seen from two sides. The bridge keys transitions on
// `(from, outcome)` — `runner.rs` resolves the next node from the outcome a node
// reported, which is the whole design: two lines leave one node for different
// reasons. The canvas draws an edge from an outcome connection point. So a
// transition and an edge are the same fact, and this file is the place that
// says so rather than each screen deciding for itself.
//
// Three differences are worth stating, because each one is a chance to lose
// something:
//
//  1. A flow node carries both `type` (the primitive the engine runs) and
//     `implementation` (which catalogue entry supplies its behaviour). The
//     canvas has one `type`, and it is the catalogue id — which is the flow's
//     `implementation`. `type` is recoverable from the catalogue, so it is
//     restored on the way back rather than carried around.
//
//  2. Flow config is flat: `{ timezone, opens, closes }`. Canvas config is
//     nested under the node's kind, because the inspector renders one schema at
//     a time. Flattening the wrong level silently produces a node the bridge
//     reads as unconfigured.
//
//  3. A flow has a `start`. On the canvas that is the trigger node — the one
//     node the flow is entered at rather than run. A flow drawn before triggers
//     existed has none, so one is materialised from the row's `trigger_event`
//     and wired to whatever `start` used to name. That is a real node from that
//     point on, not a decoration: it is saved back into the graph, the bridge's
//     registry knows it from `catalogue_node_types`, and `runner.rs` walks
//     through it.

import type { Diagram, DiagramEdge, DiagramNode, NodeType } from "@/lib/architecture-model";
import { NODE_TYPES, TRIGGER_NODE_FOR_EVENT, isTriggerType, outcomeForNode } from "@/lib/architecture-model";
import type { Flow, FlowGraph, FlowNode, FlowTransition } from "@/utils/flow-graph";
import { EMPTY_GRAPH } from "@/utils/flow-graph";

/** The trigger a flow handling this event opens with. */
function triggerTypeFor(flow: Flow): NodeType {
    return TRIGGER_NODE_FOR_EVENT[flow.trigger_event ?? "call.answered"] ?? "trigger.call_answered";
}

/**
 * The trigger node a flow opens with, added if the stored graph predates them.
 *
 * The materialised node is wired to whatever `start` used to name, so the graph
 * still runs the same nodes in the same order — the trigger is prepended, never
 * substituted. Nothing is materialised for a graph that already has one, which
 * is what makes this safe to run on every load.
 */
function withTrigger(graph: FlowGraph, flow: Flow): FlowGraph {
    if (graph.nodes.some((node) => isTriggerType(node.implementation as NodeType))) return graph;

    const type = triggerTypeFor(flow);
    const meta = NODE_TYPES[type];
    // A graph with no nodes gets its trigger and nothing to point at. That is
    // the correct empty flow: an entry point with an unwired outcome.
    const head = graph.nodes.find((node) => node.id === graph.start) ?? graph.nodes[0];

    // Deterministic, so reopening the same flow twice does not produce two ids
    // for the same node and make an edit look like a rewrite. Suffixed only if
    // somebody's hand-written graph already took the name.
    let id = "trigger";
    while (graph.nodes.some((node) => node.id === id)) id = `${id}_1`;

    const node: FlowNode = {
        id,
        type: "trigger",
        implementation: type,
        name: meta.label,
        // Left of the node it leads to, at the same height, so the board reads
        // in the direction the edges already flow.
        position: head ? { x: head.position.x - 380, y: head.position.y } : { x: 0, y: 0 },
        config: {},
    };

    const transitions = head
        ? [{ id: `${id}-start`, from: id, outcome: meta.outcomes[0].id, to: head.id }, ...graph.transitions]
        : graph.transitions;

    return { ...graph, start: id, nodes: [node, ...graph.nodes], transitions };
}

/** The node a flow begins at, when the stored graph does not say. */
function inferStart(nodes: FlowNode[], transitions: FlowTransition[]): string {
    const entered = new Set(transitions.map((t) => t.to));
    // A node nothing points at is where the call arrives. More than one means
    // the graph has several ways in, which the runner cannot express; the first
    // is taken and the flow's own `start` should be trusted over this.
    return nodes.find((n) => !entered.has(n.id))?.id ?? nodes[0]?.id ?? "";
}

/** A stored flow, as the canvas draws it. */
export function flowToDiagram(flow: Flow): Diagram {
    const graph = withTrigger(flow.graph ?? EMPTY_GRAPH, flow);
    const now = new Date().toISOString();

    const nodes: DiagramNode[] = graph.nodes.map((node) => ({
        id: node.id,
        // The catalogue id. A flow whose implementation is not in the catalogue
        // is kept rather than dropped: the node is real, someone drew it, and
        // silently removing it would lose work to a catalogue that moved on.
        type: node.implementation as NodeType,
        name: node.name,
        // The author's note, or nothing. This was the node type's label, so
        // every node arrived carrying a description identical to the type
        // already shown beside its name — the same words three times in one
        // header. A stored graph has no description field to read yet; when it
        // does, it belongs here.
        description: "",
        position: node.position ?? { x: 0, y: 0 },
        // Nested under the kind, which is where the inspector reads it.
        config: { [node.implementation]: { ...(node.config ?? {}) } },
    }));

    const edges: DiagramEdge[] = graph.transitions.map((transition) => ({
        id: transition.id,
        sourceNodeId: transition.from,
        targetNodeId: transition.to,
        outcome: transition.outcome,
        // The label is what a reader sees; the outcome id is what the runner
        // resolves. Derived rather than stored twice.
        label: outcomeLabel(graph, transition),
        style: "flowing",
    }));

    return {
        id: flow.id,
        ownerUserId: "",
        name: flow.name,
        description: flow.description ?? "",
        // Carries what the canvas cannot express, so a round trip does not
        // discard it: the start node, the declared variables, the version.
        context: JSON.stringify({ start: graph.start, variables: graph.variables, version: graph.version }),
        graph: { nodes, edges },
        isPublic: false,
        commentsEnabled: false,
        publishedAt: null,
        createdAt: now,
        updatedAt: flow.updated_at ?? now,
    };
}

function outcomeLabel(graph: FlowGraph, transition: FlowTransition): string {
    const from = graph.nodes.find((n) => n.id === transition.from);
    if (!from) return transition.outcome;
    // Through `outcomeForNode`, not `NODE_TYPES[...].outcomes`.
    //
    // A menu's branches live in the node the author configured, not in its
    // type, so reading the type directly finds nothing for a digit and falls
    // through to the raw outcome id — a flow whose edges read "1", "2", "#"
    // where the author wrote "English", "Hindi". The canvas recomputes labels
    // on every render and so hid this on screen, but the wrong label is what
    // landed in the Diagram and went back out through `diagramToFlowGraph`.
    //
    // A stored graph keys config flat; a diagram node keys it by type. This is
    // the seam between the two, so the shape is built here rather than giving
    // `outcomesForNode` a second way to be called.
    const outcome = outcomeForNode(
        { type: from.implementation as NodeType, config: { [from.implementation]: from.config ?? {} } },
        transition.outcome,
    );
    return outcome?.label ?? transition.outcome;
}

/** A drawn diagram, as the bridge runs it. */
export function diagramToFlowGraph(diagram: Diagram, previous?: FlowGraph | null): FlowGraph {
    const carried = readCarried(diagram.context);

    const nodes: FlowNode[] = diagram.graph.nodes.map((node) => ({
        id: node.id,
        // Restored from the catalogue rather than carried on the diagram: the
        // canvas has no field for it, and inventing one would give two places
        // for the same fact to be wrong.
        type: NODE_TYPES[node.type]?.node_type ?? "custom",
        implementation: node.type,
        name: node.name,
        position: node.position,
        config: { ...((node.config?.[node.type] as Record<string, unknown>) ?? {}) },
    }));

    const transitions: FlowTransition[] = diagram.graph.edges
        // An edge with no outcome cannot be resolved by the runner: it would sit
        // in the graph doing nothing while looking like a route. Dropped, and
        // the composer should refuse to draw one.
        .filter((edge) => Boolean(edge.outcome))
        .map((edge) => ({
            id: edge.id,
            from: edge.sourceNodeId,
            outcome: edge.outcome as string,
            to: edge.targetNodeId,
        }));

    // The trigger is where the flow is entered, so it is `start` — the board
    // says so directly rather than the answer being carried alongside it. The
    // older reasoning stays underneath for a graph still without one.
    const trigger = nodes.find((node) => isTriggerType(node.implementation as NodeType));
    const start =
        trigger?.id ||
        (carried.start && nodes.some((n) => n.id === carried.start) ? carried.start : "") ||
        previous?.start ||
        inferStart(nodes, transitions);

    return {
        version: carried.version ?? previous?.version ?? EMPTY_GRAPH.version,
        start,
        nodes,
        transitions,
        variables: carried.variables ?? previous?.variables ?? [],
    };
}

type Carried = { start?: string; variables?: FlowGraph["variables"]; version?: number };

function readCarried(context: string | undefined): Carried {
    if (!context) return {};
    try {
        const parsed = JSON.parse(context) as Carried;
        return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
        // The context field is free text on a diagram. Anything that is not the
        // envelope this file writes is somebody's note, not a broken graph.
        return {};
    }
}
