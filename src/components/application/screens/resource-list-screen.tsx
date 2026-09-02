"use client";

import { useMemo, useState, type ReactNode } from "react";

import { PaginationPageDefault } from "@/components/application/pagination/pagination";

/**
 * Rows per page.
 *
 * Every list in the console comes through this screen, so this is the one place
 * it is decided.
 *
 * Ten rather than twenty-five: the tables here are small — fourteen calls,
 * a handful of agents — and at twenty-five nothing in the console would ever
 * show a second page. A page size no dataset reaches is pagination that exists
 * only in the code.
 */
const PAGE_SIZE = 10;
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Table, TableCard } from "@/components/application/table/table";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { SearchLg } from "@/components/icons";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { useResource } from "@/hooks/use-resource";
import { RESOURCE_VIEWS, type Row } from "./resource-columns";

/**
 * List screen for any control-plane resource.
 *
 * The API is uniform (`/api/v1/{resource}`), so the screens differ only in
 * their columns — supplied by `RESOURCE_VIEWS`. Fifteen hand-written lists
 * would be fifteen places for spacing, empty states and status colours to
 * drift apart.
 */
export function ResourceListScreen({
    resourceKey,
    /**
     * The screen's own create control, when it has one. Every "Create X" button
     * in this console is decorative until the screen behind it supplies this.
     */
    createSlot,
}: {
    resourceKey: string;
    createSlot?: ReactNode;
}) {
    // The view is resolved here rather than passed in. `resource-columns` is a
    // client module, so a server component importing RESOURCE_VIEWS receives a
    // client reference and every lookup silently misses — and its render
    // callbacks could not cross the server/client boundary as props anyway.
    const view = RESOURCE_VIEWS[resourceKey];

    const { records, isLoading, error } = useResource<Row>(view?.resource ?? "");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return records;

        // Search every value rather than a nominated field: the useful column
        // differs per resource, and someone looking up a number should not have
        // to know which column it lives in.
        return records.filter((row) =>
            Object.values(row).some((value) => typeof value === "string" && value.toLowerCase().includes(needle)),
        );
    }, [records, query]);

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    // Clamped rather than reset: typing into the search while on page 4 should
    // land on the last page of the new result, not throw the reader back to the
    // first for a filter that still has four pages.
    const current = Math.min(page, pages);
    const shown = useMemo(
        () => filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
        [filtered, current],
    );

    if (!view) return null;

    return (
        <>
            <ScreenHeader
                title={view.title}
                description={view.description}
                // Rendered whether or not there are rows yet. Showing it only
                // once records land makes the pinned header change shape as the
                // request resolves, and a header that jumps is worse than a
                // search field with nothing to filter.
                search={
                    <div className="w-full md:w-64">
                        <Input
                            icon={SearchLg}
                            placeholder={`Search ${view.title.toLowerCase()}`}
                            value={query}
                            onChange={(value) => setQuery(String(value))}
                            aria-label={`Search ${view.title}`}
                        />
                    </div>
                }
                // A screen that can actually create something supplies its own
                // control. The plain button is what remains everywhere that
                // cannot yet — it is decorative, and saying so here is better
                // than each screen discovering it.
                actions={createSlot ?? (view.createLabel ? <Button size="sm">{view.createLabel}</Button> : undefined)}
            />

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">

                {error ? (
                    <div className="rounded-xl bg-error-primary p-6 ring-1 ring-error_subtle">
                        <p className="text-sm font-semibold text-error-primary">Could not load {view.title.toLowerCase()}</p>
                        <p className="mt-1 text-sm text-error-primary">{error.message}</p>
                    </div>
                ) : isLoading ? (
                    <TableSkeleton columns={view.columns.length} />
                ) : filtered.length === 0 ? (
                    <EmptyState size="sm">
                        <EmptyState.Header>
                            <EmptyState.FeaturedIcon color="gray" />
                        </EmptyState.Header>
                        <EmptyState.Content>
                            <EmptyState.Title>{query ? "No matches" : view.emptyTitle}</EmptyState.Title>
                            <EmptyState.Description>
                                {query ? `Nothing matches “${query}”.` : view.emptyBody}
                            </EmptyState.Description>
                        </EmptyState.Content>
                    </EmptyState>
                ) : (
                    // shrink-0: the card sets overflow-hidden, so as a flex child it
                    // would compress and clip rows rather than let the body scroll.
                    // Keep its natural height and let the scroll happen above it.
                    <TableCard.Root size="md" className="shrink-0">
                        <Table aria-label={view.title}>
                            <Table.Header>
                                {view.columns.map((column, index) => (
                                    <Table.Head
                                        key={column.id}
                                        id={column.id}
                                        label={column.label}
                                        // React Aria wants exactly one row header
                                        // per row for screen-reader navigation.
                                        isRowHeader={index === 0}
                                        className={column.secondary ? "hidden lg:table-cell" : undefined}
                                    />
                                ))}
                            </Table.Header>

                            <Table.Body items={shown}>
                                {(row) => (
                                    // `href` rather than a click handler: React
                                    // Aria renders a real link, so a middle
                                    // click opens a tab and the keyboard works.
                                    <Table.Row id={row.id} href={view.detailHref?.(row)}>
                                        {view.columns.map((column) => (
                                            <Table.Cell
                                                key={column.id}
                                                className={column.secondary ? "hidden lg:table-cell" : undefined}
                                            >
                                                {column.render ? column.render(row) : ((row[column.id] as string) ?? "—")}
                                            </Table.Cell>
                                        ))}
                                    </Table.Row>
                                )}
                            </Table.Body>
                        </Table>
                    </TableCard.Root>
                )}

                {filtered.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-tertiary">
                            {/* Which rows these are, not just how many there
                                are: on page three, "60 of 412" leaves the
                                reader working out what they are looking at. */}
                            {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} of{" "}
                            {filtered.length}
                            {filtered.length === records.length ? "" : ` (filtered from ${records.length})`}{" "}
                            {filtered.length === 1 ? "record" : "records"}
                        </p>
                        {/* Only when there is more than one page. A pager over a
                            single page is a control that cannot do anything. */}
                        {pages > 1 && (
                            <PaginationPageDefault page={current} total={pages} onPageChange={setPage} />
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

/** Holds the table's shape while loading, so the layout does not jump. */
function TableSkeleton({ columns }: { columns: number }) {
    return (
        <div className="overflow-hidden rounded-xl ring-1 ring-secondary">
            {Array.from({ length: 4 }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex gap-4 border-b border-secondary px-4 py-3.5 last:border-0">
                    {Array.from({ length: columns }).map((__, cellIndex) => (
                        <div key={cellIndex} className="h-3.5 flex-1 animate-pulse rounded bg-secondary" />
                    ))}
                </div>
            ))}
        </div>
    );
}
