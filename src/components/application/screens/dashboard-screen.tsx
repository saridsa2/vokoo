"use client";

/**
 * What the line is doing, right now.
 *
 * The landing screen, and the only one in this console that is pushed rather
 * than fetched: `/api/v1/dashboard/stream` is Server-Sent Events end to end.
 * A dashboard is a screen somebody leaves open all day, so asking again every
 * few seconds would spend a request per viewer per tick to be told nothing
 * changed — and still be seconds late when something did. The bridge speaks the
 * instant a call starts, gains a human or ends, and whenever Asterisk says an
 * agent went on or off duty.
 *
 * Every frame is a whole snapshot, never a delta, so a reconnecting browser
 * cannot end up rendering a state that never existed.
 *
 * ## Two facts that look like one
 *
 * **Every live call has an AI on it**, including the ones a person has joined —
 * the AI stays in the bridge muted and keeps taking notes. So "with a person"
 * is a subset of "live", not a second column beside it, and the labels say so.
 *
 * **An agent's `status` is not their availability.** Active/suspended is
 * employment; Online/Offline is a SIP registration that lives in Asterisk's
 * memory. A suspended agent whose registration has not expired is genuinely
 * still reachable for a few minutes, and the roster shows both rather than
 * picking one and being wrong.
 */

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { useEventStream } from "@/hooks/use-event-stream";
import { useSession } from "@/hooks/use-session";

type LiveCall = {
    id: string;
    did: string;
    caller: string;
    channel: string;
    agent: string | null;
    human: boolean;
    seconds: number;
};

type RosterAgent = {
    name: string;
    extension: string;
    endpoint: string;
    suspended: boolean;
    state: "online" | "on_call" | "offline";
};

type Operations = {
    calls: LiveCall[];
    live: number;
    with_human: number;
    agents: RosterAgent[];
    today?: { answered: number; finished: number; seconds: number; timezone: string };
};

/** The viewer's own day. "Today" is a question about whoever is reading this. */
const timezone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
};

export const DashboardScreen = () => {
    const { context } = useSession();
    const { data, connected, error } = useEventStream<Operations>(
        `/api/v1/dashboard/stream?tz=${encodeURIComponent(timezone())}`,
        context,
    );

    const calls = data?.calls ?? [];
    const agents = data?.agents ?? [];
    const online = agents.filter((agent) => agent.state !== "offline").length;

    // A call's length comes from the server, and the server only speaks when
    // something changes — so a timer showing exactly what arrived would sit
    // frozen for the length of the call. It runs forward locally instead: a
    // clock in the browser, not a request. Measured from when the frame landed
    // rather than from an absolute start time, so a browser whose clock
    // disagrees with the server's still counts the right number of seconds.
    const frameAt = useRef(Date.now());
    const [, tick] = useState(0);
    useEffect(() => {
        frameAt.current = Date.now();
    }, [data]);
    useEffect(() => {
        if (calls.length === 0) return;
        const timer = setInterval(() => tick((n) => n + 1), 1000);
        return () => clearInterval(timer);
    }, [calls.length]);
    const elapsed = (call: LiveCall) =>
        call.seconds + Math.max(0, Math.floor((Date.now() - frameAt.current) / 1000));

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <h1 className="text-display-xs font-semibold text-primary">Today</h1>
                    <p className="mt-1 text-sm text-tertiary">
                        {data?.today
                            ? `Since midnight, ${data.today.timezone}.`
                            : "Since midnight."}
                    </p>
                </div>
                <Live connected={connected} error={error} />
            </header>

            <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Figure
                    label="Calls answered"
                    value={data?.today?.answered ?? null}
                    note={
                        data?.today && data.today.answered > data.today.finished
                            ? `${data.today.answered - data.today.finished} still open`
                            : undefined
                    }
                />
                <Figure label="Time on the phone" value={data?.today ? minutes(data.today.seconds) : null} />
                <Figure
                    label="On a call now"
                    value={data ? data.live : null}
                    note={
                        data && data.with_human > 0
                            ? `${data.with_human} with a person`
                            : undefined
                    }
                />
                <Figure
                    label="Agents on duty"
                    value={data ? online : null}
                    note={agents.length ? `of ${agents.length}` : undefined}
                />
            </section>

            <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-primary">Happening now</h2>
                {calls.length === 0 ? (
                    <Empty>
                        {connected
                            ? "Nobody is on the line. This fills in the moment a call arrives — it is not refreshed on a timer."
                            : "Connecting to the line."}
                    </Empty>
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary border-y border-secondary">
                        {calls.map((call) => (
                            <li key={call.id} className="flex flex-wrap items-center gap-3 py-3">
                                <span className="font-mono text-sm text-primary">
                                    {call.caller || "unknown caller"}
                                </span>
                                <span className="text-sm text-tertiary">
                                    {call.agent ?? "still routing"}
                                </span>
                                {call.human ? (
                                    // Not "handed over": the AI is still on the
                                    // call, muted, taking notes. Saying it left
                                    // would misdescribe what is happening.
                                    <Badge color="brand" size="sm">
                                        person joined
                                    </Badge>
                                ) : null}
                                <span className="ml-auto text-sm text-tertiary tabular-nums">
                                    {clock(elapsed(call))}
                                </span>
                                <span className="w-20 text-right text-xs text-quaternary">
                                    {call.channel}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-lg font-semibold text-primary">Who can take a call</h2>
                    <Button href="/team" color="link-color" size="sm">
                        Manage the team
                    </Button>
                </div>
                {agents.length === 0 ? (
                    <Empty>
                        Nobody has an extension yet. An agent is a person with one — add them under
                        Manage.
                    </Empty>
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary border-y border-secondary">
                        {agents.map((agent) => (
                            <li
                                key={agent.endpoint}
                                className="flex flex-wrap items-center gap-3 py-3"
                            >
                                <Dot state={agent.state} />
                                <span className="text-sm text-primary">{agent.name || "—"}</span>
                                <span className="font-mono text-sm text-tertiary">
                                    {agent.extension}
                                </span>
                                {agent.suspended ? (
                                    <Badge color="gray" size="sm">
                                        suspended
                                    </Badge>
                                ) : null}
                                <span className="ml-auto text-sm text-tertiary">
                                    {DUTY[agent.state]}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
};

const DUTY: Record<RosterAgent["state"], string> = {
    online: "on duty",
    on_call: "on a call",
    offline: "off duty",
};

/**
 * Whether the stream is up.
 *
 * Worth a line of its own: every number on this screen is only as true as the
 * connection carrying it, and a dashboard frozen on a stale figure looks exactly
 * like a quiet afternoon.
 */
const Live = ({ connected, error }: { connected: boolean; error: string | null }) => (
    <span className="flex items-center gap-2 text-sm text-tertiary">
        <span
            aria-hidden="true"
            className={`size-2 rounded-full ${connected ? "bg-fg-success-secondary" : "bg-fg-quaternary"}`}
        />
        {connected ? "live" : (error ?? "connecting")}
    </span>
);

const Figure = ({
    label,
    value,
    note,
}: {
    label: string;
    value: number | string | null;
    note?: string;
}) => (
    <div className="flex flex-col gap-1 border border-secondary p-4">
        <span className="text-sm text-tertiary">{label}</span>
        <span className="text-display-sm font-semibold text-primary tabular-nums">
            {value ?? "—"}
        </span>
        <span className="min-h-5 text-xs text-quaternary">{note ?? ""}</span>
    </div>
);

const Dot = ({ state }: { state: RosterAgent["state"] }) => (
    <span
        aria-hidden="true"
        className={`size-2 rounded-full ${
            state === "online"
                ? "bg-fg-success-secondary"
                : state === "on_call"
                  ? "bg-fg-warning-secondary"
                  : "bg-fg-quaternary"
        }`}
    />
);

const Empty = ({ children }: { children: React.ReactNode }) => (
    <p className="border border-dashed border-secondary p-6 text-sm text-tertiary">{children}</p>
);

const minutes = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.round(seconds / 60)}m`;
};

const clock = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
