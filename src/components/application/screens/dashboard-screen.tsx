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
import { CallMonitor } from "@/components/application/screens/call-monitor";
import { Button } from "@/components/base/buttons/button";
import { DashboardCharts, type History } from "@/components/application/screens/dashboard-charts";
import { api } from "@/utils/api-client";
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

    // History is a plain GET, refetched when the day's count moves — which is
    // to say, when a call ends. The stream is what says so, so this updates on
    // the same event and still nothing is on a timer.
    const [history, setHistory] = useState<History | null>(null);
    const answered = data?.today?.answered ?? null;
    useEffect(() => {
        if (!context) return;
        let live = true;
        api.dashboardHistory<History>(14, timezone(), context)
            .then(({ data: rows }) => {
                if (live && rows) setHistory(rows);
            })
            .catch(() => {
                // The live band is the important half and has its own error
                // line; a failed history fetch leaves the charts saying they
                // are loading rather than replacing the screen with an error.
            });
        return () => {
            live = false;
        };
    }, [context?.accessToken, context?.organizationId, answered]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-wrap items-baseline justify-between gap-3">
                {/* No subtitle. "Since midnight" was true of the four cards
                    and false of everything under them — the table is *now* and
                    the charts are a fortnight — so each card carries its own
                    span instead. */}
                <h1 className="text-display-xs font-semibold text-primary">Dashboard</h1>
                <Live connected={connected} error={error} />
            </header>

            <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {/* **"1 still open" is gone.** It counted `calls` rows whose
                    status is not `ended`, which includes every call that died
                    without its end being written — so it sat beside a live
                    count of 0 and contradicted it. That is the stale-row trap
                    the live registry exists to avoid, reintroduced as a
                    footnote. */}
                <Figure
                    label="Calls Today"
                    value={data?.today?.answered ?? null}
                    note={data?.today?.timezone}
                />
                <Figure
                    label="Talk Time Today"
                    value={data?.today ? minutes(data.today.seconds) : null}
                />
                {/* "On a Call Now", not "Active Calls": the section below is
                    headed Active Calls, and a card and a table with one name
                    read as the same thing said twice. */}
                <Figure
                    label="On a Call Now"
                    value={data ? data.live : null}
                    note={
                        data && data.with_human > 0
                            ? `${data.with_human} with a person`
                            : undefined
                    }
                />
                {/* "On Duty" rather than "Available", because that is the word
                    the roster underneath uses and the agent app's own button
                    says. Two vocabularies for one state is how a reader ends up
                    wondering whether they are different states. */}
                <Figure
                    label="Agents On Duty"
                    value={data ? online : null}
                    note={agents.length ? `${agents.length} in the team` : undefined}
                />
            </section>

            {/* The live half, together. Reporting is below because it
                answers a different question over a different span, and
                putting a fortnight's chart between two live panels made
                the roster look like part of the history. */}
            <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
                <div className="xl:col-span-2">
            <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-primary">Active Calls</h2>
                {calls.length === 0 ? (
                    <Empty>
                        {connected
                            ? "No calls in progress."
                            : "Connecting."}
                    </Empty>
                ) : (
                    // A table, with a header row and aligned columns. It was a
                    // flex row per call, which reads as a list of sentences —
                    // the point of a live board is that the eye runs down one
                    // column, and that needs the columns to exist.
                    <div className="overflow-x-auto border border-secondary">
                        <table className="w-full min-w-[58rem] border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-secondary bg-secondary text-left">
                                    <Th>Caller</Th>
                                    <Th>Number Called</Th>
                                    <Th>Agent</Th>
                                    <Th>Type</Th>
                                    <Th align="right">Duration</Th>
                                    <Th>Channel</Th>
                                    <Th align="right">Supervise</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {calls.map((call) => (
                                    <tr
                                        key={call.id}
                                        className="border-b border-secondary last:border-0"
                                    >
                                        <Td mono>{call.caller || "Unknown"}</Td>
                                        <Td mono muted>{call.did || "—"}</Td>
                                        <Td>{call.agent ?? "Routing"}</Td>
                                        <Td>
                                            {/* Not "handed over": the AI stays
                                                on the call, muted, taking
                                                notes. Saying it left would
                                                misdescribe what is happening. */}
                                            {call.human ? (
                                                <Badge color="brand" size="sm">
                                                    AI + Person
                                                </Badge>
                                            ) : (
                                                <Badge color="gray" size="sm">
                                                    AI
                                                </Badge>
                                            )}
                                        </Td>
                                        <Td align="right" mono>
                                            {clock(elapsed(call))}
                                        </Td>
                                        <Td muted>{call.channel}</Td>
                                        <Td align="right">
                                            <CallMonitor
                                                callId={call.id}
                                                hasHuman={call.human}
                                            />
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
                </div>
                <div>
            <section className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-lg font-semibold text-primary">Agents</h2>
                    <Button href="/team" color="link-color" size="sm">
                        Manage team
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
            </div>

            <section className="flex flex-col gap-3">
                {/* Named for its span. "Reporting" is vague here and takes the
                    name of the screen that will do it properly. */}
                <h2 className="flex items-baseline gap-2 text-lg font-semibold text-primary">
                    Last 14 Days
                    {history?.timezone ? (
                        // Once, over all five panels. The span and the zone are
                        // the same for every one of them, so repeating them on
                        // each was four restatements of one fact.
                        <span className="text-xs font-normal text-quaternary">
                            {history.timezone}
                        </span>
                    ) : null}
                </h2>
                <DashboardCharts history={history} />
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
 *
 * "connected", not "live". Beside a card reading *On a Call Now*, the word
 * "live" reads as a statement about the calls rather than about the socket.
 */
const Live = ({ connected, error }: { connected: boolean; error: string | null }) => (
    <span className="flex items-center gap-2 text-sm text-tertiary">
        <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{
                background: connected ? "var(--chart-accent)" : "var(--color-fg-quaternary)",
            }}
        />
        {connected ? "connected" : (error ?? "connecting")}
    </span>
);

/**
 * One number, on a card that belongs to this section.
 *
 * The rule along the top is the dashboard's own accent — the same logic the node
 * cards follow, where an element that belongs to something takes that thing's
 * colour. Four bordered boxes without it read as a spreadsheet.
 *
 * The number itself stays ink. A figure is read, not admired, and colouring it
 * would put the accent on the part that already has the most weight.
 */
const Figure = ({
    label,
    value,
    note,
}: {
    label: string;
    value: number | string | null;
    note?: string;
}) => (
    <div
        className="flex flex-col gap-1 border border-t-2 border-secondary p-4"
        style={{ borderTopColor: "var(--chart-accent)" }}
    >
        <span className="text-sm text-tertiary">{label}</span>
        <span className="text-display-sm font-semibold text-primary tabular-nums">
            {value ?? "—"}
        </span>
        <span className="min-h-5 text-xs text-quaternary">{note ?? ""}</span>
    </div>
);

/**
 * Present, busy, absent — in the same three values the charts use.
 *
 * Not a red/amber/green: none of these is a fault. Somebody off duty at six in
 * the evening is a person who has gone home, and painting that as a warning
 * would make the roster read as a list of problems.
 */
const Dot = ({ state }: { state: RosterAgent["state"] }) => (
    <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{
            background:
                state === "online"
                    ? "var(--chart-accent)"
                    : state === "on_call"
                      ? "var(--chart-emphasis)"
                      : "var(--color-fg-quaternary)",
        }}
    />
);

const Th = ({
    children,
    align,
}: {
    children: React.ReactNode;
    align?: "right";
}) => (
    <th
        scope="col"
        className={`px-4 py-2.5 text-xs font-medium text-tertiary ${
            align === "right" ? "text-right" : "text-left"
        }`}
    >
        {children}
    </th>
);

const Td = ({
    children,
    align,
    mono,
    muted,
}: {
    children: React.ReactNode;
    align?: "right";
    /** Numbers and identifiers, so digits line up down the column. */
    mono?: boolean;
    muted?: boolean;
}) => (
    <td
        className={[
            "px-4 py-3",
            align === "right" ? "text-right" : "text-left",
            mono ? "font-mono tabular-nums" : "",
            muted ? "text-tertiary" : "text-primary",
        ].join(" ")}
    >
        {children}
    </td>
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
