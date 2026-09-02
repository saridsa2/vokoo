"use client";

/**
 * One call, as it happened.
 *
 * The list has always shown that a call occurred — who rang, for how long — and
 * nothing about what was said. Every word of every call has existed only in the
 * server journal, which is not somewhere anyone should have to go to answer
 * "what did the agent tell them".
 *
 * Two records, side by side, because they answer different questions. The
 * transcript is what the caller heard. The trail is what the flow did — which
 * node ran, which outcome it left by — and it is the only thing that explains a
 * call that ended somewhere surprising.
 */

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ArrowLeft } from "@/components/icons";
import { api } from "@/utils/api-client";
import { duration, phoneNumber, timeAgo } from "@/utils/format";
import { useSession } from "@/hooks/use-session";

type Line = { speaker: string; text: string; at?: string };

type Call = {
    id: string;
    from_number: string | null;
    to_number: string | null;
    status: string;
    duration_seconds: number | null;
    started_at: string | null;
    ended_reason: string | null;
    disconnect_reason: string | null;
    recording_url: string | null;
    cost: string | number | null;
    transcript: Line[];
    metadata: Record<string, unknown> | null;
};

/**
 * What the call cost, per currency.
 *
 * Per currency because vendors bill in their own and nothing converts: an
 * exchange rate nobody supplied would be a number this screen invented.
 *
 * `unpriced_items` is the column that matters most. A call whose vendors have
 * no rate entered is not a free call — it is an unmeasured one, and showing it
 * as ₹0 would be the most confident wrong number on the page.
 */
type CallCost = {
    session_id: string;
    currency: string;
    cost: string | number | null;
    unpriced_items: number;
    unpriced_vendors: string[] | null;
};

type CallEvent = {
    id: string;
    sequence: number;
    node_name: string | null;
    implementation: string | null;
    outcome: string | null;
    duration_ms: number | null;
};

export const CallDetailScreen = ({ callId }: { callId: string }) => {
    const { context, isReady } = useSession();

    const [call, setCall] = useState<Call | null>(null);
    const [events, setEvents] = useState<CallEvent[]>([]);
    const [costs, setCosts] = useState<CallCost[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        (async () => {
            try {
                const [detail, trail, priced] = await Promise.all([
                    api.get<Call>("call-logs", callId, context),
                    api.list<CallEvent>("call-events", context),
                    // The usage ledger is keyed on the call's own row id, so a
                    // cost joins straight back to the call it belongs to.
                    api.list<CallCost>("call-costs", context),
                ]);
                if (!live) return;
                setCall(detail.data);
                setCosts((priced.data ?? []).filter((row) => row.session_id === callId));
                // The generic list endpoint takes no filter, so the call's own
                // events are picked out here. A call has a handful of them.
                setEvents(
                    (trail.data ?? [])
                        .filter((event) => (event as CallEvent & { call_id?: string }).call_id === callId)
                        .sort((a, b) => a.sequence - b.sequence),
                );
            } catch (problem) {
                if (live) setError((problem as Error).message);
            }
        })();
        return () => {
            live = false;
        };
    }, [callId, context, isReady]);

    const lines = useMemo(() => (Array.isArray(call?.transcript) ? call.transcript : []), [call]);

    if (error) {
        return (
            <div className="grid h-full place-items-center p-8">
                <div className="max-w-md text-center">
                    <p className="text-sm font-medium text-primary">Could not open this call</p>
                    <p className="mt-1 text-sm text-tertiary">{error}</p>
                </div>
            </div>
        );
    }

    if (!call) {
        return (
            <div className="flex min-h-0 flex-1 flex-col p-6">
                <p className="text-sm text-tertiary">Loading…</p>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 flex-col gap-3 border-b border-secondary p-6 lg:px-8">
                <Button href="/call-logs" color="link-gray" size="sm" iconLeading={ArrowLeft} className="self-start">
                    Call Logs
                </Button>

                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="font-mono text-display-xs font-semibold text-primary">
                        {phoneNumber(call.from_number ?? "")}
                    </h1>
                    <Badge color={call.status === "ended" ? "gray" : "success"} size="sm">
                        {call.status}
                    </Badge>
                    {call.ended_reason ? (
                        <Badge color="brand" size="sm">
                            {call.ended_reason}
                        </Badge>
                    ) : null}
                </div>

                {/* The facts somebody checks first, in one line. */}
                <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
                    <Fact label="Called" value={phoneNumber(call.to_number ?? "—")} />
                    <Fact label="Lasted" value={duration(call.duration_seconds ?? 0)} />
                    <Fact label="Started" value={call.started_at ? timeAgo(call.started_at) : "—"} />
                    <Fact
                        label="Ended by"
                        value={call.disconnect_reason === "user_disconnected" ? "the caller" : (call.disconnect_reason ?? "—")}
                    />
                    <CostFact costs={costs} />
                </dl>
            </header>

            <div className="grid min-h-0 flex-1 gap-8 overflow-y-auto p-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_22rem] xl:overflow-hidden">
                <section className="flex flex-col gap-3 xl:min-h-0">
                    <h2 className="text-sm font-semibold text-secondary">What was said</h2>

                    {lines.length === 0 ? (
                        // Distinguished from "nobody spoke", which is a different
                        // and much rarer thing.
                        <p className="max-w-lg text-sm text-tertiary">
                            Nothing was recorded for this call. The bridge writes each line as it is spoken, so a call
                            that ran before that was wired has none.
                        </p>
                    ) : (
                        <ol className="flex flex-col gap-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
                            {lines.map((line, index) => (
                                <li key={index} className="flex flex-col gap-0.5">
                                    <span className="text-xs font-medium tracking-wide text-quaternary uppercase">
                                        {line.speaker === "agent" ? "Agent" : "Caller"}
                                    </span>
                                    <p
                                        className={`max-w-2xl rounded-lg px-3 py-2 text-sm ${
                                            line.speaker === "agent"
                                                ? "bg-secondary text-primary"
                                                : "bg-primary text-primary ring-1 ring-secondary"
                                        }`}
                                    >
                                        {line.text}
                                    </p>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>

                <aside className="flex flex-col gap-3 xl:min-h-0 xl:overflow-y-auto">
                    <h2 className="text-sm font-semibold text-secondary">What the flow did</h2>

                    {events.length === 0 ? (
                        <p className="text-sm text-tertiary">No steps recorded.</p>
                    ) : (
                        <ol className="flex flex-col">
                            {events.map((event) => (
                                <li
                                    key={event.id}
                                    className="flex flex-col gap-0.5 border-l border-secondary py-2 pl-4 first:pt-0 last:pb-0"
                                >
                                    <span className="text-sm font-medium text-primary">{event.node_name ?? "—"}</span>
                                    <span className="font-mono text-xs text-quaternary">{event.implementation ?? ""}</span>
                                    <span className="text-xs text-tertiary">
                                        left by {event.outcome ?? "—"}
                                        {event.duration_ms ? ` · ${event.duration_ms} ms` : ""}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}

                    {call.recording_url ? (
                        <Button href={call.recording_url} target="_blank" rel="noopener noreferrer" color="secondary" size="sm">
                            Listen to the recording
                        </Button>
                    ) : (
                        // The carrier hands one over when the call ends. Nothing
                        // stores it yet, which is worth saying rather than
                        // leaving a reader to wonder if the call was recorded.
                        <p className="text-xs text-tertiary">The carrier's recording is not stored yet.</p>
                    )}
                </aside>
            </div>
        </div>
    );
};

/**
 * Cost, or an honest account of why there isn't one.
 *
 * Three states, deliberately distinct. A priced call shows a figure per
 * currency. A call whose vendors have no rate shows what is missing and names
 * them, because the fix is to go and enter those rates. A call with no usage at
 * all — one that ran before this was wired — says so rather than showing zero.
 */
const CostFact = ({ costs }: { costs: CallCost[] }) => {
    if (costs.length === 0) {
        return <Fact label="Cost" value="no usage recorded" />;
    }

    const priced = costs.filter((row) => row.cost !== null);
    const unpricedVendors = [...new Set(costs.flatMap((row) => row.unpriced_vendors ?? []))];

    return (
        <div className="flex flex-col">
            <dt className="text-xs text-quaternary">Cost</dt>
            <dd className="text-secondary">
                {priced.length > 0
                    ? priced
                          .map((row) => `${row.currency} ${Number(row.cost).toFixed(4)}`)
                          .join("  +  ")
                    : "not priced"}
                {unpricedVendors.length > 0 ? (
                    <span className="ml-2 text-xs text-warning-primary">
                        no rate for {unpricedVendors.join(", ")}
                    </span>
                ) : null}
            </dd>
        </div>
    );
};

const Fact = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col">
        <dt className="text-xs text-quaternary">{label}</dt>
        <dd className="text-secondary">{value}</dd>
    </div>
);
