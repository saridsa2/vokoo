import type { ReactNode } from "react";

import Faq7 from "@/components/blocks/faq-7";
import { Features5 } from "@/components/blocks/features-5";
import Footer4 from "@/components/blocks/footer-4";
import { Hero22 } from "@/components/blocks/hero-22";
import Navigation15 from "@/components/blocks/navigation-15";
import Showcase7 from "@/components/blocks/showcase-7";

/**
 * sarvathra.ai, on the composition assembled in the React Bits Landing
 * Builder.
 *
 * ## Two of the eight blocks are not here
 *
 * **Auth2** was a sign-in form. In the builder's preview it reads as a
 * section; on a real landing page it is a login screen dropped into the
 * middle of the argument, and we already have one at console.sarvathra.ai.
 *
 * **About9** is a founder-and-studio block — "Founded in Copenhagen, still
 * independent", a three-minute studio film, a headcount across nine cities.
 * We have no film, no studio and no headcount, and the honest version of that
 * section is an empty one.
 *
 * ## What each of the six carries
 *
 * `Hero22` runs its mesh shader on the mark's own three stops rather than the
 * block's violet, so the atmosphere is ours rather than borrowed.
 * `Showcase7` shipped a case-study index and now carries the four care paths,
 * keeping the shape and changing the substance: the guideline that defines
 * each path, and the number of contacts it asks for, which is a fact about the
 * guideline rather than a claim about us. `Features5` shipped a compliance
 * grid — SOC 2 Type II, ISO/IEC 42001, HIPAA — and carries the six things the
 * platform actually does; a certification a product does not hold is the one
 * item on a healthcare page with real legal consequence. `Footer4` shipped a
 * crypto sitemap.
 *
 * Localhost only — `src/middleware.ts` serves nothing but `/` on the apex.
 */
export default function NextPage(): ReactNode {
    return (
        <main
            data-site="marketing"
            className="w-full"
            /* Without this every block fills the viewport, which is right for a
               block used alone and wrong for six of them in a column. */
            style={{ "--rb-section-min-h": "0px" } as React.CSSProperties}
        >
            <Navigation15 />
            <Hero22 />
            <div id="care-paths">
                <Showcase7 />
            </div>
            <div id="how-it-works">
                <Features5 />
            </div>
            <div id="faq">
                <Faq7 />
            </div>
            <Footer4 />
        </main>
    );
}
