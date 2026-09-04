"use client";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { AlertCircle, ArrowRight } from "@/components/icons";
import { columnLabel, formatValue, type FieldChange } from "@/utils/agent-diff";

/**
 * Review a release before it happens.
 *
 * A published agent is answering real calls, so publishing is confirmed
 * against a field-level diff rather than fired straight from the header button.
 * Nothing is written until Publish is pressed here.
 *
 * The dialog is also where a conflict surfaces: if someone else published while
 * this draft was open, the reader is told before they overwrite it, not after.
 */

type Props = {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    changes: FieldChange[];
    /** Version number this release will become, when it is known. */
    nextVersion: number | null;
    /** Set when the saved row moved under the draft. */
    conflict: { publishedAt?: string } | null;
    isPublishing: boolean;
    onConfirm: () => void;
};

const KIND_COLOR = { added: "success", removed: "error", changed: "warning" } as const;

export function AgentPublishDialog({ isOpen, onOpenChange, changes, nextVersion, conflict, isPublishing, onConfirm }: Props) {
    // Group by column so a reader scans "Voice" once rather than five rows that
    // each repeat the tab name.
    const groups = changes.reduce<Record<string, FieldChange[]>>((accumulator, change) => {
        (accumulator[change.column] ??= []).push(change);
        return accumulator;
    }, {});

    return (
        <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!isPublishing}>
            <Modal className="max-w-2xl">
                <Dialog>
                    <div className="flex max-h-[80dvh] w-full flex-col bg-primary ring-1 ring-secondary">
                        <header className="border-b border-secondary px-6 py-5">
                            <div className="flex items-center gap-3">
                                <h2 className="text-lg font-semibold text-primary">Review changes</h2>
                                {nextVersion !== null && (
                                    <Badge size="sm" type="modern">
                                        Version {nextVersion}
                                    </Badge>
                                )}
                            </div>
                            <p className="mt-1 text-sm text-tertiary">
                                Publishing replaces the configuration used by new calls. Calls already in progress finish on the version
                                they started with.
                            </p>
                        </header>

                        {conflict && (
                            <div className="flex items-start gap-3 border-b border-secondary bg-warning-primary px-6 py-4">
                                <AlertCircle className="mt-0.5 size-4 shrink-0 text-fg-warning-primary" />
                                <div className="text-sm">
                                    <p className="font-medium text-primary">This agent was published elsewhere while you were editing.</p>
                                    <p className="mt-0.5 text-tertiary">
                                        The diff below is against that newer version. Publishing overwrites it — their change stays in the
                                        version history and can be restored.
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                            {changes.length === 0 ? (
                                <p className="text-sm text-tertiary">
                                    Nothing differs from the published version. Publishing would append a version identical to the last one.
                                </p>
                            ) : (
                                <div className="flex flex-col gap-6">
                                    {Object.entries(groups).map(([column, rows]) => (
                                        <section key={column}>
                                            <h3 className="text-xs font-semibold tracking-wide text-tertiary uppercase">{columnLabel(column)}</h3>
                                            <ul className="mt-2 flex flex-col divide-y divide-border-secondary border-t border-secondary">
                                                {rows.map((change) => (
                                                    <li key={`${change.column}.${change.key ?? ""}`} className="py-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-medium text-primary">{change.label}</span>
                                                            <Badge size="sm" type="pill-color" color={KIND_COLOR[change.kind]}>
                                                                {change.kind}
                                                            </Badge>
                                                        </div>
                                                        {/* Old above new on narrow screens, side by side when
                                                            there is room — a system prompt is too tall to read
                                                            in a 50%-width column on a laptop. */}
                                                        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start">
                                                            <ValueBlock tone="before" value={change.before} />
                                                            <ArrowRight className="hidden size-3.5 self-center text-fg-quaternary sm:block" />
                                                            <ValueBlock tone="after" value={change.after} />
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        </section>
                                    ))}
                                </div>
                            )}
                        </div>

                        <footer className="flex justify-end gap-3 border-t border-secondary px-6 py-4">
                            <Button size="sm" color="secondary" isDisabled={isPublishing} onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button size="sm" isLoading={isPublishing} showTextWhileLoading isDisabled={changes.length === 0} onClick={onConfirm}>
                                Publish
                            </Button>
                        </footer>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

function ValueBlock({ tone, value }: { tone: "before" | "after"; value: unknown }) {
    const text = formatValue(value);
    return (
        <div
            className={`max-h-40 overflow-y-auto border px-3 py-2 font-mono text-xs whitespace-pre-wrap ${
                tone === "before" ? "border-secondary bg-secondary text-tertiary" : "border-brand bg-primary text-primary"
            }`}
        >
            {text}
        </div>
    );
}
