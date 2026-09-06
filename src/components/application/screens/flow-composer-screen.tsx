"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

import "@/recovered-editor/styles.css";

import { diagramToFlowGraph, flowToDiagram } from "@/lib/flow-diagram";
import { familyOf, type Diagram } from "@/lib/architecture-model";
import { api } from "@/utils/api-client";
import type { Flow, FlowGraph } from "@/utils/flow-graph";
import { callFactsFrom } from "@/components/stackplane/recovered-editor-host";
import type { DryRunStep, Referenceable, SampleCall } from "@/components/stackplane/recovered-editor-host";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { previewLegacyIntegrationMigration, type IntegrationMigrationPreview } from "@/lib/integration-migration";

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
    const notify = useNotify();
    const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
    // Named shapes an intelligence node can fill in. Fetched beside the agents
    // for the same reason: the canvas has no API of its own.
    const [shapes, setShapes] = useState<Referenceable[]>([]);
    const [integrations, setIntegrations] = useState<Referenceable[]>([]);
    // A finished call, so the expression panel can show real values rather than
    // only field names. Whether the path you picked is the one you meant is a
    // question about a value.
    const [sampleCall, setSampleCall] = useState<SampleCall | undefined>(undefined);
    // Which providers this organisation has a key for. A webhook node names one
    // rather than carrying a secret, so the picker needs the list — the engine
    // board had been fetching this and the flow board had not, which is why a
    // credential was a text box here and a dropdown there.
    const [connectedVendors, setConnectedVendors] = useState<string[]>([]);
    const [diagram, setDiagram] = useState<Diagram | null>(null);
    const [error, setError] = useState<string | null>(null);
    // The graph as stored, kept so a save preserves what the canvas cannot
    // express — the start node, the declared variables, the version.
    const [stored, setStored] = useState<FlowGraph | null>(null);
    const [allFlows, setAllFlows] = useState<Flow[]>([]);
    const [migrationOpen, setMigrationOpen] = useState(false);
    const [migrationCallId, setMigrationCallId] = useState("");
    const [migrationPreview, setMigrationPreview] = useState<IntegrationMigrationPreview | null>(null);
    const [migrationSaving, setMigrationSaving] = useState(false);

    useEffect(() => {
        if (!isReady || !context) return;
        let cancelled = false;
        (async () => {
            try {
                const { data } = await api.get<Flow>("flows", flowId, context);
                // The canvas has no API of its own, so the records a node can
                // name are fetched here and handed in.
                api.list<{ id: string; name: string }>("agents", context)
                    .then((response) => setAgents(response.data ?? []))
                    .catch(() => setAgents([]));
                api.list<Flow>("flows", context)
                    .then((response) => {
                        setAllFlows(response.data ?? []);
                        setIntegrations((response.data ?? [])
                            .filter((row) => row.family === "integration" && row.status === "published" && row.id !== flowId)
                            .map((row) => ({ id: row.id, name: row.name })));
                    })
                    .catch(() => { setIntegrations([]); setAllFlows([]); });
                // The rows already carry their compiled schema — the list
                // selects `*` — so the property names come at no extra request.
                api.list<{ id: string; name: string; schema?: { properties?: Record<string, unknown> } }>(
                    "structured-outputs",
                    context,
                )
                    .then((response) =>
                        setShapes(
                            (response.data ?? []).map((row) => ({
                                id: row.id,
                                name: row.name,
                                fields: Object.keys(row.schema?.properties ?? {}),
                            })),
                        ),
                    )
                    .catch(() => setShapes([]));
                api.list<{ analysis?: Record<string, unknown> } & Record<string, unknown>>("call-logs", context)
                    .then((response) => {
                        const rows = response.data ?? [];
                        // The most recent call that has actually been read.
                        // One that never reached an intelligence node would
                        // show the panel a set of empty values, which is worse
                        // than showing names alone.
                        const read = rows.find((row) => row.analysis && Object.keys(row.analysis).length > 0);
                        const row = read ?? rows[0];
                        // Through the same mapping the bridge applies, so the
                        // panel offers names a flow can actually resolve.
                        // Through the same mapping the bridge applies, so the
                        // panel offers names a flow can actually resolve.
                        if (row) {
                            setSampleCall({
                                call: callFactsFrom(row),
                                analysis: row.analysis,
                                ucid: typeof row.provider_call_id === "string" ? row.provider_call_id : undefined,
                                // Read as a sentence, not a row: "the one from
                                // +91… on 1 Sep". A bare number beside a
                                // timestamp reads as configuration.
                                label: [
                                    typeof row.from_number === "string" ? row.from_number : null,
                                    typeof row.started_at === "string"
                                        ? new Date(row.started_at).toLocaleString(undefined, {
                                              day: "numeric",
                                              month: "short",
                                              hour: "2-digit",
                                              minute: "2-digit",
                                          })
                                        : null,
                                ]
                                    .filter(Boolean)
                                    .join(", "),
                            });
                        }
                    })
                    .catch(() => setSampleCall(undefined));
                api.vendorKeys<{ vendor: string }>(context)
                    .then((response) => setConnectedVendors((response.data ?? []).map((row) => row.vendor)))
                    .catch(() => setConnectedVendors([]));
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

    /**
     * Release the flow.
     *
     * `publish_flow` writes the graph, sets the status and validates what it
     * just wrote — so a refusal rolls back and the live flow is untouched.
     * Returns the problem to show, or null when it worked.
     */
    const publish = async (edited: Diagram): Promise<string | null> => {
        if (!context) return "Not signed in.";
        try {
            const graph = diagramToFlowGraph(edited, stored);
            await api.publishFlow(flowId, graph, context);
            // Published is also saved: the same graph is now what is stored.
            setStored(graph);
            return null;
        } catch (error) {
            return (error as Error).message;
        }
    };

    const legacyIntegration = familyOf(diagram) === "integration"
        && Boolean(stored?.nodes.some((node) => node.implementation === "trigger.call_ended"))
        && Boolean(stored?.nodes.some((node) => node.implementation === "intelligence"));
    const callFlows = allFlows.filter((flow) => flow.family === "call" && flow.graph);
    const buildMigrationPreview = () => {
        const call = callFlows.find((candidate) => candidate.id === migrationCallId);
        if (!stored || !call?.graph) return;
        try { setMigrationPreview(previewLegacyIntegrationMigration(stored, call.graph, flowId)); }
        catch (problem) { notify.failure("Could not preview the migration", problem); }
    };
    const applyMigration = async () => {
        if (!context || !migrationPreview || !migrationCallId) return;
        setMigrationSaving(true);
        try {
            await api.update("flows", migrationCallId, { graph: migrationPreview.call }, context);
            await api.update("flows", flowId, { graph: migrationPreview.integration }, context);
            setStored(migrationPreview.integration);
            setDiagram(flowToDiagram({ id: flowId, name: diagram.name, description: diagram.description,
                status: "draft", family: "integration", graph: migrationPreview.integration }));
            setMigrationOpen(false);
            setMigrationPreview(null);
            notify.success("Migration applied to both drafts. Review and publish each flow when ready.");
        } catch (problem) { notify.failure("Could not apply the migration", problem); }
        finally { setMigrationSaving(false); }
    };

    return (
        <>
        <RecoveredEditorHost
            diagram={diagram}
            onSave={save}
            onPublish={publish}
            agents={agents}
            connectedVendors={connectedVendors}
            // All flow families share this screen. Integrations and care paths
            // carry runtime scope, so fields on those boards may use outputs
            // produced by earlier nodes.
            board={diagram && familyOf(diagram) === "integration"
                ? "integration"
                : diagram && familyOf(diagram) === "care_path"
                  ? "care_path"
                  : "call"}
            sampleCall={sampleCall}
            onDryRun={
                diagram && familyOf(diagram) === "call" && sampleCall?.ucid && context
                    ? async () => {
                          const { data } = await api.dryRunFlow<{ ok: boolean; error?: string; steps?: DryRunStep[] }>(
                              flowId,
                              sampleCall.ucid!,
                              context,
                          );
                          if (!data.ok) throw new Error(data.error ?? "the flow could not be walked");
                          return data.steps ?? [];
                      }
                    : undefined
            }
            shapes={shapes}
            integrations={integrations}
            toolbarSlot={legacyIntegration ? <button type="button" onClick={() => setMigrationOpen(true)}>Migrate legacy CRM flow</button> : undefined}
            // Back to the board this flow belongs to. Sending an integration
            // to the calls list would look like it had been filtered out.
            backHref={familyOf(diagram) === "integration"
                ? "/integrations"
                : familyOf(diagram) === "care_path"
                  ? "/care-paths"
                  : "/composer"}
        />
        <ModalOverlay isOpen={migrationOpen} onOpenChange={(open) => !open && setMigrationOpen(false)} isDismissable={!migrationSaving}>
            <Modal className="max-w-2xl"><Dialog><div className="flex flex-col gap-5 rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                <div><h2 className="text-lg font-semibold text-primary">Separate call extraction from this integration</h2>
                    <p className="mt-1 text-sm text-tertiary">Preview both draft changes. Nothing is published automatically.</p></div>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-secondary">Call flow
                    <select className="rounded-lg bg-primary px-3 py-2.5 text-primary ring-1 ring-primary" value={migrationCallId}
                        onChange={(event) => { setMigrationCallId(event.target.value); setMigrationPreview(null); }}>
                        <option value="">Choose the call flow that should invoke this integration</option>
                        {callFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
                    </select>
                </label>
                {migrationPreview ? <div className="grid gap-4 rounded-lg bg-secondary p-4 md:grid-cols-2">
                    <div><p className="text-sm font-semibold text-primary">Integration draft</p><p className="mt-1 text-sm text-tertiary">Remove: {migrationPreview.removedFromIntegration.join(", ")}. Add Integration invoked trigger.</p></div>
                    <div><p className="text-sm font-semibold text-primary">Call-flow draft</p><p className="mt-1 text-sm text-tertiary">Add: {migrationPreview.addedToCall.join(", ")}.</p></div>
                </div> : null}
                <div className="flex justify-end gap-2">
                    <Button color="secondary" size="sm" onClick={() => setMigrationOpen(false)} isDisabled={migrationSaving}>Cancel</Button>
                    {!migrationPreview ? <Button size="sm" onClick={buildMigrationPreview} isDisabled={!migrationCallId}>Preview changes</Button>
                        : <Button size="sm" onClick={applyMigration} isLoading={migrationSaving}>Apply to both drafts</Button>}
                </div>
            </div></Dialog></Modal>
        </ModalOverlay>
        </>
    );
}
