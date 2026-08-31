"use client";

import { useState } from "react";
import type { FC, ReactNode } from "react";
import { ChevronDown } from "@/components/icons";
import { cx } from "@/utils/cx";

/**
 * Layout primitives for the agent editor, matching the reference console.
 *
 * The reference groups configuration three levels deep:
 *
 *   SECTION   an uppercase label with a rule running to the right edge
 *     CARD    a collapsible panel with a title and one line of description
 *       ROW   an icon, a title, a description, and its control on the right
 *
 * Building these once keeps every tab consistent. The alternative — laying out
 * each tab by hand — is how a settings screen ends up with four different row
 * heights and three different chevrons.
 */

/** `VOICE ─────────────` — an uppercase label with a rule to the right edge. */
export function ConfigSection({ icon: Icon, label, children }: { icon: FC<{ className?: string }>; label: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
                <Icon className="size-4 text-fg-quaternary" />
                <span className="text-xs font-medium tracking-wider text-quaternary uppercase">{label}</span>
                <div className="h-px flex-1 bg-border-secondary" />
            </div>
            <div className="flex flex-col gap-4">{children}</div>
        </section>
    );
}

/**
 * Collapsible panel.
 *
 * Uncontrolled by default so a tab can open the panel that matters and leave
 * the rest closed — the reference opens the primary card and collapses the
 * fallback ones, which keeps a long settings page scannable.
 */
export function ConfigCard({
    title,
    description,
    defaultOpen = true,
    children,
}: {
    title: string;
    description?: string;
    defaultOpen?: boolean;
    children: ReactNode;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <section className="rounded-xl ring-1 ring-secondary">
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                aria-expanded={isOpen}
                className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
            >
                <div className="min-w-0">
                    <h3 className="text-md font-semibold text-primary">{title}</h3>
                    {description && <p className="mt-0.5 text-sm text-tertiary">{description}</p>}
                </div>
                <ChevronDown
                    className={cx(
                        "mt-1 size-4 flex-none text-fg-quaternary transition duration-100 ease-linear",
                        isOpen && "rotate-180",
                    )}
                />
            </button>

            {isOpen && <div className="flex flex-col gap-5 border-t border-secondary px-5 py-5">{children}</div>}
        </section>
    );
}

/**
 * One setting: icon, title, description, control.
 *
 * The control is a slot rather than a prop union so a row can hold a toggle, a
 * select, or a badge without this component knowing about any of them.
 */
export function SettingRow({
    icon: Icon,
    title,
    description,
    children,
}: {
    icon: FC<{ className?: string }>;
    title: string;
    description?: string;
    children?: ReactNode;
}) {
    return (
        <div className="flex items-start gap-4">
            <span className="flex size-9 flex-none items-center justify-center rounded-lg ring-1 ring-secondary">
                <Icon className="size-4 text-fg-quaternary" />
            </span>

            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-secondary">{title}</p>
                {description && <p className="mt-0.5 text-sm text-tertiary">{description}</p>}
            </div>

            {children && <div className="flex flex-none items-center pt-0.5">{children}</div>}
        </div>
    );
}

/** Divider between rows inside a card. */
export function RowDivider() {
    return <div className="h-px bg-border-secondary" />;
}
