"use client";

/**
 * Chrome around the platform portal.
 *
 * **The same shell as the console**, deliberately — `SidebarNavigationSectionsSubheadings`
 * with different sections, not a second layout. I first built this as a thin
 * top bar on the reasoning that an operator should be able to tell at a glance
 * that they had left a workspace. That was wrong twice over: it read as
 * unfinished, and it would have read worse with six sections in it. What tells
 * you which product you are in is the sidebar's own heading and what the
 * sections contain, not a different arrangement of the page.
 *
 * It is also one less thing to keep in step. A second layout is a second place
 * to fix a collapse bug, a second set of spacing decisions, and a second answer
 * to how a screen scrolls.
 *
 * ## Still a different product
 *
 * Separate route group, separate hostname, and no `x-org-id` on any request —
 * see `src/middleware.ts` and `asOperator()`. An operator is a member of no
 * tenant, so a console session's storage cannot reach this and every query goes
 * through a definer guarded by `is_platform_admin()`.
 *
 * ## The gate here is a courtesy
 *
 * `is_platform_admin()` is the first statement of every operator function in
 * the database. This shell refusing a non-operator is so they see an
 * explanation rather than a screen of failed requests — it is not what makes
 * them unable to do anything.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/base/buttons/button";
import { ChevronLeftDouble, ChevronRightDouble } from "@/components/icons";
import { PLATFORM_SECTIONS } from "@/components/application/app-navigation/platform-nav";
import { SidebarNavigationSectionsSubheadings } from "@/components/application/app-navigation/sidebar-navigation/sidebar-sections-subheadings";
import { SignInScreen } from "@/components/application/auth/sign-in-screen";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { useNavCollapse } from "@/hooks/use-nav-collapse";
import { useSession } from "@/hooks/use-session";

export function PlatformShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const { session, isReady, isOperator, signOut } = useSession();
    const nav = useNavCollapse(false);

    // Both gates, as the console does: the stored session is only readable
    // after mount, and the pin preference is read in an effect — rendering
    // before either lands flashes the wrong thing for a frame.
    if (!isReady || !nav.isReady) {
        return <div className="min-h-dvh bg-primary" />;
    }

    if (!session) {
        return <SignInScreen />;
    }

    if (!isOperator) {
        return (
            <main className="grid min-h-dvh place-items-center bg-primary p-6">
                <div className="flex max-w-md flex-col gap-3 border border-secondary p-6">
                    <h1 className="text-lg font-semibold text-primary">Not for this account</h1>
                    <p className="text-sm text-tertiary">
                        This portal manages the workspaces on this installation rather than
                        anything inside one. {session.email} is not an operator.
                    </p>
                    <div className="flex gap-2 pt-2">
                        <Button size="sm" href="/">
                            Go to the console
                        </Button>
                        <Button size="sm" color="secondary" onClick={signOut}>
                            Sign out
                        </Button>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-primary lg:flex-row">
            <SidebarNavigationSectionsSubheadings
                activeUrl={pathname}
                items={PLATFORM_SECTIONS}
                isCollapsed={nav.isCollapsed}
                contextLabel="Sarvathra Platform"
            />
            {/* The same divider and collapse handle the console has. It lives
                out here rather than in the sidebar because the sidebar is
                `overflow-hidden`, so anything on its outer edge is clipped. */}
            <div className="relative hidden w-px shrink-0 bg-secondary lg:block">
                <Tooltip
                    title={nav.isCollapsed ? "Show labels" : "Collapse to icons"}
                    description="Remembered on this browser."
                    placement="right"
                >
                    {/* `TooltipTrigger`, not a plain `<button>`: React Aria's
                        `TooltipTrigger` passes its hover and focus props to a
                        React Aria `Button`, and a DOM button never receives
                        them — so this tooltip had never once opened. It does
                        not error, it simply does nothing, which is why it
                        survived. */}
                    <TooltipTrigger
                        aria-label={
                            nav.isCollapsed
                                ? "Show navigation labels"
                                : "Collapse navigation to icons"
                        }
                        onClick={() => nav.setCollapsed(!nav.isCollapsed)}
                        className="absolute top-1/2 left-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-none bg-primary text-fg-quaternary ring-1 ring-secondary transition duration-100 ease-linear hover:text-fg-secondary hover:ring-primary focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                        {nav.isCollapsed ? (
                            <ChevronRightDouble className="size-3.5" aria-hidden="true" />
                        ) : (
                            <ChevronLeftDouble className="size-3.5" aria-hidden="true" />
                        )}
                    </TooltipTrigger>
                </Tooltip>
            </div>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        </div>
    );
}
