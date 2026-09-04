import type { ReactNode } from "react";

import { Assurance } from "@/components/marketing-site/assurance";
import { Faq } from "@/components/marketing-site/faq";
import { FinalCta } from "@/components/marketing-site/final-cta";
import { Fortnight } from "@/components/marketing-site/fortnight";
import { Product } from "@/components/marketing-site/product";

/**
 * A scratch page for looking at sections before they go near the real one.
 *
 * The hero is left off deliberately: it is a full-height shader and everything
 * being looked at here sits below it.
 *
 * Reachable on localhost only: `src/middleware.ts` serves nothing but `/` on
 * the apex, so this 404s in production without anybody having to remember to
 * take it down. Delete it once the work has been signed off.
 */
export default function BlockPreviewPage(): ReactNode {
    return (
        <main className="bg-background">
            <Fortnight />
            <Product />
            <Assurance />
            <Faq />
            <FinalCta />
        </main>
    );
}
