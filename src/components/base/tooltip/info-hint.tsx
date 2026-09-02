"use client";

/**
 * The help icon beside something that is not a form label.
 *
 * An ⓘ, not a ?. A question mark asks "how do I use this"; these say what a
 * thing is. `Label`'s own `tooltip` prop uses a question mark, so this is passed
 * as a child of a `Label` rather than through that prop — one icon, one meaning,
 * on every field this console adds.
 *
 * It exists so an explanation stops taking up a line. A paragraph under every
 * heading reads as noise once you have read it twice, and the reader who needs
 * it is the reader who stops to look.
 */

import { InfoCircle } from "@/components/icons";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { cx } from "@/utils/cx";

export const InfoHint = ({
    /** One or two sentences. Longer than that wants a place on the page. */
    title,
    description,
    className,
}: {
    title: string;
    description?: string;
    className?: string;
}) => (
    <Tooltip title={title} description={description} placement="top">
        <TooltipTrigger
            // Never inherits a disabled state: an explanation is still worth
            // reading when the thing it explains cannot be used.
            isDisabled={false}
            className={cx(
                "cursor-pointer text-fg-quaternary transition duration-100 ease-linear hover:text-fg-quaternary_hover focus-visible:text-fg-quaternary_hover",
                className,
            )}
        >
            <InfoCircle className="size-4" aria-hidden="true" />
        </TooltipTrigger>
    </Tooltip>
);
