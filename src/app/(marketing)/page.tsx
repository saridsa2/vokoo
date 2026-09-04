import type { Metadata } from "next";
import type { ReactNode } from "react";

import { StructuredData } from "@/components/marketing-site/structured-data";
import { Faq } from "@/components/sarvathra/faq";
import { Features } from "@/components/sarvathra/features";
import { FinalCta } from "@/components/sarvathra/final-cta";
import { Footer } from "@/components/sarvathra/footer";
import { Hero } from "@/components/sarvathra/hero";
import { HeroWaves } from "@/components/sarvathra/hero-waves";
import { Nav } from "@/components/sarvathra/nav";
import { WindowMockup } from "@/components/sarvathra/window-mockup";
import { createMetadata } from "@/lib/marketing/metadata";
import { InView, MotionSection } from "@/lib/sarvathra/motion";

export const metadata: Metadata = createMetadata({
    // Said explicitly rather than left to the fallback: this is the one page
    // whose title is a search result, and "Sarvathra" alone tells somebody
    // scanning a page of results nothing about what it is.
    title: "Sarvathra — Your care, wherever your patient is",
    description:
        "Sarvathra turns a hospital's care pathways into AI agents that place the call — pre-cycle labs, cycle reminders, symptom checks, follow-ups — across every patient on the protocol, escalating to a nurse rather than advising, and writing every outcome back to your HIS.",
    path: "/",
});

/**
 * sarvathra.ai, on React Bits' Security template.
 *
 * ## Why this template, and what it changed
 *
 * Its hero is a picture of the product's own dashboard. Every previous version
 * of this page opened with a shader and then argued in paragraphs, which is
 * what kept failing: a page that has to describe itself is one nobody reads.
 * Here the screen does the describing and the writing gets out of the way.
 *
 * ## Seven of its fifteen sections are not here
 *
 * Cut on the test this project keeps applying to its own screens — does the
 * thing behind it exist:
 *
 * - **TrustedBy** shipped Stripe, Spotify, Anthropic, Vercel and Dropbox
 *   wordmarks. Those are a template's placeholders; on our domain they are a
 *   claim about customers we do not have.
 * - **Testimonials** pairs invented quotes with photographs of people. There
 *   is no version of that which is not a fabrication.
 * - **CaseStudy** is hardcoded to Spotify.
 * - **Stats** is three animated counters of invented performance claims
 *   ("97% reduction in alert noise"). Keeping the band and filling it with
 *   numbers we could support would be inventing a section to justify a
 *   component.
 * - **Pricing** — prices are not published. That is a commercial decision
 *   already taken the other way, and the FAQ says how to start instead.
 * - **CoverageGrid** and **ValueProp** are built on twelve stock photographs
 *   and one more. We have no photography, and borrowed imagery of somebody
 *   else's operations centre says nothing true about a hospital.
 *
 * What is left is the mark, the claim, the product, four things it does, the
 * questions a department asks, and a phone number. Thinner than the template,
 * and all of it load-bearing.
 */

// Plain literals, built server-side and passed to the client motion wrappers —
// kept inline rather than imported from a "use client" module.
const SOFT_EASE = [0.22, 1, 0.36, 1] as const;
const RISE_IN = {
    hidden: { opacity: 0, y: 24, scale: 0.985 },
    visible: { opacity: 1, y: 0, scale: 1 },
};

export default function HomePage(): ReactNode {
    return (
        <>
            <StructuredData />
            <span id="top" className="sr-only" />
            <Nav />
            <main id="main-content" className="flex-1">
                <div className="relative">
                    <HeroWaves />
                    <Hero />
                    <MotionSection
                        variants={RISE_IN}
                        transition={{ duration: 0.85, delay: 0.55, ease: SOFT_EASE }}
                        className="relative px-5 pb-24 sm:px-8 lg:px-10"
                    >
                        <WindowMockup />
                    </MotionSection>
                </div>
                <InView>
                    <Features />
                </InView>
                <InView>
                    <Faq />
                </InView>
                <FinalCta />
            </main>
            <InView>
                <Footer />
            </InView>
        </>
    );
}
