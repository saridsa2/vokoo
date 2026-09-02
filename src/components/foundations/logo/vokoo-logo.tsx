"use client";

import type { HTMLAttributes } from "react";
import { cx } from "@/utils/cx";

/**
 * Sarvathra wordmark.
 *
 * The mark is three bars of unequal height — a voice waveform, which is what
 * the product actually moves around. Drawn with brand tokens rather than
 * baked-in hex so it follows the theme like everything else, and the wordmark
 * is live text rather than SVG paths so it stays selectable at any zoom.
 *
 * The mark is inherited from VoKoo and is deliberately unchanged: an attempt at
 * a Sarvathra mark (eight spokes for "everywhere") read as a loading spinner,
 * which in an app that now uses `fa-spin` is the one thing it must not be.
 */
export const VokooLogo = ({ className, iconOnly, ...props }: HTMLAttributes<HTMLDivElement> & { iconOnly?: boolean }) => (
    <div {...props} className={cx("flex h-8 w-max items-center gap-2", className)}>
        <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" aria-hidden="true">
            <rect x="2" y="7" width="3.4" height="6" rx="1.7" className="fill-brand-solid opacity-60" />
            <rect x="8.3" y="3" width="3.4" height="14" rx="1.7" className="fill-brand-solid" />
            <rect x="14.6" y="6" width="3.4" height="8" rx="1.7" className="fill-brand-solid opacity-60" />
        </svg>
        {/* Nine characters, so the tracking is tighter than the five-letter mark
            it replaces — at 0.16em "SARVATHRA" overruns the sidebar. */}
        {!iconOnly && <span className="text-md font-bold tracking-[0.09em] text-primary">SARVATHRA</span>}
    </div>
);
