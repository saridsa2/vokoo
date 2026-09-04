/**
 * A table whose rows can open.
 *
 * `Table` in this folder is React Aria's, and React Aria Components 1.20 has no
 * `colSpan` on a cell — so a full-width detail row cannot be put into its
 * collection, and an expanding row is exactly that. Rather than each screen
 * that needs one writing its own markup, it is written once here.
 *
 * The classes are the ones `Table` uses, so the two look the same beside each
 * other. What is lost is React Aria's roving focus between cells; what replaces
 * it is a real disclosure button per row carrying `aria-expanded` and
 * `aria-controls`, which is the correct affordance for opening something.
 *
 * Use `Table` when rows do not open. Use this when they do.
 */

import { Fragment, type ReactNode } from "react";

import { ChevronRight } from "@/components/icons";
import { cx } from "@/utils/cx";

export type DataColumn<T> = {
    id: string;
    label: string;
    render: (row: T) => ReactNode;
    /**
     * Classes for the header and every cell in this column — which is how a
     * column is hidden on a narrow window, since hiding only the cells would
     * leave the header behind and shift every row.
     */
    className?: string;
};

type DataTableProps<T> = {
    rows: T[];
    columns: DataColumn<T>[];
    /** Read by screen readers in place of a caption. */
    label: string;
    /** The row whose detail is open, if any. Controlled by the caller. */
    expandedId?: string | null;
    onToggleExpanded?: (id: string) => void;
    /** Absent means rows do not open, and no disclosure column is drawn. */
    renderExpanded?: (row: T) => ReactNode;
    /**
     * Enough width to keep columns from crushing before the table scrolls
     * sideways. A Tailwind class, because it depends on what is in the columns.
     */
    minWidthClassName?: string;
    /** Shown in place of the table when there is nothing. */
    empty?: ReactNode;
};

export const DataTable = <T extends { id: string }>({
    rows,
    columns,
    label,
    expandedId = null,
    onToggleExpanded,
    renderExpanded,
    minWidthClassName = "min-w-[44rem]",
    empty,
}: DataTableProps<T>) => {
    const expandable = Boolean(renderExpanded && onToggleExpanded);
    // The disclosure column exists in the header too, or the header and the
    // body would be a column out of step.
    const columnCount = columns.length + (expandable ? 1 : 0);

    if (rows.length === 0 && empty) return <>{empty}</>;

    return (
        // **The card is the scroll container, and the header stays put.**
        //
        // It used to size itself to every row and hand the overflow upward, so
        // the column headings scrolled off at row eight and the rest of the
        // table was a grid of unlabelled values. `flex-1 min-h-0` makes the card
        // take the height it is given instead of the height it wants, and the
        // body scrolls inside it.
        //
        // `min-h-0` is the half that is easy to miss: a flex item will not
        // shrink below its content without it, so the card would still grow to
        // 23 rows and scroll nothing. Both axes scroll here, which is why the
        // inner element is `overflow-auto` rather than `overflow-x-auto` — a
        // wide table still scrolls sideways within its own card.
        //
        // In a parent that is not a flex container, `flex-1` and `min-h-0` are
        // inert and the card sizes to its content as it always did.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
            <div className="min-h-0 flex-1 overflow-auto">
                <table className={cx("w-full border-collapse", minWidthClassName)}>
                    <caption className="sr-only">{label}</caption>
                    {/* `sticky` goes on the cells, not on `<thead>` or
                        `<tr>`: a table row is not a positioned box in every
                        engine, and the versions that ignore it fail silently —
                        the header simply scrolls away and nothing says why.

                        The background is opaque and required. A transparent
                        sticky header lets the rows travel visibly underneath
                        it, which reads as a rendering fault rather than as a
                        pinned heading. */}
                    <thead className="sticky top-0 z-10">
                        <tr className="border-b border-secondary bg-secondary">
                            {expandable ? (
                                <th scope="col" className="sticky top-0 w-10 bg-secondary px-3 py-3" />
                            ) : null}
                            {columns.map((column) => (
                                <th
                                    key={column.id}
                                    scope="col"
                                    className={cx(
                                        "sticky top-0 bg-secondary px-6 py-3 text-left text-xs font-semibold whitespace-nowrap text-tertiary",
                                        column.className,
                                    )}
                                >
                                    {column.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const open = expandedId === row.id;
                            return (
                                <Fragment key={row.id}>
                                    <tr
                                        className={cx(
                                            "border-b border-secondary transition-colors duration-100 ease-linear",
                                            expandable && "hover:bg-secondary",
                                            open && "bg-secondary",
                                        )}
                                    >
                                        {expandable ? (
                                            <td className="w-10 px-3 py-4">
                                                <button
                                                    type="button"
                                                    onClick={() => onToggleExpanded?.(row.id)}
                                                    aria-expanded={open}
                                                    aria-controls={`row-detail-${row.id}`}
                                                    aria-label={open ? "Hide details" : "Show details"}
                                                    className="flex size-6 items-center justify-center rounded-md text-fg-quaternary outline-focus-ring transition duration-100 ease-linear hover:bg-primary hover:text-fg-secondary focus-visible:outline-2"
                                                >
                                                    {/* Right when closed, down when open — the direction
                                                        a disclosure points is where its content will
                                                        appear. Rotating a down chevron to up instead
                                                        reads as "collapse this", which is a different
                                                        control. */}
                                                    <ChevronRight
                                                        className={cx(
                                                            "size-4 transition-transform duration-100 ease-linear",
                                                            open && "rotate-90",
                                                        )}
                                                        aria-hidden="true"
                                                    />
                                                </button>
                                            </td>
                                        ) : null}

                                        {columns.map((column) => (
                                            <td
                                                key={column.id}
                                                className={cx("px-6 py-4 text-sm text-tertiary", column.className)}
                                            >
                                                {column.render(row)}
                                            </td>
                                        ))}
                                    </tr>

                                    {open && renderExpanded ? (
                                        <tr id={`row-detail-${row.id}`} className="border-b border-secondary bg-secondary">
                                            {/* The whole reason this component exists. */}
                                            <td colSpan={columnCount} className="px-6 pt-0 pb-5">
                                                {renderExpanded(row)}
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
