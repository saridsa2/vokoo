import type { ReactNode } from "react";

/**
 * Standard header for a console screen.
 *
 * Shared so title size, description colour and action placement stay identical
 * across twenty-odd screens — the details that make a console feel like one
 * product rather than a collection of pages.
 */
export function ScreenHeader({
    title,
    description,
    actions,
}: {
    title: string;
    description?: string;
    actions?: ReactNode;
}) {
    return (
        <header className="flex flex-col gap-4 border-b border-secondary px-6 py-5 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
                <h1 className="text-xl font-semibold text-primary">{title}</h1>
                {description && <p className="mt-1 text-sm text-tertiary">{description}</p>}
            </div>
            {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
        </header>
    );
}
