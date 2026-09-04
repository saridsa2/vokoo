"use client";

import type { CSSProperties, FC, HTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { ChevronDown, Share04 } from "@/components/icons";
import { Link as AriaLink } from "react-aria-components";
import { Badge } from "@/components/base/badges/badges";
import { cx, sortCx } from "@/utils/cx";
import { navAccent } from "@/components/application/app-navigation/nav-accent";

const styles = sortCx({
    root: "group relative flex max-h-9 w-full cursor-pointer items-center rounded-md bg-primary outline-focus-ring transition duration-100 ease-linear select-none hover:bg-primary_hover focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2",
    rootSelected: "bg-secondary hover:bg-secondary_hover",
});

interface NavItemBaseProps {
    /** Whether the nav item shows only an icon. */
    iconOnly?: boolean;
    /** Whether the collapsible nav item is open. */
    open?: boolean;
    /** URL to navigate to when the nav item is clicked. */
    href?: string;
    /** Type of the nav item. */
    type: "link" | "collapsible" | "collapsible-child";
    /** Icon component to display. */
    icon?: FC<HTMLAttributes<HTMLOrSVGElement>>;
    /** Badge to display. */
    badge?: ReactNode;
    /** Whether the nav item is currently active. */
    current?: boolean;
    /** Whether to truncate the label text. */
    truncate?: boolean;
    /** Handler for click events. */
    onClick?: MouseEventHandler;
    /** Content to display. */
    children?: ReactNode;
}

export const NavItemBase = ({ current, type, badge, href, icon: Icon, children, truncate = true, iconOnly, onClick }: NavItemBaseProps) => {
    // `iconOnly` was declared in the props and never read, so a caller asking
    // for a collapsed rail got a full-width item with a label. Honoured here:
    // the label carries the right margin, so without one the icon must not.
    // The colour this destination takes when it is the one you are on. Our
    // icons are Font Awesome duotone, so both layers follow from two variables
    // — no second set of files, unlike the `icon-*-active.svg` pattern this is
    // borrowed from.
    const accent = current ? navAccent(href) : undefined;

    const iconElement = Icon && (
        <Icon
            aria-hidden="true"
            className={cx(
                "size-5 shrink-0 text-fg-quaternary transition-inherit-all group-hover/item:text-fg-quaternary_hover",
                !iconOnly && "mr-2",
                current && "text-fg-quaternary_hover",
                // **No `fa-beat` here, and the reason is worth keeping.** It was
                // added to mark the arrival once — `--fa-animation-iteration-count: 1`
                // — on the reasoning that a permanent animation on a permanently
                // selected item is movement in the corner of the eye.
                //
                // The reasoning was right and the mechanism could not deliver
                // it. A CSS animation restarts whenever its element is
                // re-rendered, and this icon re-renders whenever the sidebar
                // does — a session refresh, a collapse, a route change, any
                // parent state. So "once, on arrival" became exactly the
                // permanent bounce it was written to avoid.
                //
                // An animation that cannot be guaranteed to run once should not
                // be run at all. The colour pair already says which item is
                // selected, and it says it without moving.
            )}
            style={
                accent
                    ? ({
                          "--fa-primary-color": accent.primary,
                          "--fa-secondary-color": accent.secondary,
                          // The shim dims the secondary layer for legibility on
                          // a neutral icon. A selected one is carrying a colour
                          // pair on purpose, so it is shown at full strength.
                          "--fa-secondary-opacity": "1",
                      } as CSSProperties)
                    : undefined
            }
        />
    );

    const badgeElement =
        badge && (typeof badge === "string" || typeof badge === "number") ? (
            <Badge className="ml-3" color="gray" type="pill-color" size="sm">
                {badge}
            </Badge>
        ) : (
            badge
        );

    const labelElement = (
        <span
            className={cx(
                "flex-1 text-sm font-semibold text-secondary transition-inherit-all group-hover/item:text-secondary_hover",
                truncate && "truncate",
                current && "text-secondary_hover",
            )}
        >
            {children}
        </span>
    );

    const isExternal = href && href.startsWith("http");
    const externalIcon = isExternal && <Share04 className="size-4 stroke-[2.5px] text-fg-quaternary" />;

    if (type === "collapsible") {
        return (
            <summary className={cx("p-2", styles.root, current && styles.rootSelected)} onClick={onClick}>
                {iconElement}

                {labelElement}

                {badgeElement}

                <ChevronDown aria-hidden="true" className="ml-3 size-4 shrink-0 stroke-[2.5px] text-fg-quaternary in-open:-scale-y-100" />
            </summary>
        );
    }

    if (type === "collapsible-child") {
        return (
            <AriaLink
                href={href!}
                target={isExternal ? "_blank" : "_self"}
                rel="noopener noreferrer"
                className={cx("py-2 pr-3 pl-10", styles.root, current && styles.rootSelected)}
                onClick={onClick}
                aria-current={current ? "page" : undefined}
            >
                {labelElement}
                {externalIcon}
                {badgeElement}
            </AriaLink>
        );
    }

    if (iconOnly) {
        return (
            <AriaLink
                href={href!}
                target={isExternal ? "_blank" : "_self"}
                rel="noopener noreferrer"
                className={cx("group/item justify-center p-2", styles.root, current && styles.rootSelected)}
                onClick={onClick}
                aria-current={current ? "page" : undefined}
                // The label is the only thing naming this destination, so with
                // it hidden it has to reach assistive technology some other way.
                aria-label={typeof children === "string" ? children : undefined}
            >
                {iconElement}
            </AriaLink>
        );
    }

    return (
        <AriaLink
            href={href!}
            target={isExternal ? "_blank" : "_self"}
            rel="noopener noreferrer"
            className={cx("group/item p-2", styles.root, current && styles.rootSelected)}
            onClick={onClick}
            aria-current={current ? "page" : undefined}
        >
            {iconElement}
            {labelElement}
            {externalIcon}
            {badgeElement}
        </AriaLink>
    );
};
