"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { SearchLg } from "@/components/icons";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { useResource } from "@/hooks/use-resource";
import type { Flow } from "@/utils/flow-graph";
import { readGraph } from "@/utils/flow-graph";
import { dateTime } from "@/utils/format";

type PhoneNumber = { id: string; number: string; flow_id: string | null };

/**
 * The flows in this workspace, as cards.
 *
 * Opening one is a place you go: the card is the way in, and the canvas takes
 * the whole window once you are there. A table would carry the same fields and
 * none of the shape — what a reader wants from this screen is which flow, and
 * flows are few and named rather than many and queried.
 */
export function FlowsWorkspaceScreen() {
    const router = useRouter();
    const { records, isLoading, error } = useResource<Flow>("flows");
    // The number a flow answers is the most useful thing on the card: a flow no
    // number points at is inert, however finished it looks.
    const { records: numbers } = useResource<PhoneNumber>("phone-numbers");
    const [query, setQuery] = useState("");

    const numberFor = useMemo(() => {
        const byFlow = new Map<string, string>();
        for (const number of numbers) if (number.flow_id) byFlow.set(number.flow_id, number.number);
        return byFlow;
    }, [numbers]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return records;
        return records.filter((flow) => `${flow.name} ${flow.description ?? ""}`.toLowerCase().includes(needle));
    }, [records, query]);

    return (
        <>
            <ScreenHeader
                title="Composer"
                description="The flows that decide what happens on a call."
                search={
                    <div className="w-full md:w-64">
                        <Input
                            icon={SearchLg}
                            placeholder="Search flows"
                            value={query}
                            onChange={(value) => setQuery(String(value))}
                            aria-label="Search flows"
                        />
                    </div>
                }
                actions={<Button size="sm">Create Flow</Button>}
            />

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
                            {records.length === 0 ? "No flows yet" : "No flows match that"}
                        </p>
                        <p className="mx-auto mt-1 max-w-md text-sm text-tertiary">
                            A flow decides what happens when a number rings — which questions are asked, when the
                            caller reaches a person, and how the call ends.
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
