"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SidebarNavigationSectionsSubheadings } from "@/components/application/app-navigation/sidebar-navigation/sidebar-sections-subheadings";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { ChevronLeftDouble, ChevronRightDouble } from "@/components/icons";
import { isFullScreenRoute, NAV_SECTIONS, SPLIT_SCREEN_ROUTES } from "@/components/application/app-navigation/vokoo-nav";
import { SignInScreen } from "@/components/application/auth/sign-in-screen";
import { useNavCollapse } from "@/hooks/use-nav-collapse";
import { useSession } from "@/hooks/use-session";

/**
 * Chrome around every console screen: sidebar, and the auth gate.
 *
 * The gate lives here rather than in each screen so a new route cannot ship
 * unauthenticated by omission — a screen has to be deliberately mounted outside
 * this shell to escape it.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const { session, isReady } = useSession();
    const nav = useNavCollapse(SPLIT_SCREEN_ROUTES.has(pathname));

    // The stored session is only readable after mount. Rendering sign-in during
    // that gap would flash the login form on every reload for a signed-in user.
    // Both gates together: the pin preference is read from storage in an
    // effect, so rendering before it lands would show the rail for one frame to
    // a reader who has pinned the nav open.
    if (!isReady || !nav.isReady) {
        return <div className="min-h-dvh bg-primary" />;
    }

    if (!session) {
        return <SignInScreen />;
    }

    // The auth gate above still applies: this returns the screen without the
    // navigation, not outside the shell. A route that skipped the shell to get
    // the width would also skip the gate, which is how a screen ships
    // unauthenticated by omission.
    if (isFullScreenRoute(pathname)) {
        return <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-primary">{children}</main>;
    }

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-primary lg:flex-row">
            <SidebarNavigationSectionsSubheadings
                activeUrl={pathname}
                items={NAV_SECTIONS}
                isCollapsed={nav.isCollapsed}
            />
            {/* The divider between the sidebar and the screen, and the handle
                that collapses it. It lives here rather than inside the sidebar
                because the sidebar is `overflow-hidden` — pinning its header and
                footer means anything on its outer edge is clipped. */}
            {nav.isReady ? (
                <div className="relative hidden w-px shrink-0 bg-secondary lg:block">
                    <Tooltip
                        title={nav.isCollapsed ? "Show labels" : "Collapse to icons"}
                        description="Remembered on this browser."
                        placement="right"
                    >
                        <button
                            type="button"
                            aria-label={nav.isCollapsed ? "Show navigation labels" : "Collapse navigation to icons"}
                            onClick={() => nav.setCollapsed(!nav.isCollapsed)}
                            // Always visible, quietly. It was revealed on
                            // hover of the divider, which is one pixel wide —
                            // a target nobody can hit, so the control may as
                            // well not have existed.
                            // `rounded-none`, not `rounded-full`: this is a control, and
                            // controls in this app are square. `--radius-full`
                            // is kept for avatars and status dots, where the
                            // radius is the shape — a button is neither.
                            className="absolute top-1/2 left-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-none bg-primary text-fg-quaternary ring-1 ring-secondary transition duration-100 ease-linear hover:text-fg-secondary hover:ring-primary focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                            {/* Points the way it will move. */}
                            {nav.isCollapsed ? (
                                <ChevronRightDouble className="size-3.5" aria-hidden="true" />
                            ) : (
                                <ChevronLeftDouble className="size-3.5" aria-hidden="true" />
                            )}
                        </button>
                    </Tooltip>
                </div>
            ) : null}

            {/* The screen owns its own scrolling: a flex column whose header
                is flex-none and whose body scrolls, so the header stays put. */}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-out motion-reduce:transition-none">{children}</main>
        </div>
    );
}
