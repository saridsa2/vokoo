"use client";

import { ViewportPortal } from "@xyflow/react";
import type { CatalogueNodeType } from "@/utils/capability-registry";
import type { FlowGraph } from "@/utils/flow-graph";
import { HEADER_HEIGHT, NODE_WIDTH, outcomeOffset } from "./flow-canvas-node";

/**
 * Transitions, drawn by us.
 *
 * React Flow's own edge renderer produces nothing in this project: a stock
 * two-node, one-edge graph renders both nodes and no edge, with the edges
 * container left empty and no warning logged. That is React 19.2 against
 * @xyflow/react 12.11, not this data — the same graph reaching the canvas with
 * seven nodes and eleven valid transitions drew none of them.
 *
 * So the transitions are drawn here instead. `ViewportPortal` puts this SVG
 * inside React Flow's transformed viewport, which means everything below is in
 * graph coordinates and pan and zoom come for free.
 *
 * The upside of having been forced into it: the geometry is ours. A line leaves
 * the exact row of the outcome it belongs to, which is the distinction the whole
 * flow turns on and which a single output per node would have flattened.
 */

type Props = {
    graph: FlowGraph;
    definitions: Map<string, CatalogueNodeType>;
    /** Live positions, so lines follow a node while it is being dragged. */
    positions: Map<string, { x: number; y: number }>;
    highlightNode: string | null;
    selectedTransition: string | null;
    onSelect: (transitionId: string) => void;
};

export function FlowCanvasEdges({ graph, definitions, positions, highlightNode, selectedTransition, onSelect }: Props) {
    const paths = graph.transitions
        .map((transition) => {
            const from = graph.nodes.find((node) => node.id === transition.from);
            const to = graph.nodes.find((node) => node.id === transition.to);
            if (!from || !to) return null;

            const outcomes = definitions.get(from.implementation)?.outcomes ?? [];
            const index = outcomes.findIndex((outcome) => outcome.id === transition.outcome);
            if (index < 0) return null;

            const start = positions.get(from.id) ?? from.position;
            const end = positions.get(to.id) ?? to.position;

            const x1 = start.x + NODE_WIDTH;
            const y1 = start.y + outcomeOffset(index);
            const x2 = end.x + NODE_WIDTH / 2;
            const y2 = end.y;

            // Out to the right, then down and in. A curve whose control points
            // scale with the gap keeps a short hop from looping and a long drop
            // from cutting a hard diagonal across the canvas.
            const reach = Math.max(40, Math.min(140, Math.abs(y2 - y1) / 2 + 40));
            const path = `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2} ${y2 - reach}, ${x2} ${y2}`;

            const isSelected = selectedTransition === transition.id;
            const isLit = isSelected || highlightNode === from.id || highlightNode === to.id;
            const label = outcomes[index]?.label ?? transition.outcome;

            return { id: transition.id, path, isLit, isSelected, label, lx: x1 + reach * 0.7, ly: y1 - 6 };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    // Bounds are irrelevant inside the portal — the SVG is transformed with the
    // viewport — but an explicit overflow keeps a line that leaves the box from
    // being clipped at any zoom.
    return (
        <ViewportPortal>
            <svg
                style={{ position: "absolute", overflow: "visible", width: 1, height: 1 }}
                aria-hidden="true"
            >
                <defs>
                    <marker id="vokoo-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M 0 1 L 6 4 L 0 7 z" className="fill-fg-quaternary" />
                    </marker>
                    <marker id="vokoo-arrow-lit" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M 0 1 L 6 4 L 0 7 z" className="fill-fg-brand-primary" />
                    </marker>
                </defs>

                {paths.map((entry) => (
                    <g key={entry.id}>
                        {/* A one-pixel line is not a click target. This wider
                            invisible path is what a pointer actually hits. */}
                        <path
                            d={entry.path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={14}
                            style={{ cursor: "pointer", pointerEvents: "stroke" }}
                            onClick={(event) => {
                                event.stopPropagation();
                                onSelect(entry.id);
                            }}
                        />
                        <path
                            d={entry.path}
                            fill="none"
                            style={{ pointerEvents: "none" }}
                            strokeWidth={entry.isSelected ? 2.25 : entry.isLit ? 1.75 : 1}
                            markerEnd={`url(#${entry.isLit ? "vokoo-arrow-lit" : "vokoo-arrow"})`}
                            className={entry.isLit ? "stroke-fg-brand-primary" : "stroke-border-primary"}
                        />
                        {entry.isLit && (
                            <text
                                x={entry.lx}
                                y={entry.ly}
                                textAnchor="middle"
                                className="fill-fg-quaternary"
                                style={{ fontSize: 10, letterSpacing: 0.2, pointerEvents: "none" }}
                            >
                                {entry.label}
                            </text>
                        )}
                    </g>
                ))}
            </svg>
        </ViewportPortal>
    );
}
