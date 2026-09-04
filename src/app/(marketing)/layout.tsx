import type { ReactNode } from "react";

import { MarketingProviders } from "@/components/marketing-site/providers";
import { SkipToContent } from "@/components/marketing-site/skip-to-content";

/**
 * The public site at `sarvathra.ai`.
 *
 * A route group rather than a second app, for the reason `(console)` and
 * `(platform)` are: one Next process already serves two products split by
 * hostname, and `src/middleware.ts` is where that split is decided. A third
 * hostname is a third entry there, not a third deployment.
 *
 * ## `data-site="marketing"` is load-bearing
 *
 * It is what `src/styles/marketing.css` scopes every token to, including the
 * radii — the console squares every corner and this site must not be square.
 * Remove the attribute and the page still renders, in the console's palette,
 * with square cards. That is the failure to look for.
 *
 * ## No `<html>` here
 *
 * A nested layout cannot emit one while `src/app/layout.tsx` exists, and it
 * should not: the fonts, the theme provider and the notification queue are all
 * decided up there and this page wants the first two.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
    return (
        <div data-site="marketing" className="min-h-dvh bg-background font-sans text-foreground">
            <MarketingProviders>
                <SkipToContent />
                {children}
            </MarketingProviders>
        </div>
    );
}
