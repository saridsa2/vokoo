"use client";
import type { FC } from "react";
import type { IconProps } from "@/components/icons";

import { motion, useInView } from "motion/react";
import { Cube, Sparkles, Workflow } from "@/components/icons";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { ArrowChip } from "./arrow-chip";
import { RevealHeadline } from "./reveal-headline";

// The shim's icon signature. Was `LucideIcon`; icons come from
// `@/components/icons` in this project, so the type follows them.
type MarketingIcon = FC<IconProps>;

const easeOutExpo = [0.33, 1, 0.68, 1] as const;

interface Tile {

  index: string;
  title: string;
  body: string;
  icon: MarketingIcon;

  tone: string;

  iconClass: string;

  indexClass: string;
}

const TILES: Tile[] = [
  {
    index: "01.",
    title: "Transplant",

    body: "Stay close to a patient between visits — the level that is due, the dose that was missed, the question nobody was there to answer.",
    icon: Workflow,
    tone: "bg-accent text-accent-foreground",

    iconClass: "text-accent-foreground/85",
    indexClass: "text-accent-foreground/55",
  },
  {
    index: "02.",
    title: "Oncology",

    body: "Check how somebody is doing through a course of treatment, in the weeks at home where nobody is watching and everything is decided.",
    icon: Cube,

    tone: "bg-foreground/[0.08] text-foreground",
    iconClass: "text-foreground/70",
    indexClass: "text-foreground/45",
  },
  {
    index: "03.",
    title: "Surgery",

    body: "Prepare a patient before admission and follow them after discharge, without a coordinator working through a list by hand.",
    icon: Sparkles,

    tone: "bg-foreground/[0.04] text-foreground",
    iconClass: "text-foreground/70",
    indexClass: "text-foreground/45",
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
              Built around your standard of care
            </motion.span>
          </div>

          <div className="col-span-7 col-start-6 max-[1100px]:col-span-12 max-[1100px]:col-start-1 max-[850px]:col-span-1">
            <RevealHeadline
              id="product-heading"
              delay={0.05}
              mutedFrom={9}
              className="text-balance text-[clamp(2rem,4.2vw,4rem)] font-medium leading-[0.85] tracking-tight"
            >
Care does not end when the patient leaves.
            </RevealHeadline>

            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.18 }}
              className="mt-8 max-w-[60ch] text-balance text-base max-[850px]:text-sm leading-relaxed text-foreground/65"
            >
              Your hospital already knows what good care asks for. A call
              after discharge. A check that the medicine was started.
              Preparation before a procedure. A regular question about
              symptoms. Sarvathra holds each of those as a real conversation,
              with every patient, at the right point in their care — and when
              a patient reports something clinical, a nurse joins the live
              call. It does not advise. It does not triage. It does not
              reassure.
            </motion.p>

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
        {TILES.map((tile, i) => {
          const Icon = tile.icon;
          return (
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
              <div
                className={[
                  "relative flex flex-1 flex-col justify-between",

                  "min-h-[380px] max-[850px]:min-h-[260px]",
                  "p-12 max-[850px]:p-8",

                  "transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  tile.tone,
                ].join(" ")}
              >
                <div className="flex items-start justify-between">
                  <Icon
                    className={tile.iconClass}
                    size={64}
                    aria-hidden
                  />
                  <span
                    className={[
                      "font-mono text-xs uppercase tracking-[0.2em]",
                      tile.indexClass,
                    ].join(" ")}
                  >
                    {tile.index}
                  </span>
                </div>

                <div>
                  <h3 className="text-2xl max-[850px]:text-xl font-medium leading-tight tracking-tight">
                    {tile.title}
                  </h3>
                  <p
                    className={[
                      "mt-3 text-sm leading-relaxed",

                      i === 0 && "text-accent-foreground/75",
                      i === 1 && "text-foreground/65",
                      i === 2 && "text-foreground/60",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {tile.body}
                  </p>
                </div>
              </div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
