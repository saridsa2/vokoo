"use client";

import { ChevronLeftDouble, ChevronRightDouble } from "@/components/icons";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { VokooLogo } from "@/components/foundations/logo/vokoo-logo";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { MobileNavigationHeader } from "../base-components/mobile-header";
import { ThemeToggle } from "../base-components/theme-toggle";
import { VokooAccountCard } from "../base-components/vokoo-account-card";
import { NavItemBase } from "../base-components/nav-item";
import type { NavItemType } from "../config";

interface SidebarNavigationSectionsSubheadingsProps {
    /** URL of the currently active item. */
    activeUrl?: string;
    /** List of items to display. */
    items: Array<{ label: string; items: NavItemType[] }>;
    /** Render as an icon rail. The shell decides; this only draws it. */
    isCollapsed?: boolean;
    /**
     * What sits above the account card, in place of the workspace name.
     *
     * The platform portal has no workspace — an operator is a member of none —
     * and without this the card would print whichever workspace they happen to
     * belong to, at the foot of a screen that is about all of them. Passed by
     * the shell rather than sniffed from the route, for the reason the canvas
     * already records: a component that guesses its context from a path is one
     * that guesses wrong the day the path changes.
     */
    contextLabel?: string;
}

export const SidebarNavigationSectionsSubheadings = ({
    activeUrl = "/",
    items,
    isCollapsed = false,
    contextLabel,
}: SidebarNavigationSectionsSubheadingsProps) => {
    // 68px fits a 20px icon with the same padding the expanded item uses, so
    // the icons do not shift horizontally when the rail expands.
    const MAIN_SIDEBAR_WIDTH = isCollapsed ? 68 : 276;

    const content = (
        <aside
            style={
                {
                    "--width": `${MAIN_SIDEBAR_WIDTH}px`,
                } as React.CSSProperties
            }
            // 200ms rather than the 100ms used for hover states: this moves 208px
            // and a fast transition on that distance reads as a jump. `ease-out`
            // so it settles rather than stops.
            className="relative flex h-full w-full max-w-full flex-col overflow-hidden bg-primary pt-4 shadow-xs ring-secondary transition-[width] duration-200 ease-out ring-inset motion-reduce:transition-none lg:w-(--width) lg:rounded-xl lg:ring-1"
        >
            {isCollapsed ? (
                <div className="flex shrink-0 flex-col items-center gap-2 px-2">
                    <VokooLogo className="h-6" iconOnly />
                    <ThemeToggle />
                </div>
            ) : (
                <div className="flex shrink-0 items-center justify-between gap-5 px-4 lg:pl-5">
                    <VokooLogo className="h-6" />
                    <ThemeToggle />
                </div>
            )}

            <ul className="scrollbar-hide mt-6 min-h-0 flex-1 overflow-x-hidden overflow-y-auto md:mt-5">
                {items.map((group) => (
                    <li key={group.label}>
                        {/* The subheading is the first thing to go: it labels a
                            group that is now three icons, and at rail width it
                            would truncate to two letters and explain nothing. */}
                        {!isCollapsed && (
                            <div className="px-5 pb-1">
                                <p className="text-xs font-bold text-quaternary uppercase">{group.label}</p>
                            </div>
                        )}
                        <ul className={isCollapsed ? "flex flex-col items-center gap-0.5 px-2 pb-4" : "px-4 pb-5"}>
                            {group.items.map((item) =>
                                isCollapsed ? (
                                    // The label is hidden, so it has to arrive
                                    // some other way — hover for a sighted
                                    // reader, aria-label for everyone else.
                                    <li key={item.label} className="w-full">
                                        <Tooltip title={item.label} placement="right">
                                            <NavItemBase
                                                icon={item.icon}
                                                href={item.href}
                                                type="link"
                                                iconOnly
                                                current={item.href === activeUrl}
                                            >
                                                {item.label}
                                            </NavItemBase>
                                        </Tooltip>
                                    </li>
                                ) : (
                                    <li key={item.label} className="py-0.25">
                                        <NavItemBase
                                            icon={item.icon}
                                            href={item.href}
                                            badge={item.badge}
                                            type="link"
                                            current={item.href === activeUrl}
                                        >
                                            {item.label}
                                        </NavItemBase>
                                    </li>
                                ),
                            )}
                        </ul>
                    </li>
                ))}
            </ul>

            <div
                className={
                    isCollapsed
                        ? "flex shrink-0 flex-col items-center gap-3 px-2 py-4"
                        : "flex shrink-0 flex-col gap-5 px-2 py-4 lg:gap-6 lg:px-4 lg:py-4"
                }
            >
                <VokooAccountCard iconOnly={isCollapsed} contextLabel={contextLabel} />
            </div>

        </aside>
    );

    return (
        <>
            {/* Mobile header navigation */}
            <MobileNavigationHeader>{content}</MobileNavigationHeader>

            {/* Desktop sidebar navigation */}
            <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:py-1 lg:pl-1">{content}</div>

            {/* Placeholder to take up physical space because the real sidebar has `fixed` position. */}
            <div
                style={{
                    paddingLeft: MAIN_SIDEBAR_WIDTH + 4,
                }}
                className="invisible hidden lg:sticky lg:top-0 lg:bottom-0 lg:left-0 lg:block"
            />
        </>
    );
};
