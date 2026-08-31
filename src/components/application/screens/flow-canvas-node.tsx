"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
    AlertCircle,
    Clock,
    Code02,
    IconAgents,
    IconBroadcast,
    PlayCircle,
    RefreshCcw02,
    Stars02,
} from "@/components/icons";
import type { CatalogueNodeType } from "@/utils/capability-registry";

/**
 * One node on the canvas.
 *
 * Geometry is fixed rather than intrinsic — a set width, a set header height, a
 * set row height. The transitions are drawn in a separate layer that computes
 * where an outcome sits from these numbers, so a node whose height depended on
 * its content would leave every line pointing at the wrong place. Changing a
 * measurement here means changing it in `flow-canvas-edges` too, which is why
 * they are exported from one module.
 */

export const NODE_WIDTH = 268;
export const HEADER_HEIGHT = 52;
export const ROW_HEIGHT = 28;
export const FOOTER_HEIGHT = 24;

export function nodeHeight(outcomes: number, hasFooter: boolean): number {
    return HEADER_HEIGHT + outcomes * ROW_HEIGHT + (hasFooter ? FOOTER_HEIGHT : 0);
}

/** Where an outcome's connector sits, relative to the node's top-left. */
export function outcomeOffset(index: number): number {
    return HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

// Keyed by the primitive: a new registry entry draws without a change here, and
// only a new primitive would need an icon.
const TYPE_ICON: Record<string, typeof IconAgents> = {
    condition: Clock,
    loop: RefreshCcw02,
    var: Stars02,
    code: Code02,
    custom: IconBroadcast,
};

export type FlowNodeData = {
    label: string;
    type: string;
    implementation: string;
    definition: CatalogueNodeType | null;
    /** Outcomes with no transition leaving them. */
    dangling: Set<string>;
    isStart: boolean;
    subtitle: string | null;
    problem: string | null;
};

export function FlowCanvasNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
    const Icon = data.implementation === "agent" ? IconAgents : (TYPE_ICON[data.type] ?? IconBroadcast);
    const outcomes = data.definition?.outcomes ?? [];
    const hasFooter = !!data.definition?.provider_action;

    return (
        <div
            style={{ width: NODE_WIDTH }}
            className={`flex flex-col bg-primary text-left ring-1 transition duration-100 ease-linear ${
                selected
                    ? "ring-2 ring-fg-brand-primary"
                    : data.problem
                      ? "ring-1 ring-warning"
                      : "ring-1 ring-secondary"
            }`}
        >
            {!data.isStart && (
                <Handle type="target" position={Position.Top} className="!size-2 !border-0 !bg-transparent" />
            )}

            {/* Header: an ink chip carrying the icon, then the name and what the
                node will actually do. */}
            <div style={{ height: HEADER_HEIGHT }} className="flex items-center gap-2.5 border-b border-secondary px-3">
                <span
                    className={`grid size-7 shrink-0 place-items-center ${
                        data.isStart ? "bg-brand-solid" : "bg-secondary"
                    }`}
                >
                    <Icon className={`size-3.5 ${data.isStart ? "text-white" : "text-fg-quaternary"}`} />
                </span>

                <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] leading-tight font-medium text-primary">{data.label}</p>
                    <p className="truncate text-[11px] leading-tight text-tertiary">
                        {data.subtitle ?? data.definition?.label ?? data.implementation}
                    </p>
                </div>

                {data.isStart && (
                    <PlayCircle className="size-3.5 shrink-0 text-fg-quaternary" aria-label="Answers the call" />
                )}
                {data.problem && <AlertCircle className="size-3.5 shrink-0 text-fg-warning-primary" />}
            </div>

            {outcomes.map((outcome, index) => {
                const isDangling = data.dangling.has(outcome.id);
                return (
                    <div
                        key={outcome.id}
                        style={{ height: ROW_HEIGHT }}
                        className="relative flex items-center justify-between border-b border-secondary px-3 last:border-b-0"
                    >
                        <span className={`text-[11px] ${isDangling ? "text-quaternary" : "text-secondary"}`}>
                            {outcome.label}
                        </span>
                        {/* A hollow marker is an outcome nothing leaves by — a
                            place a call stops with nothing left to do. */}
                        <span
                            className={`size-1.5 ${isDangling ? "ring-1 ring-border-primary" : "bg-fg-brand-primary"}`}
                        />
                        <Handle
                            id={outcome.id}
                            type="source"
                            position={Position.Right}
                            style={{ top: ROW_HEIGHT / 2 }}
                            className="!size-3 !border-0 !bg-transparent"
                        />
                    </div>
                );
            })}

            {hasFooter && (
                <div
                    style={{ height: FOOTER_HEIGHT }}
                    className="flex items-center border-t border-secondary bg-secondary px-3 font-mono text-[10px] text-quaternary"
                >
                    {data.definition!.provider_action}
                </div>
            )}
        </div>
    );
}
