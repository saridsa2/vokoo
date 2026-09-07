"use client";

/**
 * Auth 2 — React Bits Pro, adapted.
 *
 * Installed from `@reactbits-pro/auth-2`. What arrived was a split screen: a
 * photographic panel on the left, and on the right two OAuth buttons and a form
 * whose submit handler was `console.log`.
 *
 * **None of that survived, including the split.** A two-column layout puts a
 * hard vertical edge down the middle of the one page in the product that should
 * feel like nothing is in the way. What is here now is a white page with the
 * sign-in as a dialog on it, which is what the screen actually is: one thing to
 * do, in the middle, with nothing beside it.
 *
 * What the block is still earning its place for is the arrangement it taught —
 * mark, then the one heading, then the form, in a single narrow column — and
 * the idea that the mark should move. Everything else was removed for a reason:
 *
 *   - **The OAuth buttons.** No provider is configured in Supabase, so Apple
 *     and Google would fail on click. An absent option beats a broken one.
 *   - **The form.** This project's sign-in is three steps, because an account
 *     made by invitation has no password and must not be shown a password
 *     field. So the form is `children`: the block owns the composition, the
 *     screen owns what happens when somebody presses the button.
 *   - **The photograph.** A stock image nobody has looked at, loaded from a
 *     third party on the one page where somebody types a password.
 *   - **The teal panel.** It was a dark surface, on a product whose owner has
 *     said plainly that dark surfaces are not wanted. Being artwork did not
 *     exempt it.
 */
import type { ReactNode } from "react";
import { StandardDialog } from "@/components/application/modals/standard-dialog";
import ParticleImage from "@/components/react-bits/particle-image";

export function Auth2({ children }: { children: ReactNode }) {
    return (
        // **It renders through `StandardDialog`, and that is the point.**
        //
        // This used to be a hand-written copy of that component's row layout,
        // which meant the dialog built for this sat beside it importing from
        // nowhere — two implementations of one thing, and only one of them ever
        // running.
        //
        // It is a real modal now, so it gets the dim, blurred overlay a dialog
        // is supposed to have. The earlier argument against it — that a modal
        // over nothing lies about being dismissable — is answered by saying so
        // rather than by dropping the overlay: `preventOutsideClose` and no
        // close button, because there is nowhere to be dismissed *to* until
        // somebody signs in.
        <StandardDialog
            isOpen
            title="Sign in"
            // Never closes. The only way past this dialog is through it.
            onOpenChange={() => {}}
            preventOutsideClose
            showCloseButton={false}
            size="xl"
            imagePosition="left"
            image={
                <div className="h-full w-full">
                    {/* **The mark is the animation.**
                        React Bits' Particle Image samples an image into a GPU
                        particle field that swirls apart and reassembles.

                        **It takes the logo with its transparency intact**, which
                        it could not do as shipped: the shader sampled `.rgb` and
                        dropped `.a`, so every transparent pixel was tinted black
                        and drawn at full opacity — a black square with a hard
                        edge. Two lines in `particle-image.tsx` now multiply the
                        alpha through, marked `VOKOO OVERRIDE`. Before that fix
                        this pointed at a copy of the mark flattened onto white,
                        which worked until the flattened white and the card's
                        white failed to match; a derived asset was the wrong
                        answer to a bug in the component.

                        `sarvathra-mark-field.png` is the mark on a **transparent**
                        1024px field, padded so it occupies about half the frame.
                        The padding is the drift room — the canvas covers, so
                        without it the mark would fill the frame and every
                        particle leaving it would clip immediately.

                        Regenerate it with:
                          magick -size 1024x1024 xc:none \
                            \( public/sarvathra-icon.png -resize 560x560 \) \
                            -gravity center -composite \
                            -colorspace sRGB -depth 8 -strip \
                            public/sarvathra-mark-field.png */}
                    <ParticleImage
                        imageUrl="/sarvathra-mark-field.png"
                        width="100%"
                        height="100%"
                        // Transparent, so the card's own surface is the ground —
                        // there is no second white to match, which is what made
                        // the previous version read as a panel laid on the card.
                        // It also means a machine with no WebGL shows the card,
                        // not a hole.
                        backgroundColor="transparent"
                        // 500,000 is the default, meant for a full-screen hero
                        // on a page nobody is waiting on. This is the gate to
                        // the app.
                        particleCount={90000}
                        particleSize={1.4}
                        particleOpacity={0.9}
                        // The mark stays drawn under the particles: it has to
                        // remain recognisable, so the particles play over it
                        // rather than replace it.
                        showImage
                        imageOpacity={1}
                        cursorInteraction
                    />
                </div>
            }
        >
            {/* **`min-h` is what stops the dialog jumping**, and the jump is a
                step change rather than typing.

                Sign-in has three steps and they are not the same height:
                `identify` is one field and a button; `password` adds the
                settled address, a password field, Remember me, and the
                "email me a link instead" section under a rule — about twice as
                tall. The dialog is vertically centred, so a taller step grows in
                both directions and the heading, the field and the button all
                move under the pointer that just clicked one.

                Reserving the tallest step's height means the box never resizes
                between them. `justify-center` then keeps the short step centred
                in that height rather than pinned to the top, so the reserved
                space reads as breathing room instead of a gap.

                It does not cover an error message appearing, which still grows
                the column. Reserving space for an error that is usually absent
                would leave a permanent hole, and that is the worse trade. */}
            <div className="flex min-h-[380px] flex-col justify-center py-4">{children}</div>
        </StandardDialog>
    );
}

export default Auth2;
