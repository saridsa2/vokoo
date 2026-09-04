"use client";

/**
 * One number, and which flow answers which event on it.
 *
 * The last link in the chain and the one with no console path until now:
 * `number_flows` has existed since migration 0027 and could only be edited in
 * SQL, which left the whole trigger design unreachable from the product.
 *
 * A call is the durable thing; flows are handlers bound to events on it. So a
 * number has a binding per event rather than one flow, and the two are siblings
 * — the answered handler talks to a caller, the ended handler does the work
 * after they have gone.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { Select } from "@/components/base/select/select";
import { ArrowLeft } from "@/components/icons";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

type PhoneNumber = { id: string; number: string; label: string; status: string };
type Flow = { id: string; name: string; status: string; trigger_event: string };
type Binding = { id: string; trigger_event: string; flow_id: string };

/**
 * The events a number can be bound to.
 *
 * `call.never_answered` is left out on purpose: a call that reaches an inbound
 * number was answered, so it can only fire for outbound, which does not exist
 * yet. Offering it would be offering something that can never run.
 */
const EVENTS = [
    {
        id: "call.answered",
        label: "When a call comes in",
        hint: "The flow that answers. Everything the caller hears starts here.",
    },
    {
        id: "call.ended",
        label: "After the call ends",
        hint: "Runs once the call is over. Nobody is listening, so this is for the work that happens afterwards.",
    },
] as const;

export const PhoneNumberDetailScreen = ({ numberId }: { numberId: string }) => {
    const { context, isReady } = useSession();
    const notify = useNotify();

    const [number, setNumber] = useState<PhoneNumber | null>(null);
    const [flows, setFlows] = useState<Flow[]>([]);
    const [bindings, setBindings] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        (async () => {
            try {
                const [detail, allFlows, bound] = await Promise.all([
                    api.get<PhoneNumber>("phone-numbers", numberId, context),
                    api.list<Flow>("flows", context),
                    api.numberFlows<Binding>(numberId, context),
                ]);
                if (!live) return;
                setNumber(detail.data);
                setFlows(allFlows.data ?? []);
                setBindings(Object.fromEntries((bound.data ?? []).map((row) => [row.trigger_event, row.flow_id])));
            } catch (problem) {
                if (live) notify.failure("Could not load this number", problem);
            }
        })();
        return () => {
            live = false;
        };
    }, [numberId, context, isReady, notify]);

    // A flow only handles the event it was made for, so each list offers only
    // the flows that can actually answer it.
    const flowsFor = useMemo(() => {
        const byEvent: Record<string, Flow[]> = {};
        for (const event of EVENTS) byEvent[event.id] = flows.filter((flow) => flow.trigger_event === event.id);
        return byEvent;
    }, [flows]);

    const bind = useCallback(
        async (event: string, flowId: string | null) => {
            if (!context) return;
            setBusy(event);
            setNote(null);
            try {
                await api.setNumberFlow(numberId, event, flowId, context);
                setBindings((current) => {
                    const next = { ...current };
                    if (flowId) next[event] = flowId;
                    else delete next[event];
                    return next;
                });
                const flow = flows.find((row) => row.id === flowId);
                setNote(
                    !flowId
                        ? "Unbound. Nothing handles that event on this number."
                        : flow?.status === "published"
                          ? `Bound. The next call will run ${flow.name}.`
                          : `Bound, but ${flow?.name} is a draft — a call cannot reach it until it is published.`,
                );
            } catch (problem) {
                notify.failure("Could not bind the flow", problem);
            } finally {
                setBusy(null);
            }
        },
        [context, numberId, flows, notify],
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-col gap-3">
                <Button href="/phone-numbers" color="link-gray" size="sm" iconLeading={ArrowLeft} className="self-start">
                    Phone Numbers
                </Button>
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="font-mono text-display-xs font-semibold text-primary">{number?.number ?? "…"}</h1>
                    {number ? (
                        <Badge color={number.status === "active" ? "success" : "gray"} size="sm">
                            {number.status}
                        </Badge>
                    ) : null}
                </div>
                {number?.label ? <p className="text-md text-tertiary">{number.label}</p> : null}
            </header>

            {note ? <p className="text-sm text-brand-secondary">{note}</p> : null}

            <section className="flex max-w-2xl flex-col gap-5">
                <h2 className="flex items-center gap-1.5 text-lg font-semibold text-primary">
                    Which flow answers
                    <InfoHint title="A call is one thing; flows are handlers bound to moments on it. Each one is chosen separately." />
                </h2>

                {EVENTS.map((event) => {
                    const options = flowsFor[event.id] ?? [];
                    const items = [{ id: "", label: "Nothing" }, ...options.map((flow) => ({
                        id: flow.id,
                        label: flow.status === "published" ? flow.name : `${flow.name} (draft)`,
                    }))];
                    return (
                        <div key={event.id} className="flex flex-col gap-1.5">
                            <span className="flex items-center gap-1.5 text-sm font-medium text-secondary">
                                {event.label}
                                <InfoHint title={event.hint} />
                            </span>
                            <Select
                                aria-label={event.label}
                                selectedKey={bindings[event.id] ?? ""}
                                isDisabled={busy === event.id}
                                onSelectionChange={(key) => void bind(event.id, String(key) || null)}
                                items={items}
                            >
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                            {options.length === 0 ? (
                                <span className="text-xs text-tertiary">
                                    No flow handles this event yet. A flow chooses its event when it is created.
                                </span>
                            ) : null}
                        </div>
                    );
                })}
            </section>
        </div>
    );
};
