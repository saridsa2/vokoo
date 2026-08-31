"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

import "@/recovered-editor/styles.css";

import { diagramToFlowGraph, flowToDiagram } from "@/lib/flow-diagram";
import type { Diagram } from "@/lib/architecture-model";
import { api } from "@/utils/api-client";
import type { Flow, FlowGraph } from "@/utils/flow-graph";
import { useSession } from "@/hooks/use-session";

/**
 * The canvas, over a real flow.
 *
 * Loaded rather than bundled: the editor pulls in the whole board, and this
 * screen is reached only when someone opens a flow.
 */
const RecoveredEditorHost = dynamic(
    () => import("@/components/stackplane/recovered-editor-host").then((module) => module.RecoveredEditorHost),
    { ssr: false },
);

/**
 * Fetches a flow, hands the canvas a diagram, and writes what comes back.
 *
 * The editor knows nothing about the API or about transitions — it edits a
 * diagram. Everything that makes a diagram a flow the bridge can run lives in
 * `@/lib/flow-diagram`, which is also where the round trip is proven.
 */
export function FlowComposerScreen({ flowId }: { flowId: string }) {
    const { context, isReady } = useSession();
    const [diagram, setDiagram] = useState<Diagram | null>(null);
    const [error, setError] = useState<string | null>(null);
    // The graph as stored, kept so a save preserves what the canvas cannot
    // express — the start node, the declared variables, the version.
    const [stored, setStored] = useState<FlowGraph | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let cancelled = false;
        (async () => {
            try {
                const { data } = await api.get<Flow>("flows", flowId, context);
                if (cancelled) return;
                setStored(data.graph ?? null);
                setDiagram(flowToDiagram(data));
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [flowId, context, isReady]);

    const save = useCallback(
        async (edited: Diagram) => {
            if (!context) return false;
            try {
                const graph = diagramToFlowGraph(edited, stored);
                await api.update("flows", flowId, { name: edited.name, graph }, context);
                // What was just written is now what is stored, so the next save
                // carries forward from it rather than from what loaded.
                setStored(graph);
                return true;
            } catch {
                return false;
            }
        },
        [flowId, context, stored],
    );

    if (error) {
        return (
            <div className="grid h-full place-items-center p-8">
                <div className="max-w-md text-center">
                    <p className="text-sm font-medium text-primary">Could not open this flow</p>
                    <p className="mt-1 text-sm text-tertiary">{error}</p>
                </div>
            </div>
        );
    }

    if (!diagram) {
        return (
            <div className="grid h-full place-items-center p-8">
                <p className="text-sm text-tertiary">Loading flow…</p>
            </div>
        );
    }

    return <RecoveredEditorHost diagram={diagram} onSave={save} />;
}
