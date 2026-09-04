import type { CSSProperties, FC, ReactNode } from "react";

import type { IconProps } from "@/components/icons";

/**
 * The preview panel in the Platform menu.
 *
 * The template shipped this as a bare `bg-muted` div — a slot for whatever the
 * buyer of the template puts there, usually a short screen capture. Left as
 * shipped it is a grey rectangle that reads as an image which failed to load,
 * which is the same failure mode as a footer full of dead links: it looks
 * broken rather than deliberately empty.
 *
 * It shows the selected item's own icon instead. Not a video, because there is
 * no recording of the product worth showing at this size, and a placeholder
 * clip of somebody else's software would be describing a different product.
 */
export function NavVisual({ icon: Icon }: { icon: FC<IconProps> }): ReactNode {
    return (
        <div className="bg-muted absolute inset-0 grid place-items-center overflow-hidden">
            <Icon
                className="text-foreground/15 h-24 w-24"
                aria-hidden="true"
                style={{ "--fa-secondary-opacity": "0.35" } as CSSProperties}
            />
        </div>
    );
}
