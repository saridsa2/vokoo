"use client";

import Image from "next/image";
import type { HTMLAttributes } from "react";
import { cx } from "@/utils/cx";

/**
 * Sarvathra.
 *
 * The mark is the S drawn as concentric arcs — a fingerprint and a set of sound
 * waves at once, which is a fair picture of a product that answers the phone.
 *
 * **It is a raster image, not vector**, and deliberately used as one: the source
 * is 1824×2350 with a real alpha channel, so at the sizes a console renders it
 * there is far more resolution than needed. `sarvathra-mark.png` is 96px tall
 * and `@2x` is 192, which covers every place it appears here. A vector version
 * is worth having for anything printed or scaled past that; auto-tracing this
 * one would produce a heavy, lossy approximation of gradient arcs rather than a
 * clean redraw, so it should come from whoever authored the mark.
 *
 * The wordmark stays live text rather than paths, so it remains selectable and
 * follows the theme.
 */
export const VokooLogo = ({ className, iconOnly, ...props }: HTMLAttributes<HTMLDivElement> & { iconOnly?: boolean }) => (
    <div {...props} className={cx("flex h-8 w-max items-center gap-2", className)}>
        <Image
            src="/sarvathra-mark.png"
            alt="Sarvathra"
            width={25}
            height={32}
            priority
            // Height-driven: the mark is taller than it is wide (1824×2350), so
            // constraining the height is what keeps it aligned with the
            // wordmark's cap height rather than with its own bounding box.
            className="h-7 w-auto shrink-0"
        />
        {/* Nine characters, so the tracking is tighter than the five-letter mark
            it replaces — at 0.16em "SARVATHRA" overruns the sidebar. */}
        {!iconOnly && <span className="text-md font-bold tracking-[0.09em] text-primary">SARVATHRA</span>}
    </div>
);
