"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { ClockRewind } from "@/components/icons";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { api, type AccessContext } from "@/utils/api-client";
import { diffAgents, formatValue, type FieldChange } from "@/utils/agent-diff";
import { timeAgo } from "@/utils/format";

/**
 * Version history for one agent, with rollback.
 *
 * A version is a snapshot written at publish time. Restoring one republishes
 * that snapshot through the same path a normal publish takes, so it appends a
 * new version rather than rewriting history — the log stays a record of what
 * actually happened, including the rollback.
 *
 * History is fetched when the panel opens rather than with the agent. It is
 * unbounded and almost never read, so loading it with every selection would
 * grow the cost of switching agents for no benefit.
 */

type Version = {
    id: string;
    version: number;
    snapshot: Record<string, unknown>;
    published_by: string | null;
    created_at: string;
};

type Props = {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    agentId: string | null;
    context: AccessContext | null;
    /** The live row, so each version can be diffed against what is running. */
    current: Record<string, unknown> | null;
    /** Called after a successful restore, so the list can pick up the new row. */
    onRestored: () => void;
};

export function AgentVersionsPanel({ isOpen, onOpenChange, agentId, context, current, onRestored }: Props) {
    const notify = useNotify();

    const [versions, setVersions] = useState<Version[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [expanded, setExpanded] = useState<number | null>(null);
    const [restoring, setRestoring] = useState<number | null>(null);

    useEffect(() => {
        if (!isOpen || !agentId || !context) return;

        let cancelled = false;
        setIsLoading(true);

        api.agentVersions<Version>(agentId, context)
            .then(({ data }) => {
                if (cancelled) return;
                setVersions(data ?? []);
            })
            .catch((cause) => {
                if (cancelled) return;
                notify.failure("Could not load the version history", cause);
                setVersions([]);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, agentId, context, notify]);

    async function restore(version: number) {
        if (!agentId || !context) return;
        if (!window.confirm(`Republish version ${version}? This appends a new version; nothing is erased.`)) return;

        setRestoring(version);
        try {
            await api.restoreAgentVersion(agentId, version, context);
            onRestored();
            onOpenChange(false);
        } catch (cause) {
            notify.failure(`Could not restore version ${version}`, cause);
        } finally {
            setRestoring(null);
        }
    }

    // Newest first is the server's order; sorted here too so a change in the
    // query cannot silently reverse the panel.
    const ordered = [...versions].sort((a, b) => b.version - a.version);
    const latest = ordered[0]?.version ?? null;

    return (
        <SlideoutMenu isOpen={isOpen} onOpenChange={onOpenChange} className="max-w-120">
            {({ close }) => (
                <>
                    <SlideoutMenu.Header onClose={close}>
                        <h2 className="text-lg font-semibold text-primary">Version history</h2>
                        <p className="mt-1 text-sm text-tertiary">Every publish is kept. Restoring one republishes it as a new version.</p>
                    </SlideoutMenu.Header>

                    <SlideoutMenu.Content>
                        {isLoading && <p className="text-sm text-tertiary">Loading history…</p>}

                        {!isLoading && ordered.length === 0 && (
                            <p className="text-sm text-tertiary">
                                No versions yet. The first publish of this agent will start the history.
                            </p>
                        )}

                        <ul className="flex flex-col divide-y divide-border-secondary">
                            {ordered.map((entry) => {
                                const changes = diffAgents(entry.snapshot, current);
                                const isCurrent = entry.version === latest;

                                return (
                                    <li key={entry.id} className="py-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-primary">Version {entry.version}</span>
                                                    {isCurrent && (
                                                        <Badge size="sm" type="pill-color" color="success">
                                                            Live
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="mt-0.5 text-xs text-tertiary">
                                                    {timeAgo(entry.created_at)}
                                                    {" · "}
                                                    {String(entry.snapshot?.name ?? "unnamed")}
                                                </p>
                                            </div>

                                            {!isCurrent && (
                                                <Button
                                                    size="sm"
                                                    color="secondary"
                                                    iconLeading={ClockRewind}
                                                    isLoading={restoring === entry.version}
                                                    showTextWhileLoading
                                                    onClick={() => restore(entry.version)}
                                                >
                                                    Restore
                                                </Button>
                                            )}
                                        </div>

                                        {!isCurrent && (
                                            <>
                                                <button
                                                    className="mt-2 text-xs text-brand-secondary hover:text-brand-secondary_hover"
                                                    onClick={() => setExpanded(expanded === entry.version ? null : entry.version)}
                                                >
                                                    {expanded === entry.version ? "Hide" : "Show"} {changes.length}{" "}
                                                    {changes.length === 1 ? "difference" : "differences"} from live
                                                </button>

                                                {expanded === entry.version && <DifferenceList changes={changes} />}
                                            </>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </SlideoutMenu.Content>
                </>
            )}
        </SlideoutMenu>
    );
}

function DifferenceList({ changes }: { changes: FieldChange[] }) {
    if (changes.length === 0) {
        return <p className="mt-2 text-xs text-tertiary">Identical to the live configuration.</p>;
    }

    return (
        <ul className="mt-2 flex flex-col gap-2 border-l-2 border-secondary pl-3">
            {changes.map((change) => (
                <li key={`${change.column}.${change.key ?? ""}`} className="text-xs">
                    <span className="font-medium text-secondary">{change.label}</span>
                    {/* This version's value first, then what is live — the reader
                        is deciding whether to move back to the former. */}
                    <p className="mt-0.5 truncate font-mono text-tertiary">{formatValue(change.before)}</p>
                    <p className="truncate font-mono text-primary">{formatValue(change.after)}</p>
                </li>
            ))}
        </ul>
    );
}
