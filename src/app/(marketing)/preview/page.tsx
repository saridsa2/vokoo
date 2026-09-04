import { CoverageGrid } from "@/components/sarvathra/coverage-grid";
import { CaseStudy } from "@/components/sarvathra/case-study";
import { Hero } from "@/components/sarvathra/hero";
import { HeroWaves } from "@/components/sarvathra/hero-waves";
import { Faq } from "@/components/sarvathra/faq";
import { Features } from "@/components/sarvathra/features";
import { FinalCta } from "@/components/sarvathra/final-cta";
import { Footer } from "@/components/sarvathra/footer";
import { Nav } from "@/components/sarvathra/nav";
import { Pricing } from "@/components/sarvathra/pricing";
import { Stats } from "@/components/sarvathra/stats";
import { Testimonials } from "@/components/sarvathra/testimonials";
import { TrustedBy } from "@/components/sarvathra/trusted-by";
import { ValueProp } from "@/components/sarvathra/value-prop";
import { WindowMockup } from "@/components/sarvathra/window-mockup";
import { InView, MotionSection } from "@/lib/sarvathra/motion";
import type { ReactNode } from "react";

/**
 * The Security template, mounted unbranded so it can be looked at before it
 * replaces anything.
 *
 * Every word and image below is React Bits' own demo content. Nothing here is
 * ours yet — the point is to see the structure and the motion working inside
 * this repo's build, with this repo's fonts and tokens resolving.
 *
 * Reachable on localhost only: `src/middleware.ts` serves nothing but `/` on
 * the apex, so this 404s in production. Delete it once the real page is built
 * on the same components.
 */

// Plain literals (built server-side) passed as props to the client motion
// wrappers — kept inline to avoid importing values from a "use client" module.
const SOFT_EASE = [0.22, 1, 0.36, 1] as const;
const RISE_IN = {
  hidden: { opacity: 0, y: 24, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

export default function HomePage(): ReactNode {
  return (
    <>
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
          <TrustedBy />
        </InView>
        <CoverageGrid />
        <InView>
          <Features />
        </InView>
        <InView>
          <ValueProp />
        </InView>
        <InView>
          <Testimonials />
        </InView>
        <InView>
          <Stats />
        </InView>
        <InView>
          <CaseStudy />
        </InView>
        <InView>
          <Pricing />
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
