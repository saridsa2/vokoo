"use client";

import { motion, useInView } from "motion/react";
import { useRef, type ReactNode } from "react";
import { ArrowChip } from "@/components/marketing-site/arrow-chip";
import { ShaderCanvas } from "@/components/marketing-site/shader-canvas";

const easeOutExpo = [0.33, 1, 0.68, 1] as const;

// Short lines: the heading is `max-w-[16ch]` and clamps up to 5.5rem.
const HEADLINE_LINES = ["Don't take", "our word for it."] as const;

export function FinalCta(): ReactNode {
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { once: true, amount: 0.35 });

  return (
    <section
      ref={sectionRef}
      id="get-started"
      className="relative w-full bg-background text-foreground"
      aria-labelledby="final-cta-heading"
    >
      <div className="max-w-[1680px] mx-auto px-10 max-[850px]:px-6 pb-32 max-[850px]:pb-24">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 32 }}
          transition={{ duration: 1, ease: easeOutExpo }}
          className="relative overflow-hidden rounded-3xl bg-[#0a2430] min-h-[520px] max-[850px]:min-h-[420px]"
        >
          <div aria-hidden className="absolute inset-0">
            <ShaderCanvas />
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/25 via-transparent to-black/10"
          />

          <div className="relative h-full flex flex-col justify-between p-14 max-[850px]:p-8 min-h-[inherit] text-white">
            <motion.h2
              id="final-cta-heading"
              className="max-w-[16ch] text-[clamp(2.5rem,6vw,5.5rem)] font-medium leading-[0.95] tracking-tight"
              initial="hidden"
              animate={inView ? "visible" : "hidden"}
              transition={{ staggerChildren: 0.12, delayChildren: 0.15 }}
            >
              {HEADLINE_LINES.map((line) => (
                <span key={line} className="block overflow-hidden pb-[0.05em]">
                  <motion.span
                    className="block will-change-transform"
                    variants={{
                      hidden: { y: "110%" },
                      visible: { y: "0%" },
                    }}
                    transition={{ duration: 1, ease: easeOutExpo }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </motion.h2>

            <div className="flex items-end justify-between gap-8 max-[850px]:flex-col max-[850px]:items-start mt-10">
              <motion.p
                className="max-w-xl text-3xl max-[850px]:text-base font-regular tracking-tighter leading-snug text-white/75"
                initial={{ opacity: 0, y: 16 }}
                animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
                transition={{ duration: 0.8, ease: easeOutExpo, delay: 0.6 }}
              >
                The number below is a live Sarvathra agent, not a recording.
                Ring it, ask it for a person, try to make it say something it
                should not. Then bring us one department&rsquo;s protocol.
              </motion.p>

              <motion.a
                href="tel:+918040802529"
                className="group inline-flex items-stretch gap-1 cursor-pointer shrink-0"
                initial={{ opacity: 0, y: 16 }}
                animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
                transition={{ duration: 0.8, ease: easeOutExpo, delay: 0.7 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <span className="px-5 py-3 rounded-md bg-white text-neutral-900 text-xs font-medium tracking-widest uppercase border border-neutral-900/[0.08]">
                  Call +91 80408 02529
                </span>
                <ArrowChip className="bg-white text-neutral-900" />
              </motion.a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
