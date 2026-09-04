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

type PhoneNumber = {
    id: string;
    number: string;
    /** The real binding. `phone_numbers.flow_id` is a legacy pointer the bridge
     *  only falls back to, and reading it said "No number points here" about a
     *  flow that was answering calls. */
    number_flows?: { trigger_event: string; flows?: { id?: string } | null }[];
};

/** What this board is for. The two differ in more than a filter. */
type Family = "call" | "post_call";

const FAMILIES = {
    call: {
        trigger_event: "call.answered",
        trigger: "trigger.call_answered",
        triggerName: "Call answered",
        noun: "call flow",
        empty: "A call flow decides what happens when a number rings — which questions are asked, when the caller reaches a person, and how the call ends.",
    },
    post_call: {
        trigger_event: "call.ended",
        trigger: "trigger.call_ended",
        triggerName: "Call ended",
        noun: "integration",
        empty: "An integration runs once a call is over: read what was said into a shape, and send it to another system. Nobody is waiting, so it can take its time.",
    },
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
                if (binding.flows?.id) byFlow.set(binding.flows.id, number.number);
            }
        }
        return byFlow;
    }, [numbers]);

    const filtered = useMemo(() => {
        // One table, two boards. A flow that responds to something else is not
        // hidden by a filter somebody can clear — it belongs on the other
        // board, where its palette is.
        const mine = records.filter((flow) => (flow.trigger_event ?? "call.answered") === kind.trigger_event);
        const needle = query.trim().toLowerCase();
        if (!needle) return mine;
        return mine.filter((flow) => `${flow.name} ${flow.description ?? ""}`.toLowerCase().includes(needle));
    }, [records, query, kind.trigger_event]);

    return (
        <>
            <ScreenHeader
                title={family === "call" ? "Calls" : "Integrations"}
                description={
                    family === "call"
                        ? "What happens while somebody is on the line."
                        : "What happens after a call ends."
                }
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
                        {family === "call" ? "New call flow" : "New integration"}
                    </Button>
                }
            />

            <NewFlowDialog kind={kind} isOpen={creating} onClose={() => setCreating(false)} />

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
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
                                            {/* A flow nothing dials never runs, however complete it looks. */}
                                            {number ? `Answers ${number}` : "No number points here"}
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
 * **When it runs is not a question here** — it is answered by which board you
 * opened, and that answer settles three things at once: the trigger node the
 * graph opens with, the nodes the palette may offer, and the
 * `number_flows(phone_number_id, trigger_event)` row that binds it. A dialog
 * asking again would let somebody create an integration from the calls board
 * and then wonder why the palette refuses a transfer.
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
                    trigger_event: kind.trigger_event,
                    // The trigger and nothing else. A starter full of nodes
                    // somebody did not ask for is a graph they must read before
                    // they can begin, and the palette is the better teacher now
                    // that it only offers what belongs here.
                    graph: {
                        version: 2,
                        start: "trigger",
                        variables: [],
                        nodes: [
                            {
                                id: "trigger",
                                name: kind.triggerName,
                                type: "trigger",
                                implementation: kind.trigger,
                                config: {},
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
                                {kind.trigger_event === "call.answered" ? "New call flow" : "New integration"}
                            </h2>
                            <p className="text-sm text-tertiary">{kind.empty}</p>
                        </div>

                        <Input
                            label="Name"
                            placeholder={kind.trigger_event === "call.answered" ? "Vayuveda main line" : "Lead capture"}
                            value={name}
                            onChange={(value) => setName(String(value))}
                            isRequired
                        />

                        <div className="flex justify-end gap-2">
                            <Button color="secondary" size="sm" onClick={onClose} isDisabled={saving}>
                                Cancel
                            </Button>
                            <Button size="sm" onClick={create} isDisabled={!name.trim()} isLoading={saving}>
                                Create
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
