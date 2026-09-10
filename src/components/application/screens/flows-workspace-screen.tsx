"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { SearchLg } from "@/components/icons";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";
import { useResource } from "@/hooks/use-resource";
import type { Flow } from "@/utils/flow-graph";
import { readGraph } from "@/utils/flow-graph";
import { dateTime } from "@/utils/format";
import { IntegrationActivity } from "@/components/application/screens/integration-activity";
import { CARE_PATH_WORKSPACE } from "@/lib/care-path-workspace";

type PhoneNumber = {
    id: string;
    number: string;
    /** The real binding. `phone_numbers.flow_id` is a legacy pointer the bridge
     *  only falls back to, and reading it said "No number points here" about a
     *  flow that was answering calls. */
    number_flows?: { trigger_event: string; flows?: { id?: string } | null }[];
};

/** What this board is for. The families differ in more than a filter. */
type Family = "call" | "post_call" | "care_path";

const FAMILIES = {
    call: {
        family: "call",
        trigger_event: "call.answered",
        trigger: "trigger.call_answered",
        triggerName: "Call answered",
        noun: "call flow",
        empty: "Create a call flow to handle incoming calls.",
    },
    post_call: {
        family: "integration",
        trigger_event: "integration.invoked",
        trigger: "trigger.integration_invoked",
        triggerName: "Integration invoked",
        noun: "integration",
        empty: "Create an integration workflow.",
    },
    care_path: CARE_PATH_WORKSPACE,
} as const satisfies Record<Family, unknown>;

/**
 * The flows in this workspace, as cards.
 *
 * Opening one is a place you go: the card is the way in, and the canvas takes
 * the whole window once you are there. A table would carry the same fields and
 * none of the shape — what a reader wants from this screen is which flow, and
 * flows are few and named rather than many and queried.
 */
export function FlowsWorkspaceScreen({ family }: { family: Family }) {
    const kind = FAMILIES[family];
    const router = useRouter();
    const { records, isLoading, error } = useResource<Flow>("flows");
    // The number a flow answers is the most useful thing on the card: a flow no
    // number points at is inert, however finished it looks.
    const { records: numbers } = useResource<PhoneNumber>("phone-numbers");
    const [query, setQuery] = useState("");
    const [creating, setCreating] = useState(false);

    const numberFor = useMemo(() => {
        const byFlow = new Map<string, string>();
        for (const number of numbers) {
            for (const binding of number.number_flows ?? []) {
                if (binding.trigger_event === "call.answered" && binding.flows?.id) {
                    byFlow.set(binding.flows.id, number.number);
                }
            }
        }
        return byFlow;
    }, [numbers]);

    const filtered = useMemo(() => {
        // One table, two boards. A flow that responds to something else is not
        // hidden by a filter somebody can clear — it belongs on the other
        // board, where its palette is.
        const mine = records.filter((flow) => flow.family === kind.family);
        const needle = query.trim().toLowerCase();
        if (!needle) return mine;
        return mine.filter((flow) => `${flow.name} ${flow.description ?? ""}`.toLowerCase().includes(needle));
    }, [records, query, kind.family]);

    return (
        <>
            <ScreenHeader
                title={family === "call" ? "Calls" : family === "post_call" ? "Integrations" : "Care Paths"}
                search={
                    <div className="w-full md:w-64">
                        <Input
                            icon={SearchLg}
                            placeholder={`Search ${kind.noun}s`}
                            value={query}
                            onChange={(value) => setQuery(String(value))}
                            aria-label={`Search ${kind.noun}s`}
                        />
                    </div>
                }
                actions={
                    <Button size="sm" onClick={() => setCreating(true)}>
                        {family === "call" ? "New call flow" : family === "post_call" ? "New integration" : "New care path"}
                    </Button>
                }
            />

            <NewFlowDialog kind={kind} isOpen={creating} onClose={() => setCreating(false)} />

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {family === "post_call" ? <div className="mb-6"><IntegrationActivity /></div> : null}
                {error ? (
                    <div className="rounded-xl bg-error-primary p-6 ring-1 ring-error_subtle">
                        <p className="text-sm font-semibold text-error-primary">Could not load flows</p>
                        <p className="mt-1 text-sm text-error-primary">{error.message}</p>
                    </div>
                ) : isLoading ? (
                    <p className="text-sm text-tertiary">Loading…</p>
                ) : filtered.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-secondary p-12 text-center">
                        <p className="text-sm font-medium text-primary">
                            {filtered.length === 0 && !query ? `No ${kind.noun}s yet` : `No ${kind.noun}s match that`}
                        </p>
                        <p className="mx-auto mt-1 max-w-md text-sm text-tertiary">
                            {kind.empty}
                        </p>
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {filtered.map((flow) => {
                            const graph = readGraph(flow);
                            const number = numberFor.get(flow.id);
                            return (
                                <li key={flow.id}>
                                    <button
                                        type="button"
                                        onClick={() => router.push(`/flows/${flow.id}`)}
                                        className="flex h-full w-full flex-col gap-3 rounded-xl bg-primary p-5 text-left ring-1 ring-secondary transition hover:ring-brand"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="text-sm font-semibold text-primary">{flow.name}</p>
                                            <Badge
                                                size="sm"
                                                type="pill-color"
                                                color={flow.status === "published" ? "success" : "gray"}
                                            >
                                                {flow.status}
                                            </Badge>
                                        </div>

                                        {flow.description && (
                                            <p className="line-clamp-2 text-sm text-tertiary">{flow.description}</p>
                                        )}

                                        <p className="mt-auto text-xs text-quaternary">
                                            {graph.nodes.length} {graph.nodes.length === 1 ? "node" : "nodes"} ·{" "}
                                            {graph.transitions.length}{" "}
                                            {graph.transitions.length === 1 ? "route" : "routes"}
                                        </p>

                                        <p className="text-xs text-tertiary">
                                            {family === "call"
                                                ? number
                                                    ? `Answers ${number}`
                                                    : "No number points here"
                                                : family === "post_call"
                                                  ? "Invoked from another flow"
                                                  : `${graph.nodes.filter((node) => node.implementation.startsWith("trigger.")).length} explicit triggers`}
                                        </p>

                                        {flow.updated_at && (
                                            <p className="text-xs text-quaternary">Edited {dateTime(flow.updated_at)}</p>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </>
    );
}

/**
 * A new flow. It asks for a name and nothing else.
 *
 * The board fixes the capability family and initial compatibility trigger.
 */
function NewFlowDialog({
    kind,
    isOpen,
    onClose,
}: {
    kind: (typeof FAMILIES)[Family];
    isOpen: boolean;
    onClose: () => void;
}) {
    const { context } = useSession();
    const notify = useNotify();
    const router = useRouter();

    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const [schemaId, setSchemaId] = useState("");
    const { records: schemas } = useResource<{ id: string; name: string }>("structured-outputs");
    const isIntegration = kind.family === "integration";
    const isCarePath = kind.family === "care_path";

    const create = async () => {
        if (!context || !name.trim()) return;
        setSaving(true);
        try {
            const { data } = await api.create<{ id: string }>(
                "flows",
                {
                    name: name.trim(),
                    description: "",
                    status: "draft",
                    family: kind.family,
                    trigger_event: kind.trigger_event,
                    // The trigger and nothing else. A starter full of nodes
                    // somebody did not ask for is a graph they must read before
                    // they can begin, and the palette is the better teacher now
                    // that it only offers what belongs here.
                    graph: {
                        version: 3,
                        variables: [],
                        nodes: [
                            {
                                id: "trigger",
                                name: kind.triggerName,
                                type: "trigger",
                                implementation: kind.trigger,
                                config: isIntegration ? { input_schema_id: schemaId } : isCarePath ? kind.triggerConfig : {},
                                position: { x: -420, y: 0 },
                            },
                        ],
                        transitions: [],
                    },
                },
                context,
            );
            onClose();
            setName("");
            setSchemaId("");
            router.push(`/flows/${data.id}`);
        } catch (problem) {
            notify.failure(`Could not create the ${kind.noun}`, problem);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalOverlay isOpen={isOpen} onOpenChange={(next) => !next && onClose()} isDismissable={!saving}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col gap-5 rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-lg font-semibold text-primary">
                                {kind.family === "call" ? "New call flow" : isIntegration ? "New integration" : "New care path"}
                            </h2>
                            <p className="text-sm text-tertiary">{kind.empty}</p>
                        </div>

                        <Input
                            label="Name"
                            placeholder={kind.family === "call" ? "Vayuveda main line" : isIntegration ? "Lead capture" : "Antenatal care"}
                            value={name}
                            onChange={(value) => setName(String(value))}
                            isRequired
                        />

                        {isIntegration ? (
                            <label className="flex flex-col gap-1.5 text-sm font-medium text-secondary">
                                Input schema *
                                <select className="rounded-lg bg-primary px-3 py-2.5 text-primary ring-1 ring-primary"
                                    value={schemaId} onChange={(event) => setSchemaId(event.target.value)}>
                                    <option value="">{schemas.length === 0 ? "No schemas available" : "Choose a schema"}</option>
                                    {schemas.map((schema) => <option key={schema.id} value={schema.id}>{schema.name}</option>)}
                                </select>
                            </label>
                        ) : null}

                        <div className="flex justify-end gap-2">
                            <Button color="secondary" size="sm" onClick={onClose} isDisabled={saving}>
                                Cancel
                            </Button>
                            <Button size="sm" onClick={create} isDisabled={!name.trim() || (isIntegration && !schemaId)} isLoading={saving}>
                                Create
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
