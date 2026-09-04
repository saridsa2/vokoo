"use client";

/**
 * Ask before doing something that cannot be taken back.
 *
 * Several actions here fired on a single click: removing a member, deleting a
 * provider key, releasing a number back to the pool — the last of which also
 * deletes the flow bindings on it. All of them sat one mis-click away from a
 * customer's live configuration, next to buttons that merely open a dialog.
 *
 * ## What makes a confirmation worth reading
 *
 * A dialog that says "Are you sure?" trains people to press the second button
 * without reading. Three rules instead, and all three are in the props:
 *
 *   * **Name the thing.** "Remove Priya Nair from Vayuveda", not "Remove this
 *     item". The reader has to be able to tell they clicked the right row.
 *   * **Say what is lost**, in the same words the system would use afterwards.
 *     Releasing a number does not just unassign it; it deletes what answered
 *     on it, and that sentence is the reason somebody stops.
 *   * **The button says the verb.** "Remove", not "OK" — so the last thing
 *     read before acting is what the act is.
 *
 * ## When to make them type
 *
 * `confirmText` requires the reader to type an exact string, which is
 * deliberately reserved. It costs real effort, so it belongs only where the
 * consequence reaches beyond the person doing it — a whole workspace's calls,
 * not one row. Used everywhere it becomes noise, and noise is skipped.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";

export const ConfirmDialog = ({
    title,
    /** What is lost, and whether it comes back. */
    body,
    /** The verb. "Remove", "Delete", "Release" — never "OK". */
    confirmLabel,
    /** When set, the reader must type this exactly. Reserve it. */
    confirmText,
    tone = "destructive",
    isBusy,
    onCancel,
    onConfirm,
}: {
    title: string;
    body: React.ReactNode;
    confirmLabel: string;
    confirmText?: string;
    tone?: "destructive" | "neutral";
    isBusy?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) => {
    const [typed, setTyped] = useState("");
    // Cleared whenever the dialog is pointed at something else, so a previous
    // answer can never satisfy the next question.
    useEffect(() => setTyped(""), [confirmText, title]);

    const ready = !confirmText || typed.trim() === confirmText;

    return (
        <ModalOverlay isOpen onOpenChange={(open) => !open && onCancel()}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">{title}</h2>
                        <div className="mt-2 text-sm text-tertiary">{body}</div>

                        {confirmText ? (
                            <div className="mt-5">
                                <Input
                                    label={`Type ${confirmText} to confirm`}
                                    value={typed}
                                    onChange={setTyped}
                                    autoFocus
                                />
                            </div>
                        ) : null}

                        <div className="mt-6 flex justify-end gap-3">
                            <Button size="sm" color="secondary" onClick={onCancel}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                color={tone === "destructive" ? "primary-destructive" : "primary"}
                                isDisabled={!ready}
                                isLoading={isBusy}
                                onClick={onConfirm}
                            >
                                {confirmLabel}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};
