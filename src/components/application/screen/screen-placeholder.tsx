import { ScreenHeader } from "./screen-header";

/**
 * Stand-in for a screen that has not been built yet.
 *
 * Says so, and names the endpoint it will read, rather than rendering invented
 * rows. Fake data in a placeholder is worse than an empty state: it looks
 * finished, so it never gets finished, and nobody can tell which screens are
 * wired to the API.
 */
export function ScreenPlaceholder({
    title,
    description,
    resource,
}: {
    title: string;
    description?: string;
    /** API resource this screen will read, e.g. "tools". */
    resource?: string;
}) {
    return (
        <>
            <ScreenHeader title={title} description={description} />
            <div className="p-6">
                <div className="rounded-xl border border-dashed border-secondary p-12 text-center">
                    <p className="text-sm font-medium text-primary">{title} is not built yet</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-tertiary">
                        {resource ? (
                            <>
                                It will read <code className="font-mono text-xs text-secondary">/api/v1/{resource}</code>.
                            </>
                        ) : (
                            "This screen has no backing endpoint yet."
                        )}
                    </p>
                </div>
            </div>
        </>
    );
}
