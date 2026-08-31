"use client";

import { ChevronLeftDouble, ChevronRightDouble, SearchLg } from "@/components/icons";
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
    /** Render as an icon rail. Screens that are themselves a split ask for this. */
    isCollapsed?: boolean;
    /** Called when the reader pins the labelled nav open, or unpins it. */
    onPinnedChange?: (pinned: boolean) => void;
    /** Whether the labelled nav is currently pinned. */
    isPinned?: boolean;
}

export const SidebarNavigationSectionsSubheadings = ({
    activeUrl = "/",
    items,
    isCollapsed = false,
    isPinned = false,
    onPinnedChange,
}: SidebarNavigationSectionsSubheadingsProps) => {
    // 68px fits a 20px icon with the same padding the expanded item uses, so
    // the icons do not shift horizontally when the rail expands.
    const MAIN_SIDEBAR_WIDTH = isCollapsed ? 68 : 276;

    // Only offered where it does something. On a single-pane screen the nav is
    // already expanded, so a pin control there would be a toggle with no
    // visible effect until the reader navigated somewhere else.
    const canPin = !!onPinnedChange && (isCollapsed || isPinned);

    const content = (
        <aside
            style={
                {
                    "--width": `${MAIN_SIDEBAR_WIDTH}px`,
                } as React.CSSProperties
            }
            className="flex h-full w-full max-w-full flex-col justify-between overflow-x-hidden overflow-y-auto bg-primary pt-4 shadow-xs ring-secondary ring-inset lg:w-(--width) lg:rounded-xl lg:ring-1"
        >
            {isCollapsed ? (
                <div className="flex flex-col items-center gap-2 px-2">
                    <VokooLogo className="h-6" iconOnly />
                    <ThemeToggle />
                </div>
            ) : (
                <div className="flex items-center justify-between gap-5 px-4 lg:pl-5">
                    <VokooLogo className="h-6" />
                    <div className="flex items-center gap-1">
                        <ThemeToggle />
                        <ButtonUtility size="xs" color="tertiary" tooltip="Search" icon={SearchLg} />
                    </div>
                </div>
            )}

            <ul className="mt-6 md:mt-5">
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
                        ? "mt-auto flex flex-col items-center gap-3 px-2 py-4"
                        : "mt-auto flex flex-col gap-5 px-2 py-4 lg:gap-6 lg:px-4 lg:py-4"
                }
            >
                {canPin && (
                    <Tooltip
                        title={isPinned ? "Collapse navigation" : "Keep navigation open"}
                        description={isPinned ? undefined : "Stays open on split screens, on this browser."}
                        placement="right"
                    >
                        <ButtonUtility
                            size="xs"
                            color="tertiary"
                            icon={isPinned ? ChevronLeftDouble : ChevronRightDouble}
                            aria-label={isPinned ? "Collapse navigation" : "Keep navigation open"}
                            onClick={() => onPinnedChange?.(!isPinned)}
                            className={isCollapsed ? undefined : "self-start"}
                        />
                    </Tooltip>
                )}
                <VokooAccountCard iconOnly={isCollapsed} />
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
