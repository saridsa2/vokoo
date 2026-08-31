"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Background,
    Controls,
    ReactFlow,
    ReactFlowProvider,
    useNodesState,
    useNodesInitialized,
    useUpdateNodeInternals,
    type Connection,
    type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { AlertCircle, ArrowNarrowLeft, ArrowNarrowRight, PlayCircle, Trash01 } from "@/components/icons";
import { useCatalogue } from "@/hooks/use-catalogue";
import { useResource } from "@/hooks/use-resource";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/utils/api-client";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { checkGraph, danglingOutcomes, readGraph, type Flow, type FlowGraph, type FlowNode, type FlowTransition } from "@/utils/flow-graph";
import {
    addNode,
    addTransition,
    configureNode,
    deleteNode,
    deleteTransition,
    explain,
    moveNode,
    renameNode,
    setStartNode,
    type Result,
} from "@/utils/flow-operations";
import { emptyHistory, canRedo, canUndo, record, redo, settle, undo, type ChangeKind, type History } from "@/utils/flow-history";
import { FlowCanvasEdges } from "./flow-canvas-edges";
import { FlowNodeForm } from "./flow-node-form";
import { FlowCanvasNode, type FlowNodeData } from "./flow-canvas-node";
import type { CatalogueNodeType } from "@/utils/capability-registry";

/**
 * The composer: what happens when the phone rings.
 *
 * A flow is the thing a number points at. An agent is one node inside it — the
 * node that talks — and everything around it is call handling the agent knows
 * nothing about. That separation is why an agent can be reused by two clinics
 * that escalate differently: it reports `wants_human` and the flow decides what
 * that means.
 *
 * The canvas draws the stored graph rather than owning it. Positions and
 * connections are written back to `flows.graph`; React Flow's own node and
 * edge shapes never reach the database.
 */

const NODE_TYPES = { step: FlowCanvasNode };

export function ComposerScreen() {
    return (
        <ReactFlowProvider>
            <Composer />
        </ReactFlowProvider>
    );
}

function Composer() {
    const { records, isLoading, error, update, refresh } = useResource<Flow>("flows");
    const { catalogue, isLoading: isCatalogueLoading } = useCatalogue();
    // For the agent field. A node names an agent by id; the form needs names.
    const { context } = useSession();
    const { records: agents } = useResource<{ id: string; name: string; status: string }>("agents");

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [graph, setGraph] = useState<FlowGraph | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [history, setHistory] = useState<History>(emptyHistory);
    // Why an operation was refused. Cleared by the next one that succeeds.
    const [notice, setNotice] = useState<string | null>(null);
    const [selectedTransition, setSelectedTransition] = useState<string | null>(null);

    // Compared against the stored graph so moving a node and moving it back
    // does not leave Save armed.
    const savedGraph = useRef<string>("");

    const flow = records.find((record) => record.id === selectedId) ?? null;

    useEffect(() => {
        if (selectedId || !records.length) return;
        setSelectedId(records[0].id);
    }, [records, selectedId]);

    useEffect(() => {
        if (!flow) return;
        const next = readGraph(flow);
        setGraph(next);
        savedGraph.current = JSON.stringify(next);
    }, [flow]);

    const definitions = useMemo(
        () => new Map(catalogue.nodeTypes.map((definition) => [definition.id, definition])),
        [catalogue.nodeTypes],
    );

    const problems = useMemo(
        () => (graph ? checkGraph(graph, new Set(definitions.keys())) : []),
        [graph, definitions],
    );

    const problemByNode = useMemo(() => {
        const map = new Map<string, string>();
        for (const problem of problems) {
            if (problem.nodeId && !map.has(problem.nodeId)) map.set(problem.nodeId, problem.message);
        }
        return map;
    }, [problems]);

    /* ------------------------------------------------- graph -> canvas */

    const canvasNodes: Node<FlowNodeData>[] = useMemo(() => {
        if (!graph) return [];
        return graph.nodes.map((node) => {
            const definition = definitions.get(node.implementation) ?? null;
            return {
                id: node.id,
                type: "step",
                position: node.position,
                data: {
                    label: node.name,
                    type: node.type,
                    implementation: node.implementation,
                    definition,
                    dangling: new Set(danglingOutcomes(graph, node, definition?.outcomes ?? [])),
                    isStart: graph.start === node.id,
                    subtitle: subtitleFor(node, definition?.label ?? null, records),
                    problem: problemByNode.get(node.id) ?? null,
                },
            };
        });
    }, [graph, definitions, problemByNode, records]);

    /* ------------------------------------------------- canvas -> graph */

    // Positions are written back on drag end rather than on every frame: a drag
    // fires dozens of changes a second and each one would rewrite the graph.
    /**
     * Every change goes through one place.
     *
     * An operation returns a new graph or a reason it refused, and this is where
     * the previous graph is recorded for undo. Mutating the graph anywhere else
     * would put a change outside the history, and undo would step over it.
     */
    const apply = useCallback(
        (result: Result<FlowGraph>, kind: ChangeKind, target: string) => {
            if (!result.ok) {
                setNotice(explain(result.failure));
                return;
            }
            setNotice(null);
            setGraph((current) => {
                if (current) setHistory((h) => record(h, current, kind, target));
                return result.value;
            });
        },
        [],
    );

    const onNodeDragStop = useCallback(
        (_: unknown, moved: Node) => {
            if (!graph) return;
            apply(moveNode(graph, moved.id, moved.position), "move", moved.id);
            // A drag that has stopped is a finished intention; the next one is
            // its own undo step.
            setHistory(settle);
        },
        [graph, apply],
    );

    const onConnect = useCallback(
        (connection: Connection) => {
            if (!graph || !connection.source || !connection.target || !connection.sourceHandle) return;
            apply(
                addTransition(graph, definitions, connection.source, connection.sourceHandle, connection.target),
                "structural",
                "",
            );
        },
        [graph, definitions, apply],
    );

    const removeNode = useCallback(
        (nodeId: string) => {
            if (!graph) return;
            apply(deleteNode(graph, nodeId), "structural", "");
            setSelectedNode(null);
        },
        [graph, apply],
    );

    const placeNode = useCallback(
        (implementation: string) => {
            if (!graph) return;
            // Dropped below and right of everything already placed, so a new
            // node never lands underneath an existing one.
            const lowest = graph.nodes.reduce((max, node) => Math.max(max, node.position.y), 0);
            const result = addNode(graph, definitions, implementation, { x: 40, y: lowest + 160 });
            apply(
                result.ok ? { ok: true, value: result.value.graph } : result,
                "structural",
                "",
            );
            if (result.ok) setSelectedNode(result.value.nodeId);
        },
        [graph, definitions, apply],
    );

    const editNode = useCallback(
        (nodeId: string, changes: Record<string, unknown>) => {
            if (!graph) return;
            apply(configureNode(graph, definitions, nodeId, changes), "configure", nodeId);
        },
        [graph, definitions, apply],
    );

    const undoChange = useCallback(() => {
        if (!graph) return;
        const stepped = undo(history, graph);
        if (!stepped) return;
        setHistory(stepped.history);
        setGraph(stepped.graph);
    }, [graph, history]);

    const redoChange = useCallback(() => {
        if (!graph) return;
        const stepped = redo(history, graph);
        if (!stepped) return;
        setHistory(stepped.history);
        setGraph(stepped.graph);
    }, [graph, history]);

    const isDirty = !!graph && JSON.stringify(graph) !== savedGraph.current;

    /**
     * Release the flow.
     *
     * Saves first: publishing sends the graph, and a publish that skipped the
     * save would leave the row and the released version disagreeing about what
     * the draft was.
     */
    async function publish() {
        if (!flow || !graph || !context) return;
        setIsPublishing(true);
        setNotice(null);
        try {
            await api.publishFlow(flow.id, graph, context);
            await refresh();
            savedGraph.current = JSON.stringify(graph);
        } catch (cause) {
            setNotice(cause instanceof ApiError ? cause.message : String(cause));
        } finally {
            setIsPublishing(false);
        }
    }

    async function save() {
        if (!flow || !graph) return;
        setIsSaving(true);
        const saved = await update(flow.id, { graph } as Partial<Flow>);
        if (saved) savedGraph.current = JSON.stringify(graph);
        setIsSaving(false);
    }

    if (error) {
        return (
            <div className="grid h-dvh place-items-center p-8">
                <p className="text-sm text-tertiary">{error.message}</p>
            </div>
        );
    }

    const inspected = graph?.nodes.find((node) => node.id === selectedNode) ?? null;
    const inspectedTransition = graph?.transitions.find((t) => t.id === selectedTransition) ?? null;

    return (
        <div className="flex h-dvh flex-col">
            <ScreenHeader
                title={flow?.name ?? "Composer"}
                description={flow?.description ?? "What happens when one of your numbers is called."}
                actions={
                    <>
                        {problems.length > 0 && (
                            <Badge size="sm" type="pill-color" color="warning">
                                {problems.length === 1 ? "1 thing to fix" : `${problems.length} things to fix`}
                            </Badge>
                        )}
                        {isDirty && (
                            <Badge size="sm" type="pill-color" color="warning">
                                Unsaved
                            </Badge>
                        )}
                        <Button
                            size="sm"
                            color="tertiary"
                            iconLeading={ArrowNarrowLeft}
                            aria-label="Undo"
                            isDisabled={!canUndo(history)}
                            onClick={undoChange}
                        />
                        <Button
                            size="sm"
                            color="tertiary"
                            iconLeading={ArrowNarrowRight}
                            aria-label="Redo"
                            isDisabled={!canRedo(history)}
                            onClick={redoChange}
                        />
                        <Button size="sm" color="secondary" isDisabled={!isDirty} isLoading={isSaving} showTextWhileLoading onClick={save}>
                            Save
                        </Button>
                        <Tooltip
                            title={
                                problems.length
                                    ? `${problems.length === 1 ? "One thing" : `${problems.length} things`} must be fixed first`
                                    : "Release this flow to callers"
                            }
                        >
                            <Button
                                size="sm"
                                isDisabled={problems.length > 0}
                                isLoading={isPublishing}
                                showTextWhileLoading
                                onClick={publish}
                            >
                                Publish
                            </Button>
                        </Tooltip>
                    </>
                }
            />

            <div className="flex min-h-0 flex-1">
                {/* Palette. Read from the registry, so a carrier action added as
                    a row appears here without a release. */}
                <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-secondary lg:flex">
                    {["condition", "loop", "var", "code", "custom"].map((primitive) => {
                        const entries = catalogue.nodeTypes.filter((entry) => entry.node_type === primitive);
                        if (!entries.length) return null;
                        return (
                            <div key={primitive} className="border-b border-secondary py-3">
                                <p className="px-4 pb-1.5 text-[10px] tracking-wide text-quaternary uppercase">
                                    {primitive === "custom" ? "Actions" : primitive}
                                </p>
                                {entries.map((entry) => (
                                    <button
                                        key={entry.id}
                                        onClick={() => placeNode(entry.id)}
                                        title={entry.description}
                                        className="block w-full px-4 py-1.5 text-left text-[13px] text-secondary transition duration-100 ease-linear hover:bg-primary_hover hover:text-primary"
                                    >
                                        {entry.label}
                                    </button>
                                ))}
                            </div>
                        );
                    })}
                </aside>

                <div className="min-w-0 flex-1">
                    {isLoading || isCatalogueLoading || !catalogue.nodeTypes.length ? (
                        <div className="grid h-full place-items-center">
                            <p className="text-sm text-tertiary">Loading…</p>
                        </div>
                    ) : !graph?.nodes.length ? (
                        <div className="grid h-full place-items-center p-8 text-center">
                            <div className="max-w-md">
                                <p className="text-sm font-medium text-primary">Nothing here yet</p>
                                <p className="mt-1 text-sm text-tertiary">
                                    A flow is what happens when one of your numbers rings. Add a node from the left to begin —
                                    the first one you place is the one that answers.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <FlowCanvas
                            key={flow?.id}
                            graph={graph}
                            definitions={definitions}
                            initialNodes={canvasNodes}
                            onNodeDragStop={onNodeDragStop}
                            onConnect={onConnect}
                            onSelect={(id) => {
                                setSelectedNode(id);
                                setSelectedTransition(null);
                            }}
                            selectedNode={selectedNode}
                            selectedTransition={selectedTransition}
                            onSelectTransition={(id) => {
                                setSelectedTransition(id);
                                setSelectedNode(null);
                            }}
                        />
                    )}
                </div>

                <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-secondary p-5 lg:block">
                    {notice && (
                        <p className="mb-4 border border-warning bg-warning-primary px-3 py-2 text-sm text-primary" role="alert">
                            {notice}
                        </p>
                    )}
                    {inspectedTransition ? (
                        <TransitionInspector
                            transition={inspectedTransition}
                            graph={graph}
                            definitions={definitions}
                            onDelete={() => {
                                if (!graph) return;
                                apply(deleteTransition(graph, inspectedTransition.id), "structural", "");
                                setSelectedTransition(null);
                            }}
                        />
                    ) : inspected ? (
                        <FlowNodeForm
                            node={inspected}
                            definition={definitions.get(inspected.implementation) ?? null}
                            agents={agents}
                            isStart={graph?.start === inspected.id}
                            onChange={(changes) => editNode(inspected.id, changes)}
                            onRename={(name) => graph && apply(renameNode(graph, inspected.id, name), "rename", inspected.id)}
                            onDelete={() => removeNode(inspected.id)}
                            onMakeStart={() => graph && apply(setStartNode(graph, inspected.id), "structural", "")}
                        />
                    ) : (
                        <FlowSummary graph={graph} problems={problems} />
                    )}
                </aside>
            </div>
        </div>
    );
}

/**
 * The canvas, mounted only once its nodes and transitions are both ready.
 *
 * React Flow reconciles the `edges` prop against the nodes it currently knows
 * about and discards any edge naming a node it does not have. Mounted with an
 * empty node list — which is what a `useNodesState([])` filled by an effect
 * gives you — every transition is discarded on that first pass, and the prop
 * never afterwards differs enough to force another. Eleven valid transitions
 * reached the canvas and none were drawn; adding a twelfth made all twelve
 * appear, which is what pointed at reconciliation rather than at the data.
 *
 * Mounting with both already populated removes the window in which that can
 * happen. `key` on the flow forces a fresh mount when the flow changes, so a
 * second flow never inherits the first one's store.
 */
function FlowCanvas({
    graph,
    definitions,
    initialNodes,
    onNodeDragStop,
    onConnect,
    onSelect,
    selectedNode,
    selectedTransition,
    onSelectTransition,
}: {
    graph: FlowGraph;
    definitions: Map<string, CatalogueNodeType>;
    initialNodes: Node<FlowNodeData>[];
    onNodeDragStop: (event: unknown, node: Node) => void;
    onConnect: (connection: Connection) => void;
    onSelect: (id: string | null) => void;
    selectedNode: string | null;
    selectedTransition: string | null;
    onSelectTransition: (id: string) => void;
}) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(initialNodes);

    // Labels, warnings and dangling outcomes still have to reach the canvas, but
    // position belongs to React Flow while a drag is in flight.
    useEffect(() => {
        setNodes((current) =>
            initialNodes.map((node) => {
                const live = current.find((candidate) => candidate.id === node.id);
                return live ? { ...node, position: live.position } : node;
            }),
        );
    }, [initialNodes, setNodes]);

    // Live positions, so a line follows its node mid-drag rather than snapping
    // to the stored position when the drag ends.
    const positions = new Map(nodes.map((node) => [node.id, node.position]));

    return (
        <ReactFlow
            nodes={nodes}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onNodeClick={(_, node) => onSelect(node.id)}
            onPaneClick={() => onSelect(null)}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.3}
            proOptions={{ hideAttribution: true }}
            className="bg-secondary"
        >
            <Background gap={20} size={1} className="text-border-secondary" />
            <Controls showInteractive={false} className="!border !border-secondary !bg-primary !shadow-none" />
            <FlowCanvasEdges
                graph={graph}
                definitions={definitions}
                positions={positions}
                highlightNode={selectedNode}
                selectedTransition={selectedTransition}
                onSelect={onSelectTransition}
            />
        </ReactFlow>
    );
}

function TransitionInspector({
    transition,
    graph,
    definitions,
    onDelete,
}: {
    transition: FlowTransition;
    graph: FlowGraph | null;
    definitions: Map<string, CatalogueNodeType>;
    onDelete: () => void;
}) {
    const from = graph?.nodes.find((node) => node.id === transition.from);
    const to = graph?.nodes.find((node) => node.id === transition.to);
    const outcome = from ? definitions.get(from.implementation)?.outcomes.find((o) => o.id === transition.outcome) : null;

    return (
        <div className="flex flex-col gap-5">
            <div>
                <p className="text-xs tracking-wide text-tertiary uppercase">Transition</p>
                <p className="mt-1.5 text-sm text-tertiary">
                    Where the call goes when <span className="text-primary">{from?.name}</span> finishes as{" "}
                    <span className="text-primary">{outcome?.label ?? transition.outcome}</span>.
                </p>
            </div>

            <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-3">
                    <dt className="text-tertiary">From</dt>
                    <dd className="text-right text-primary">{from?.name ?? transition.from}</dd>
                </div>
                <div className="flex justify-between gap-3">
                    <dt className="text-tertiary">Outcome</dt>
                    <dd className="text-right font-mono text-xs text-primary">{transition.outcome}</dd>
                </div>
                <div className="flex justify-between gap-3">
                    <dt className="text-tertiary">To</dt>
                    <dd className="text-right text-primary">{to?.name ?? transition.to}</dd>
                </div>
            </dl>

            {/* The outcome is not editable. It is a contract declared by the
                source node's type; a different outcome is a different line. */}
            <p className="text-xs text-tertiary">
                To send this outcome somewhere else, drag a new line from it — one outcome leads to one node, so the new line
                replaces this one.
            </p>

            <div className="border-t border-secondary pt-4">
                <Button size="sm" color="tertiary-destructive" iconLeading={Trash01} onClick={onDelete}>
                    Delete transition
                </Button>
            </div>
        </div>
    );
}

function FlowSummary({ graph, problems }: { graph: FlowGraph | null; problems: { message: string }[] }) {
    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-sm font-semibold text-primary">This flow</h2>
                <p className="mt-1 text-sm text-tertiary">
                    Select a node to see how it is configured. Drag from an outcome on the right of a node to connect it.
                </p>
            </div>

            {graph && (
                <dl className="flex flex-col gap-2 text-sm">
                    <div className="flex justify-between">
                        <dt className="text-tertiary">Nodes</dt>
                        <dd className="text-primary">{graph.nodes.length}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-tertiary">Transitions</dt>
                        <dd className="text-primary">{graph.transitions.length}</dd>
                    </div>
                </dl>
            )}

            {problems.length > 0 && (
                <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold tracking-wide text-tertiary uppercase">To fix</h3>
                    <ul className="flex flex-col gap-2">
                        {problems.map((problem) => (
                            <li key={problem.message} className="flex items-start gap-2 text-sm text-tertiary">
                                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-fg-warning-primary" />
                                {problem.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Said plainly rather than left to be discovered on a call. */}
            <p className="border border-secondary bg-secondary px-3 py-2 text-xs text-tertiary">
                Flows are drawn and saved here. The telephony bridge does not execute them yet — a call still goes straight to the
                agent the number is pointed at.
            </p>
        </div>
    );
}

function NodeInspector({
    node,
    definition,
    records,
}: {
    node: FlowNode;
    definition: { label: string; description: string; fields: { key: string; label: string }[] } | null;
    records: Flow[];
}) {
    return (
        <div className="flex flex-col gap-5">
            <div>
                <p className="text-xs tracking-wide text-tertiary uppercase">{definition?.label ?? node.implementation}</p>
                <h2 className="mt-1 text-sm font-semibold text-primary">{node.name}</h2>
                {definition?.description && <p className="mt-1 text-sm text-tertiary">{definition.description}</p>}
            </div>

            <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-tertiary uppercase">Settings</h3>
                {(definition?.fields ?? []).length === 0 ? (
                    <p className="text-sm text-tertiary">Nothing to configure.</p>
                ) : (
                    <dl className="flex flex-col gap-2 text-sm">
                        {definition!.fields.map((field) => (
                            <div key={field.key} className="flex justify-between gap-3">
                                <dt className="shrink-0 text-tertiary">{field.label}</dt>
                                <dd className="truncate text-right font-mono text-xs text-primary">
                                    {formatValue(node.config[field.key])}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>

            <p className="text-xs text-tertiary">
                Editing a node&apos;s settings is not built yet. The values above are what the flow will run with.
            </p>
        </div>
    );
}

function formatValue(value: unknown): string {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "boolean") return value ? "on" : "off";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

/** A second line naming what the step will actually do. */
function subtitleFor(node: FlowNode, fallback: string | null, flows: Flow[]): string | null {
    const config = node.config ?? {};
    if (typeof config.phoneno === "string") return config.phoneno;
    if (typeof config.reason === "string") return `reason: ${config.reason}`;
    if (typeof config.opens === "string" && typeof config.closes === "string") return `${config.opens}–${config.closes}`;
    if (typeof config.agent_id === "string") return "agent";
    return fallback;
}

