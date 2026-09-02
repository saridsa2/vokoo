"use client";

/**
 * Runs: every tool a call executed, with what it was asked and what it returned.
 *
 * This was "Evals", described as judging a call "two ways: what the agent said,
 * and what its tools did". It kept neither promise. One of the two said "Not
 * built yet" on the page, and the other is not a judgement — nothing here
 * scores anything. It records that `check_slots` ran, took 56ms and returned
 * `ok`, with the arguments and the result beside it.
 *
 * Which is the more useful screen anyway. On 1 September a booking reference
 * was read back to a caller a digit short, and the question "what did the tool
 * actually issue" went unanswered for an hour — while this screen was one click
 * away holding `{"booking_id": "VY-2780-1600"}`.
 *
 * Separate from the Test panel on a tool's own page, which shows the run you
 * just did and nothing else. These are the runs a caller caused, so this is
 * where "has this ever worked in production" is answered — a question the live
 * panel cannot answer, because a test belongs to no call.
 *
 * Arriving with `?tool=` narrows it to one tool, which is where the Run history
 * link on that tool's page leads.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { DataTable, type DataColumn } from "@/components/application/table/data-table";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { SearchLg } from "@/components/icons";
import { TerminalSquare } from "@/components/icons";
import { api } from "@/utils/api-client";
import { useSession } from "@/hooks/use-session";

type ToolRun = {
    id: string;
    call_id: string | null;
    implementation: string;
    outcome: string | null;
    duration_ms: number | null;
    created_at: string;
    detail?: {
        args?: unknown;
        invocation?: string;
        result?: { result?: unknown; logs?: string[]; message?: string; error?: string };
    };
};

const toolName = (run: ToolRun) => run.implementation.replace(/^tool\./, "");

const RUN_COLUMNS: DataColumn<ToolRun>[] = [
    {
        id: "outcome",
        label: "Outcome",
        render: (run) => (
            <Badge color={run.outcome === "ok" ? "success" : "error"} size="sm">
                {run.outcome ?? "?"}
            </Badge>
        ),
    },
    {
        id: "tool",
        label: "Tool",
        className: "font-mono whitespace-nowrap text-primary",
        render: toolName,
    },
    {
        id: "duration",
        label: "Duration",
        className: "tabular-nums whitespace-nowrap",
        render: (run) => `${run.duration_ms ?? "—"} ms`,
    },
    // `invocation` says whether a caller was mid-sentence when this ran, which
    // is the difference between a two-second budget and thirty.
    { id: "source", label: "Source", className: "hidden lg:table-cell", render: (run) => run.detail?.invocation ?? "—" },
    {
        id: "when",
        label: "When",
        className: "hidden md:table-cell tabular-nums whitespace-nowrap",
        render: (run) => new Date(run.created_at).toLocaleString(),
    },
];

export const RunsScreen = () => {
    const params = useSearchParams();
    const filter = params.get("tool") ?? undefined;

    return (
        // The shell gives a screen a flex child and does not scroll it. Without
        // min-h-0 and a scroller of its own, anything past the fold is clipped
        // rather than reachable — the same shape `resource-list-screen` uses.
        // The shell gives a screen a flex child and does not scroll it. Without
        // min-h-0 and a scroller of its own, anything past the fold is clipped
        // rather than reachable — the same shape `resource-list-screen` uses.
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-col gap-2">
                <h1 className="text-display-xs font-semibold text-primary">Runs</h1>
                <p className="max-w-3xl text-md text-tertiary">
                    Every tool a call ran, with what it was asked and what it gave back.
                </p>
            </header>

            <FunctionExecutions filter={filter} />
        </div>
    );
};

const FunctionExecutions = ({ filter }: { filter?: string }) => {
    const { context, isReady } = useSession();

    const [runs, setRuns] = useState<ToolRun[] | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [outcome, setOutcome] = useState<string>("all");
    const [tool, setTool] = useState<string>("all");

    // Every tool that appears in the loaded runs. Derived rather than fetched:
    // a filter offering a tool with nothing to show is a dead end.
    const toolOptions = useMemo(() => {
        const names = [...new Set((runs ?? []).map(toolName))].sort();
        return [{ id: "all", label: "Every tool" }, ...names.map((name) => ({ id: name, label: name }))];
    }, [runs]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return (runs ?? []).filter((run) => {
            if (tool !== "all" && toolName(run) !== tool) return false;
            // "failed" is anything that is not ok, rather than a list of error
            // names — a new failure mode must not quietly fall out of the filter.
            if (outcome === "ok" && run.outcome !== "ok") return false;
            if (outcome === "failed" && run.outcome === "ok") return false;
            if (!needle) return true;
            // Searches the arguments and the result too, so "Rao" finds the runs
            // about that doctor and not only a tool with Rao in its name.
            return JSON.stringify(run).toLowerCase().includes(needle);
        });
    }, [runs, query, outcome, tool]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        (async () => {
            try {
                const { data } = await api.toolRuns<ToolRun>(filter, context);
                if (live) setRuns(data ?? []);
            } catch (problem) {
                if (live) setError((problem as Error).message);
            }
        })();
        return () => {
            live = false;
        };
    }, [context, isReady, filter]);

    // Counted from what is on screen rather than fetched separately, so the
    // summary and the list can never disagree — including when a filter is on.
    const summary = useMemo(() => {
        const rows = visible;
        const failed = rows.filter((run) => run.outcome !== "ok");
        const timed = rows.map((run) => run.duration_ms ?? 0).filter((ms) => ms > 0).sort((a, b) => a - b);
        return {
            total: rows.length,
            failed: failed.length,
            median: timed.length > 0 ? timed[Math.floor(timed.length / 2)] : null,
        };
    }, [visible]);

    return (
        <div className="flex flex-col gap-4">
            {filter ? (
                <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-tertiary">
                        Showing <span className="font-medium text-secondary">{filter}</span>.
                    </p>
                    <Button href="/runs" color="link-gray" size="sm">
                        Show every tool
                    </Button>
                </div>
            ) : null}

            {error ? <p className="text-md text-error-primary">{error}</p> : null}

            {runs && runs.length > 0 ? (
                // One row, not two. The counts are a caption on the filters —
                // they describe what the filters left — so putting them on their
                // own line as cards spent a whole band of the page restating
                // three numbers.
                <div className="flex flex-wrap items-center gap-3">
                    <div className="w-full sm:w-72">
                        <Input
                            size="sm"
                            icon={SearchLg}
                            placeholder="Search runs, arguments, results"
                            value={query}
                            onChange={(value) => setQuery(String(value))}
                            aria-label="Search function executions"
                        />
                    </div>
                    <div className="w-40">
                        <Select
                            size="sm"
                            aria-label="Filter by outcome"
                            selectedKey={outcome}
                            onSelectionChange={(key) => setOutcome(String(key))}
                            items={[
                                { id: "all", label: "Any outcome" },
                                { id: "ok", label: "Succeeded" },
                                { id: "failed", label: "Failed" },
                            ]}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>
                    <div className="w-44">
                        <Select
                            size="sm"
                            aria-label="Filter by tool"
                            selectedKey={tool}
                            onSelectionChange={(key) => setTool(String(key))}
                            items={toolOptions}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>

                    <p className="ml-auto flex items-center gap-2 text-sm text-tertiary tabular-nums">
                        <span>
                            <span className="font-medium text-secondary">{summary.total}</span>{" "}
                            {summary.total === 1 ? "run" : "runs"}
                        </span>
                        <span aria-hidden="true" className="text-quaternary">·</span>
                        <span className={summary.failed > 0 ? "text-error-primary" : undefined}>
                            <span className="font-medium">{summary.failed}</span> failed
                        </span>
                        {summary.median === null ? null : (
                            <>
                                <span aria-hidden="true" className="text-quaternary">·</span>
                                <span>
                                    <span className="font-medium text-secondary">{summary.median} ms</span> median
                                </span>
                            </>
                        )}
                    </p>
                </div>
            ) : null}

            {runs === null ? (
                <p className="text-sm text-tertiary">Loading…</p>
            ) : visible.length === 0 ? (
                <div className="flex flex-col items-start gap-2 rounded-lg bg-secondary p-8 ring-1 ring-primary">
                    <p className="text-md font-medium text-primary">
                        {runs.length === 0 ? "No executions yet" : "Nothing matches"}
                    </p>
                    <p className="max-w-lg text-sm text-tertiary">
                        {runs.length === 0
                            ? "A tool appears here once a caller has used it. Tests you run from a tool's own page are not listed."
                            : "No run matches the search and filters above."}
                    </p>
                </div>
            ) : (
                <DataTable
                    label="Function executions"
                    rows={visible}
                    columns={RUN_COLUMNS}
                    expandedId={open}
                    onToggleExpanded={(id) => setOpen(open === id ? null : id)}
                    renderExpanded={(run) => <RunDetail run={run} />}
                />
            )}
        </div>
    );
};

const RunDetail = ({ run }: { run: ToolRun }) => {
    const logs = run.detail?.result?.logs ?? [];
    const message = run.detail?.result?.message;
    return (
        <div className="flex flex-col gap-3 rounded-lg bg-primary p-4 ring-1 ring-secondary">
            {message ? <p className="text-sm text-error-primary">{message}</p> : null}

            <Field label="Printed" icon>
                {logs.length > 0 ? (
                    <pre className="max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap text-secondary">
                        {logs.join("\n")}
                    </pre>
                ) : (
                    <p className="text-xs text-quaternary">Nothing was printed.</p>
                )}
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
                <Field label="Arguments">
                    <pre className="max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap text-tertiary">
                        {JSON.stringify(run.detail?.args ?? {}, null, 2)}
                    </pre>
                </Field>
                <Field label="Returned">
                    <pre className="max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap text-tertiary">
                        {JSON.stringify(run.detail?.result?.result ?? null, null, 2)}
                    </pre>
                </Field>
            </div>
        </div>
    );
};

const Field = ({ label, icon, children }: { label: string; icon?: boolean; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-xs text-tertiary">
            {icon ? <TerminalSquare className="size-3.5" aria-hidden="true" /> : null}
            {label}
        </span>
        {children}
    </div>
);
