"use client";

import { AlertCircle, InfoCircle } from "@/components/icons";
import type { Finding, Severity } from "@/utils/capability-rules";

/**
 * How a finding is drawn.
 *
 * Two renderings of the same thing: a dot on the tab strip saying "there is
 * something here", and a panel inside the tab saying what. They read from one
 * evaluation, so a tab can never carry a dot with nothing behind it.
 */

const DOT_TONE: Record<Severity, string> = {
    // Blocking is the same amber, not red. Red on a tab strip reads as "this
    // is broken and you did it", when the usual cause is a provider change the
    // reader made on purpose two clicks ago.
    blocking: "bg-fg-warning-primary",
    attention: "bg-fg-warning-primary",
    info: "bg-fg-quaternary",
};

const DOT_LABEL: Record<Severity, string> = {
    blocking: "must be resolved before publishing",
    attention: "needs review",
    info: "worth knowing",
};

/** The marker on a tab. Renders nothing when there is nothing unseen. */
export function TabMarker({ severity }: { severity: Severity | null }) {
    if (!severity) return null;

    return (
        <span
            className={`size-1.5 shrink-0 rounded-full ${DOT_TONE[severity]}`}
            // The dot is the only cue for a reader who cannot see colour, so it
            // carries its meaning as text for a screen reader rather than
            // relying on being amber.
            role="img"
            aria-label={DOT_LABEL[severity]}
        />
    );
}

const PANEL_TONE: Record<Severity, { box: string; icon: string }> = {
    blocking: { box: "border-warning bg-warning-primary", icon: "text-fg-warning-primary" },
    attention: { box: "border-warning bg-warning-primary", icon: "text-fg-warning-primary" },
    info: { box: "border-secondary bg-secondary", icon: "text-fg-quaternary" },
};

/**
 * Findings for the tab being viewed, above its cards.
 *
 * Above rather than beside the field: a provider change can invalidate two
 * fields at once, and the reader needs to see both before deciding what to fix
 * rather than hunting for inline warnings.
 */
export function FindingList({ findings }: { findings: Finding[] }) {
    if (!findings.length) return null;

    return (
        <div className="mb-5 flex flex-col gap-2">
            {findings.map((finding) => {
                const tone = PANEL_TONE[finding.severity];
                const Icon = finding.severity === "info" ? InfoCircle : AlertCircle;

                return (
                    <div key={finding.id} className={`flex items-start gap-3 border px-4 py-3 ${tone.box}`}>
                        <Icon className={`mt-0.5 size-4 shrink-0 ${tone.icon}`} />
                        <div className="min-w-0 text-sm">
                            <p className="font-medium text-primary">{finding.title}</p>
                            <p className="mt-0.5 text-tertiary">{finding.detail}</p>
                            {finding.remedy && <p className="mt-1 text-secondary">{finding.remedy}</p>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * What a provider or model change rewrote.
 *
 * Shown until dismissed rather than as a toast. A toast that names three
 * rewritten fields is gone before it has been read, and the reader is then
 * looking at a voice they did not choose with no explanation on screen.
 */
export function RewriteNotice({
    rewrites,
    onDismiss,
}: {
    rewrites: { label: string; from: string; to: string; reason: string }[];
    onDismiss: () => void;
}) {
    if (!rewrites.length) return null;

    return (
        <div className="mt-4 flex items-start gap-3 border border-warning bg-warning-primary px-4 py-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-fg-warning-primary" />
            <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-primary">
                    {rewrites.length === 1 ? "One setting was changed to match the new provider" : `${rewrites.length} settings were changed to match the new provider`}
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                    {rewrites.map((rewrite) => (
                        <li key={rewrite.label} className="text-tertiary">
                            <span className="font-medium text-secondary">{rewrite.label}</span>{" "}
                            <span className="font-mono text-xs">
                                {rewrite.from} → {rewrite.to}
                            </span>
                            <span className="block text-xs">{rewrite.reason}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-1.5 text-xs text-tertiary">These are not saved until you publish.</p>
            </div>
            <button onClick={onDismiss} className="shrink-0 text-sm text-tertiary hover:text-secondary">
                Dismiss
            </button>
        </div>
    );
}
