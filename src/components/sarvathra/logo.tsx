import Image from "next/image";
import type { ReactNode } from "react";

/**
 * The mark and the wordmark.
 *
 * The template drew its logo as a clipped square in `--foreground`, which is a
 * placeholder for a company that has one. We have a real mark, so it goes in —
 * as an image rather than a chamfered div, and the chamfer stays on the
 * buttons where it is the template's idea rather than ours.
 *
 * Unlike the previous site's nav there is no `brightness(0) invert(1)` here:
 * that existed to knock the mark to white over a saturated shader. This
 * template's hero is the page's own background, so the mark shows in its own
 * teal-to-blue and needs no filter in either theme.
 */
export function Logo(): ReactNode {
    return (
        <a
            href="#top"
            className="focus-ring group inline-flex items-center gap-2.5"
            aria-label="Sarvathra home"
        >
            <Image
                src="/sarvathra-mark.png"
                alt=""
                width={28}
                height={28}
                priority
                className="h-7 w-7 transition-transform duration-300 group-hover:rotate-3"
            />
            <span className="text-[17px] font-semibold tracking-tight">Sarvathra</span>
        </a>
    );
}
