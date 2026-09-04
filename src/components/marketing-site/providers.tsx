"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

import { ShaderVariantProvider } from "@/components/marketing-site/shader-variant-context";
import { SmoothScroll } from "@/components/marketing-site/smooth-scroll";
import { ReducedMotionProvider } from "@/lib/marketing/motion";

/**
 * What the marketing site needs wrapped around it, and what it deliberately
 * does not.
 *
 * ## No `ThemeProvider` here
 *
 * The template shipped one. `src/app/layout.tsx` already mounts `next-themes`
 * for the whole process, and two providers on one `<html>` fight over the same
 * class and the same storage key — the second one wins intermittently, which
 * reads as a theme that flickers rather than as a bug with a cause.
 *
 * There would be nothing to win anyway. Ours renders `light-mode` / `dark-mode`
 * as the class, not `light` / `dark`, so every `.dark` rule the template carries
 * could never match. The site is light-only, which is what the console already
 * decided for a reason written down there — and the hero is dark regardless,
 * because the shader is.
 *
 * The dark tokens stay in `marketing.css` ready for the day that changes; what
 * is gone is the switch, because a control that cannot change anything is worse
 * than no control.
 *
 * ## The palette switcher is gone too
 *
 * Five shader variants is a template demonstrating what it can do. A company has
 * one, and ours is drawn from the mark — see `lib/marketing/shader-variants.ts`.
 * The provider stays because the hero, the value-prop and the final CTA all read
 * from it; it now has one thing to hand them.
 */
export function MarketingProviders({ children }: { children: ReactNode }): ReactNode {
    return (
        <ReducedMotionProvider>
            <MotionConfig reducedMotion="user">
                <ShaderVariantProvider>
                    <SmoothScroll>{children}</SmoothScroll>
                </ShaderVariantProvider>
            </MotionConfig>
        </ReducedMotionProvider>
    );
}
