import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Assurance } from "@/components/marketing-site/assurance";
import { Faq } from "@/components/marketing-site/faq";
import { FinalCta } from "@/components/marketing-site/final-cta";
import { Footer } from "@/components/marketing-site/footer";
import { Fortnight } from "@/components/marketing-site/fortnight";
import { Hero } from "@/components/marketing-site/hero";
import { Product } from "@/components/marketing-site/product";
import { StructuredData } from "@/components/marketing-site/structured-data";
import { createMetadata } from "@/lib/marketing/metadata";

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
 * sarvathra.ai.
 *
 * ## Two sections the template shipped are not here
 *
 * **Partners** was a logo wall and **Pricing** a two-tier table. Both were cut
 * on the same test, which is the one this project keeps applying to its own
 * screens: does the thing behind it exist.
 *
 * There is no logo wall because there is no list of customers we can name, and
 * a trust strip filled with placeholder marks is worse than an absent one — it
 * reads as a page that failed to load, and to anybody who looks closely, as a
 * claim we could not support.
 *
 * There is no pricing table because prices are not published. Plans are real
 * and live in the database; putting them on a public page is a commercial
 * decision that was taken the other way. The FAQ says how to start instead,
 * which is a phone call.
 *
 * ## The order the sections run in
 *
 * Problem, then what it does, then why it holds up, then the questions a clinic
 * asks before letting somebody else answer its phone, then the number. A buyer
 * here is a doctor or an administrator rather than an engineer, so nothing
 * above the FAQ mentions a flow, an engine or a model — the words this project
 * uses internally are precisely the ones that lose that reader.
 */
export default function HomePage(): ReactNode {
    return (
        <>
            <StructuredData />
            <main id="main-content" className="relative z-10 flex-1 bg-background">
                {/* **Problem before solution.** `Product` heads "The problem
                    it solves" and the section above it poses the problem, and
                    they rendered the other way round — the answer arriving
                    before the question. That came from mapping a document's
                    section list onto components without reading the result
                    back.

                    `ValueProp` is gone rather than reordered. It said the same
                    three things as `Product` in a different box, and three
                    consecutive card grids is what makes this page feel like a
                    deck.

                    `Pillars` is gone for the same reason and one more: it
                    described three problems in three paragraphs, which is the
                    least persuasive way to show a gap between what a protocol
                    asks for and what a ward can do. `Fortnight` is that gap as
                    one object the reader drags. */}
                <Hero />
                <Fortnight />
                <Product />
                <Assurance />
                <Faq />
                <FinalCta />
            </main>
            <Footer />
        </>
    );
}
