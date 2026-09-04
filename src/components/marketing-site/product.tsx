"use client";

import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { ArrowChip } from "./arrow-chip";
import { RevealHeadline } from "./reveal-headline";

const easeOutExpo = [0.33, 1, 0.68, 1] as const;

/**
 * `tone`, `iconClass`, `indexClass` and `icon` were four fields describing a
 * filled tile and a 64px glyph, both of which went when the cards did. Left in
 * place they would read as styling the section still applies.
 */
interface Tile {
  index: string;
  title: string;
  body: string;
}

const TILES: Tile[] = [
  {
    index: "01.",
    title: "Start with what you already follow",
    body: "Give us the protocol your department already works to. We turn it into something that carries itself out. Nobody has to sit and build it.",
  },
  {
    index: "02.",
    title: "It rings every patient",
    body: "On the day it should, in the language they speak, at home or wherever they have gone. It asks what your protocol asks, and listens to the reply.",
  },
  {
    index: "03.",
    title: "You hear back the same day",
    body: "If something is wrong a nurse comes on the line while the patient is still there. Either way, what they said is in your records by the evening.",
  },
];

export function Product(): ReactNode {
  const sectionRef = useRef<HTMLElement>(null);

  const inView = useInView(sectionRef, { once: true, amount: 0.2 });

  return (
    <section
      ref={sectionRef}
      id="product"

      className="relative w-full bg-background text-foreground py-32 max-[850px]:py-24"
      aria-labelledby="product-heading"
    >
      <div className="max-w-[1680px] mx-auto px-10 max-[850px]:px-6">
        <div className="grid grid-cols-12 gap-x-10 gap-y-6 max-[850px]:grid-cols-1">
          <div className="col-span-3 max-[1100px]:col-span-12 max-[850px]:col-span-1 pt-2">
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.6, ease: easeOutExpo }}
              className="inline-flex items-center rounded-md border border-foreground/[0.08] px-3.5 py-1.5 font-mono text-xs uppercase tracking-widest text-foreground/70"
            >
              The problem it solves
            </motion.span>
          </div>

          <div className="col-span-7 col-start-6 max-[1100px]:col-span-12 max-[1100px]:col-start-1 max-[850px]:col-span-1">
            <RevealHeadline
              id="product-heading"
              delay={0.05}
              mutedFrom={9}
              className="text-balance text-[clamp(2rem,4.2vw,4rem)] font-medium leading-[0.85] tracking-tight"
            >
A protocol on paper is a protocol that waits for somebody.
            </RevealHeadline>

            {/* Seven sentences here, saying what the heading above and the
                three cards below already say. Cut. */}

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.28 }}
              className="mt-10"
            >
              {/* Was `#pricing`, a section this page does not have. The
                  strongest thing to offer after describing what it does is
                  the chance to hear it do it. */}
              <Link
                href="tel:+918040802529"
                className="group inline-flex items-stretch gap-1"
              >
                <span className="px-5 py-3 rounded-md bg-foreground text-background text-xs font-medium tracking-widest uppercase">
                  Hear it answer
                </span>
                <ArrowChip className="bg-foreground text-background" />
              </Link>
            </motion.div>
          </div>
        </div>
      </div>

      <div
        className={[
          "mt-24 max-[850px]:mt-16",
          "grid grid-cols-3 max-[1100px]:grid-cols-1",

        ].join(" ")}
      >
        {TILES.map((tile, i) => (
            <motion.article
              key={tile.index}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{
                duration: 0.8,
                ease: easeOutExpo,

                delay: 0.45 + i * 0.08,
              }}

              className="relative flex"
            >
              {/* **No card.** These were three filled tiles — one near-black,
                  two grey — 380px tall with 48px of padding. Three of those in
                  a row is a slide, and every other section on the page was
                  doing the same thing.

                  What is left is a hairline above the type and nothing else:
                  no fill, no border on three sides, no minimum height. The
                  column gap does the separating, and the ink is the page's
                  own. */}
              <div
                className={[
                  "relative flex flex-1 flex-col",
                  "border-t border-foreground/15 pt-6 pr-10 max-[1100px]:pr-0",
                  "max-[1100px]:pb-10",
                ].join(" ")}
              >
                {/* The 64px icon is gone with the card. At that size inside a
                    filled tile it was the loudest thing in the section and it
                    said nothing the heading did not. The index stays as a
                    small numeral — it is the only ornament left, and it earns
                    its place by numbering a sequence. */}
                <span className="font-mono text-xs tracking-[0.2em] text-foreground/40 uppercase">
                  {tile.index}
                </span>

                <h3 className="mt-4 text-2xl leading-tight font-medium tracking-tight max-[850px]:text-xl">
                  {tile.title}
                </h3>
                <p className="mt-3 max-w-[38ch] text-sm leading-relaxed text-foreground/60">
                  {tile.body}
                </p>
              </div>
            </motion.article>
        ))}
      </div>
    </section>
  );
}
