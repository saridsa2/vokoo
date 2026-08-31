import type { ReactNode } from "react";

/**
 * Standard header for a console screen.
 *
 * Shared so title size, description colour and action placement stay identical
 * across twenty-odd screens — the details that make a console feel like one
 * product rather than a collection of pages.
 *
 * Pinned. `flex-none` inside the shell's flex column keeps it at the top while
 * the screen body scrolls under it, so the title and the search stay reachable
 * down a long table. Composer and Agents already worked this way; this is that
 * arrangement made general.
 */
export function ScreenHeader({
    title,
    description,
    search,
    actions,
}: {
    title: string;
    description?: string;
    /**
     * Screen-level search. Lives in the header rather than the scrolling body
     * so it does not leave with the rows it filters.
     */
    search?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <header className="flex flex-none flex-col gap-4 border-b border-secondary bg-primary px-6 py-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
                <h1 className="text-xl font-semibold text-primary">{title}</h1>
                {description && <p className="mt-1 text-sm text-tertiary">{description}</p>}
            </div>
            {(search || actions) && (
                <div className="flex flex-none items-center gap-3">
                    {search}
                    {actions}
                </div>
            )}
        </header>
    );
}
