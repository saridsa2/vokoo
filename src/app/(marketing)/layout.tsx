import type { ReactNode } from "react";

import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";

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
 * ## The three fonts are loaded here, not at the root
 *
 * The Security template sets headings in Source Serif, body in Geist and labels
 * in Geist Mono. None of the three is used by the console, and a font declared
 * in the root layout is fetched for every screen of it. Declaring them in this
 * route group keeps that cost on the one site that renders them, and the
 * variables are what `marketing.css` resolves `--font-serif` from.
 *
 * ## No `<html>` here
 *
 * A nested layout cannot emit one while `src/app/layout.tsx` exists, and it
 * should not: the theme provider and the notification queue are decided up
 * there.
 */

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif" });

export default function MarketingLayout({ children }: { children: ReactNode }) {
    return (
        <div
            data-site="marketing"
            className={[
                geistSans.variable,
                geistMono.variable,
                sourceSerif.variable,
                "min-h-dvh bg-background font-sans text-foreground",
            ].join(" ")}
        >
            <MarketingProviders>
                <SkipToContent />
                {children}
            </MarketingProviders>
        </div>
    );
}
