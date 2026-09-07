"use client";

/**
 * One dialog, with a slot for a visual.
 *
 * The architecture is Sarvam's `tatva` Dialog, studied from the extracted
 * bundle in `indus.sarvam.ai/`. What is taken is the **shape of the contract**,
 * not their code: their implementation is Radix with their own tokens, this one
 * is React Aria with ours, because every component in this project is built on
 * React Aria and a second modal engine would be a second set of focus-trap bugs.
 *
 * Four things are worth naming, because each is a decision the obvious version
 * gets wrong.
 *
 * **1. The visual is a slot, and its position is a prop.** `image` takes any
 * node — a picture, a chart, a particle field — and `imagePosition` decides
 * whether the dialog is a column with the visual on top, or a **row** with the
 * visual down the left and the controls on the right. Three layouts, one
 * component. The alternative is a `SplitDialog` beside a `Dialog`, which is two
 * components that must be kept in step and will not be.
 *
 * **2. The visual does not shrink.** `shrink-0` on its box, so the content
 * column absorbs every pixel of flex. Without it a long form squeezes the
 * artwork into a sliver rather than the dialog growing.
 *
 * **3. Padding is conditional at the seams.** Header, body and footer each own
 * `p-6`, and the body adds its own top padding **only when there is no header**
 * and its own bottom padding **only when there is no footer**. Written the
 * obvious way, a dialog with all three parts has 48px between the title and the
 * first field and 24px everywhere else.
 *
 * **4. Motion is in two layers, and only one of them is allowed to fail.**
 * React Aria drives the entrance and exit through `isEntering` / `isExiting`,
 * which are *added* to an element that is otherwise at its resting state — so
 * if the animation never runs, the dialog is simply there. That is deliberate
 * and it is the fix for a real fault: an entrance built with `motion` starts at
 * `opacity: 0` and animates on a `requestAnimationFrame`, which Chrome does not
 * run in a backgrounded tab, and the sign-in form rendered blank.
 *
 * The decorative layer — a slight lift on open — is gated behind
 * `[data-vokoo-motion="on"]` on an ancestor, exactly as `tatva` gates its
 * `dialog-pop-in` behind `[data-tatva-motion=on]`. Nothing depends on it.
 */
import type { ReactNode } from "react";
import { Heading } from "react-aria-components";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Button } from "@/components/base/buttons/button";
import { X } from "@/components/icons";

/**
 * Widths, responsive at every step, all starting near-full on a phone.
 *
 * Straight from the `tatva` size table, because the numbers are the product of
 * somebody watching real dialogs at real breakpoints and there is nothing to be
 * gained by inventing seven different ones.
 */
const SIZES = {
    xs: "sm:max-w-[280px]",
    sm: "sm:max-w-[360px] md:max-w-[400px]",
    md: "sm:max-w-[420px] md:max-w-[520px]",
    lg: "sm:max-w-[520px] md:max-w-[640px]",
    xl: "sm:max-w-[660px] md:max-w-[820px]",
    xxl: "sm:max-w-[720px] md:max-w-[900px]",
    full: "sm:max-w-[90vw]",
} as const;

export type DialogSize = keyof typeof SIZES;

export interface StandardDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;

    /** The one line naming what this dialog is for. */
    title?: string;
    /** A sentence under it, when the title alone leaves a question. */
    description?: string;
    /** The dialog's own content — fields, a list, whatever it is about. */
    children?: ReactNode;

    /**
     * A visual: artwork, a diagram, an animation. Any node.
     * With `imagePosition="left"` the dialog becomes a row and this is the
     * left half.
     */
    image?: ReactNode;
    imagePosition?: "top" | "left";

    /** The affirmative action. Omit it and the footer is not rendered at all. */
    submitLabel?: string;
    onSubmit?: () => void;
    isSubmitting?: boolean;
    isSubmitDisabled?: boolean;

    /** The way out. Omit it and only the submit button is shown. */
    cancelLabel?: string;
    onCancel?: () => void;

    showCloseButton?: boolean;
    size?: DialogSize;
    /** Refuse to close on a click outside — for a form somebody has filled in. */
    preventOutsideClose?: boolean;

    /** A line of small print under the buttons, centred. */
    disclaimer?: ReactNode;
}

export function StandardDialog({
    isOpen,
    onOpenChange,
    title,
    description,
    children,
    image,
    imagePosition = "top",
    submitLabel,
    onSubmit,
    isSubmitting = false,
    isSubmitDisabled = false,
    cancelLabel,
    onCancel,
    showCloseButton = true,
    size = "md",
    preventOutsideClose = false,
    disclaimer,
}: StandardDialogProps) {
    const hasHeader = Boolean(title || description);
    const hasFooter = Boolean(submitLabel);
    const isRow = Boolean(image) && imagePosition === "left";

    // The content column: close, header, body, footer, disclaimer. Assembled
    // once and placed by the layout below, so the row and the column cannot
    // drift into two different stacks.
    const content = (
        <div className="relative flex min-h-0 grow flex-col">
            {showCloseButton && (
                <div className="absolute top-4 right-4 z-10">
                    <Button size="sm" color="tertiary" iconLeading={X} aria-label="Close" onClick={() => onOpenChange(false)} />
                </div>
            )}

            {hasHeader && (
                <div className="flex shrink-0 flex-col gap-1 p-6">
                    {title && (
                        <Heading slot="title" className="text-lg font-semibold text-primary">
                            {title}
                        </Heading>
                    )}
                    {description && <p className="text-sm text-tertiary">{description}</p>}
                </div>
            )}

            {children && (
                // See note 3: the seam padding is owned by whichever block is
                // actually there.
                <div className={cxPad(hasHeader, hasFooter)}>{children}</div>
            )}

            {hasFooter && (
                <div className="flex shrink-0 items-center justify-end gap-3 px-6 pt-3 pb-6">
                    {cancelLabel && (
                        <Button size="sm" color="secondary" isDisabled={isSubmitting} onClick={onCancel ?? (() => onOpenChange(false))}>
                            {cancelLabel}
                        </Button>
                    )}
                    <Button size="sm" onClick={onSubmit} isDisabled={isSubmitDisabled || isSubmitting} isLoading={isSubmitting} showTextWhileLoading>
                        {submitLabel}
                    </Button>
                </div>
            )}

            {disclaimer && <div className="flex shrink-0 items-center justify-center px-6 pb-4 text-center">{disclaimer}</div>}
        </div>
    );

    return (
        <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!preventOutsideClose && !isSubmitting}>
            <Modal className={SIZES[size]}>
                <Dialog aria-label={title ? undefined : "Dialog"}>
                    {/* The decorative lift, and nothing depends on it: the card
                        is at its resting state without it. Switch it on by
                        putting `data-vokoo-motion="on"` on an ancestor. */}
                    <div
                        className={
                            // `shadow-xl` and not only a ring. A hairline says
                            // "edge of a region"; elevation is what says "this
                            // is lifted off the page and everything behind it is
                            // waiting". Without it, a white card on a scrim
                            // reads as a panel, which is the note the first
                            // version came back with.
                            "flex max-h-[95vh] w-full overflow-hidden bg-primary shadow-xl ring-1 ring-secondary " +
                            (isRow ? "flex-row" : "flex-col") +
                            " [[data-vokoo-motion=on]_&]:duration-300 [[data-vokoo-motion=on]_&]:ease-out [[data-vokoo-motion=on]_&]:animate-in [[data-vokoo-motion=on]_&]:slide-in-from-bottom-2"
                        }
                    >
                        {/* shrink-0, per note 2 — the visual never gets squeezed
                            by a content column that grew a step.

                            `basis-1/2` only in the row: a visual down the left
                            is a half, and it has to be told so, because a canvas
                            has no intrinsic width to fall back on and would
                            collapse to nothing. On top it keeps its own height
                            and spans the width. Hidden below `sm`, where half of
                            a phone is not a half worth having. */}
                        {image && <div className={isRow ? "hidden shrink-0 basis-1/2 self-stretch sm:block" : "shrink-0"}>{image}</div>}
                        {content}
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

/**
 * The body's padding, which depends on what is above and below it.
 *
 * Its own `p-6` on the sides always; top only when no header has already
 * spent it, bottom only when no footer will.
 */
function cxPad(hasHeader: boolean, hasFooter: boolean): string {
    return ["min-h-0 grow overflow-auto px-6", hasHeader ? "" : "pt-6", hasFooter ? "" : "pb-6"].filter(Boolean).join(" ");
}

export default StandardDialog;
