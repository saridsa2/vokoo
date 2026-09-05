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
//  3. Graph v3 has explicit trigger nodes rather than one `start`. A legacy
//     graph is normalized before drawing, so the canvas always sees the same
//     multi-entry shape that the new runtime sees.

import type { Diagram, DiagramEdge, DiagramNode, NodeType } from "@/lib/architecture-model";
import { NODE_TYPES, outcomeForNode } from "@/lib/architecture-model";
import type { Flow, FlowFamily, FlowGraph, FlowNode, FlowTransition } from "@/utils/flow-graph";
import { normalizeFlowGraph } from "@/utils/flow-graph";

/** A stored flow, as the canvas draws it. */
export function flowToDiagram(flow: Flow): Diagram {
    const graph = normalizeFlowGraph(flow);
    const now = new Date().toISOString();
    const family = flow.family ?? legacyFamily(flow.trigger_event);

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
        // Family is an authored capability boundary. `legacyStart` is carried
        // only so a v2 snapshot can still be inspected during the rollout.
        context: JSON.stringify({ family, legacyStart: graph.start, variables: graph.variables, version: 3 }),
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

    return {
        version: 3,
        nodes,
        transitions,
        variables: carried.variables ?? previous?.variables ?? [],
    };
}

type Carried = {
    family?: FlowFamily;
    legacyStart?: string;
    variables?: FlowGraph["variables"];
    version?: number;
};

function legacyFamily(triggerEvent: string | undefined): FlowFamily {
    if (triggerEvent === "call.ended") return "integration";
    if (triggerEvent === "message.received") return "message";
    return "call";
}

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
