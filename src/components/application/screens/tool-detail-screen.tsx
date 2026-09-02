"use client";

/**
 * One tool: what it is, what it looks like, and what it does when you run it.
 *
 * The source is shown and not edited. A tool pushed with the SDK has its
 * authority in a repository — editing it here would make the console a second
 * author, and the next `vokoo push` would overwrite whatever was typed without
 * saying so. Running it is the thing this screen is for, and running it goes
 * through the same executor a caller reaches.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Label } from "@/components/base/input/label";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { Badge } from "@/components/base/badges/badges";
import { ArrowLeft, ArrowRight, PlayCircle, TerminalSquare, IconTools } from "@/components/icons";
import { api } from "@/utils/api-client";
import { useSession } from "@/hooks/use-session";

type Tool = {
    id: string;
    name: string;
    kind: string;
    description: string;
    schema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
    current_version?: number;
    endpoint_url?: string | null;
};

type ToolVersion = {
    version: number;
    checksum: string;
    source: string;
    created_at: string;
    snapshot?: { timeoutSeconds?: number | null };
};

type RunOutcome = {
    ok: boolean;
    result?: unknown;
    error?: string;
    message?: string;
    stack?: string;
    logs?: string[];
    duration_ms?: number;
    version?: number;
};

/** Arguments prefilled from the schema, so Run is one click away from useful. */
function sampleArgs(tool: Tool | null): string {
    const properties = tool?.schema?.properties ?? {};
    const names = Object.keys(properties);
    if (names.length === 0) return "{}";
    const sample = Object.fromEntries(
        names.map((name) => {
            const type = properties[name]?.type;
            if (type === "number" || type === "integer") return [name, 0];
            if (type === "boolean") return [name, false];
            if (type === "array") return [name, []];
            if (type === "object") return [name, {}];
            return [name, ""];
        }),
    );
    return JSON.stringify(sample, null, 2);
}

export const ToolDetailScreen = ({ toolId }: { toolId: string }) => {
    const { context, isReady } = useSession();

    const [tool, setTool] = useState<Tool | null>(null);
    const [versions, setVersions] = useState<ToolVersion[]>([]);
    const [showing, setShowing] = useState<number | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [args, setArgs] = useState("{}");
    const [touched, setTouched] = useState(false);
    const [running, setRunning] = useState(false);
    const [outcome, setOutcome] = useState<RunOutcome | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;

        (async () => {
            try {
                const { data } = await api.get<Tool>("tools", toolId, context);
                if (!live) return;
                setTool(data);
                // Only prefill while nobody has typed. Refetching must not throw
                // away a payload somebody was halfway through writing.
                setArgs((current) => (current === "{}" ? sampleArgs(data) : current));

                const rows = await api.toolVersions<ToolVersion>(data.name, context);
                if (!live) return;
                setVersions(rows.data ?? []);
                setShowing(rows.data?.[0]?.version ?? null);

            } catch (error) {
                if (live) setLoadError((error as Error).message);
            }
        })();

        return () => {
            live = false;
        };
    }, [toolId, context, isReady]);

    const version = useMemo(
        () => versions.find((row) => row.version === showing) ?? versions[0] ?? null,
        [versions, showing],
    );

    const run = useCallback(async () => {
        if (!tool || !context) return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(args || "{}");
        } catch {
            setOutcome({ ok: false, error: "bad_arguments", message: "The arguments are not valid JSON." });
            return;
        }

        setRunning(true);
        setOutcome(null);
        try {
            const { data } = await api.runFunction<RunOutcome>(tool.name, parsed, showing ?? undefined, context);
            setOutcome(data);
        } catch (error) {
            setOutcome({ ok: false, error: "unreachable", message: (error as Error).message });
        } finally {
            setRunning(false);
        }
    }, [tool, args, showing, context]);

    if (loadError) {
        return (
            <div className="p-8">
                <p className="text-md text-error-primary">{loadError}</p>
            </div>
        );
    }

    const pushed = (tool?.current_version ?? 0) > 0;

    return (
        // The shell gives a screen a flex child and does not scroll it. Without
        // min-h-0 and a scroller of its own, anything past the fold is clipped
        // rather than reachable — the same shape `resource-list-screen` uses.
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-col gap-3">
                <Button href="/tools" color="link-gray" size="sm" iconLeading={ArrowLeft} className="self-start">
                    Tools
                </Button>

                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-display-xs font-semibold text-primary">{tool?.name ?? "…"}</h1>
                    {tool ? <Badge color="gray" size="sm">{tool.kind}</Badge> : null}
                    {pushed ? <Badge color="brand" size="sm">v{tool?.current_version}</Badge> : null}
                </div>

                {tool?.description ? <p className="max-w-3xl text-md text-tertiary">{tool.description}</p> : null}
            </header>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <section className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-secondary">Source</h2>
                        {versions.length > 1 ? (
                            <div className="flex items-center gap-2">
                                <label htmlFor="tool-version" className="text-xs text-tertiary">
                                    Version
                                </label>
                                <select
                                    id="tool-version"
                                    value={showing ?? ""}
                                    onChange={(event) => setShowing(Number(event.target.value))}
                                    className="rounded-md bg-primary px-2 py-1 text-xs text-secondary ring-1 ring-primary"
                                >
                                    {versions.map((row) => (
                                        <option key={row.version} value={row.version}>
                                            v{row.version}
                                            {row.version === tool?.current_version ? " (live)" : ""}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : null}
                    </div>

                    {version ? (
                        <SourceView source={version.source} />
                    ) : (
                        <EmptySource
                            reason={
                                tool && !pushed
                                    ? "This tool was made in the console, so it has no source. Tools pushed with the vokoo CLI show their code here."
                                    : "Loading…"
                            }
                            endpoint={tool?.endpoint_url ?? null}
                        />
                    )}
                </section>

                <section className="flex min-w-0 flex-col gap-3">
                    {/* Run first. The arguments box is tall, and a button below
                        it sits off the fold on a short window — so the action
                        you came for was the one thing you had to scroll to. */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-secondary">Test</h2>
                        <Button
                            href={tool ? `/runs?tool=${encodeURIComponent(tool.name)}` : "/runs"}
                            color="link-gray"
                            size="sm"
                            iconTrailing={ArrowRight}
                        >
                            Run history
                        </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <Button size="sm" iconLeading={PlayCircle} isLoading={running} showTextWhileLoading onClick={run} isDisabled={!tool || !pushed}>
                            {running ? "Running…" : `Run${showing ? ` v${showing}` : ""}`}
                        </Button>
                        {touched && tool ? (
                            <Button size="sm" color="link-gray" onClick={() => { setArgs(sampleArgs(tool)); setTouched(false); }}>
                                Reset
                            </Button>
                        ) : null}
                        {!pushed && tool ? (
                            <span className="text-xs text-tertiary">Only tools pushed with the CLI can be run here.</span>
                        ) : null}
                    </div>

                    {outcome ? <RunReport outcome={outcome} /> : null}

                    <Label htmlFor="tool-args">
                        Arguments
                        <InfoHint title="Prefilled from this tool's declared inputs. Edit them to try something else." />
                    </Label>
                    <textarea
                        id="tool-args"
                        value={args}
                        spellCheck={false}
                        onChange={(event) => {
                            setArgs(event.target.value);
                            setTouched(true);
                        }}
                        rows={8}
                        className="w-full resize-y rounded-lg bg-primary p-3 font-mono text-xs text-primary ring-1 ring-primary focus:outline-2 focus:outline-offset-2 focus:outline-brand-solid"
                    />
                </section>
            </div>
        </div>
    );
};

/** Read-only, with line numbers, because a stack trace names a line. */
const SourceView = ({ source }: { source: string }) => {
    const lines = source.split("\n");
    return (
        <div className="overflow-hidden rounded-lg bg-secondary ring-1 ring-primary">
            <div className="max-h-[32rem] overflow-auto">
                <table className="w-full border-collapse font-mono text-xs">
                    <tbody>
                        {lines.map((line, index) => (
                            <tr key={index} className="align-top">
                                <td className="w-10 select-none px-3 py-0.5 text-right text-quaternary tabular-nums">
                                    {index + 1}
                                </td>
                                <td className="whitespace-pre px-3 py-0.5 text-secondary">{line || " "}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const EmptySource = ({ reason, endpoint }: { reason: string; endpoint: string | null }) => (
    <div className="flex flex-col items-start gap-3 rounded-lg bg-secondary p-6 ring-1 ring-primary">
        <IconTools className="size-5 text-fg-quaternary" />
        <p className="max-w-md text-sm text-tertiary">{reason}</p>
        {endpoint ? (
            <p className="font-mono text-xs break-all text-quaternary">{endpoint}</p>
        ) : null}
    </div>
);

/**
 * Logs first, then the answer.
 *
 * What a tool printed on its way to failing is usually the reason it failed,
 * and putting it below the error means scrolling past the error to reach it.
 */
const RunReport = ({ outcome }: { outcome: RunOutcome }) => (
    <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
            <Badge color={outcome.ok ? "success" : "error"} size="sm">
                {outcome.ok ? "ok" : (outcome.error ?? "failed")}
            </Badge>
            {typeof outcome.duration_ms === "number" ? (
                <span className="text-xs text-tertiary tabular-nums">{outcome.duration_ms} ms</span>
            ) : null}
            {outcome.version ? <span className="text-xs text-tertiary">v{outcome.version}</span> : null}
        </div>

        {outcome.logs && outcome.logs.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-lg bg-secondary p-3 ring-1 ring-primary">
                <span className="flex items-center gap-1.5 text-xs text-tertiary">
                    <TerminalSquare className="size-3.5" aria-hidden="true" />
                    Printed
                </span>
                <pre className="max-h-56 overflow-auto font-mono text-xs whitespace-pre-wrap text-secondary">
                    {outcome.logs.join("\n")}
                </pre>
            </div>
        ) : null}

        {outcome.message ? <p className="text-sm text-error-primary">{outcome.message}</p> : null}

        {outcome.stack ? (
            <pre className="overflow-auto rounded-lg bg-secondary p-3 font-mono text-xs whitespace-pre-wrap text-tertiary ring-1 ring-primary">
                {outcome.stack}
            </pre>
        ) : null}

        {outcome.ok ? (
            <pre className="max-h-72 overflow-auto rounded-lg bg-secondary p-3 font-mono text-xs whitespace-pre-wrap text-secondary ring-1 ring-primary">
                {JSON.stringify(outcome.result, null, 2)}
            </pre>
        ) : null}
    </div>
);
