"use client";

import { useState } from "react";
import { motion, type Variants } from "motion/react";
import { ArrowUpRight } from "@/components/icons";

/**
 * The four care paths, as an index.
 *
 * The block ships a case-study list — client, sector, year, a result. We have
 * no clients and no results, so the shape is kept and the substance changed:
 * the guideline that defines each path, what the path is for, and how many
 * contacts it asks for. `metric` is the count of contacts, which is a fact
 * about the guideline rather than a claim about us.
 */
const studies = [
  {
    index: "01",
    title: "Chemotherapy",
    client: "NICE NG151",
    sector: "Oncology day care",
    year: "Cycle-linked",
    metric: "21 contacts a cycle",
    summary:
      "Nausea, temperature, the line site, eating and drinking, and the bloods before the next cycle — asked on the days the guideline names, wherever the patient has gone home to.",
  },
  {
    index: "02",
    title: "Type 2 diabetes",
    client: "NICE NG28",
    sector: "Endocrinology",
    year: "Continuous",
    metric: "12 contacts a year",
    summary:
      "Review intervals, medication tolerance, and the checks that quietly lapse between appointments — reached on the schedule the guideline sets rather than when somebody has an afternoon.",
  },
  {
    index: "03",
    title: "Postpartum",
    client: "ICMR",
    sector: "Obstetrics",
    year: "Six weeks",
    metric: "9 contacts",
    summary:
      "The weeks after discharge, when a mother is furthest from the ward and least likely to ring it. Asked how she is, and handed to a midwife the moment the answer needs one.",
  },
  {
    index: "04",
    title: "GLP-1 therapy",
    client: "NICE TA875",
    sector: "Weight management",
    year: "Titration",
    metric: "16 contacts",
    summary:
      "Dose steps, side effects, and whether the patient is still taking it at all — the questions a titration schedule depends on and nobody has time to ask every fortnight.",
  },
];

const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

export function Showcase7() {
  const [active, setActive] = useState(0);
  const total = String(studies.length).padStart(2, "0");

  return (
    <section className="w-full py-16 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-white dark:bg-neutral-950">
      <div className="max-w-[1400px] mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-16 xl:gap-20 items-start">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="lg:sticky lg:top-16"
          >
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight leading-[1.05] text-neutral-900 dark:text-white text-balance">
              Four care paths, already written. We make them run.
            </h2>
            <p className="mt-5 text-base sm:text-lg leading-relaxed text-neutral-600 dark:text-neutral-400 max-w-md text-pretty">
              Each one already written by NICE or ICMR. We ship it as a pack your
              department can change, and it runs for every patient on it.
            </p>
            {/* The block's "browse all case studies" link is gone rather than
                relabelled. There is nowhere for it to go, and this section is
                the index it would have led to. */}

            <div className="relative mt-10 sm:mt-12 aspect-[4/3] overflow-hidden rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900">
              {studies.map((study, index) => (
                <motion.div
                  key={study.title}
                  initial={false}
                  animate={{
                    opacity: active === index ? 1 : 0,
                    scale: active === index ? 1 : 1.06,
                  }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  aria-hidden={active !== index}
                  className="absolute inset-0"
                >
                  <img
                    src="/svg/placeholder.svg"
                    alt={study.title}
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-neutral-950/80 via-neutral-950/25 to-transparent px-5 sm:px-6 pb-5 sm:pb-6 pt-16">
                    <p className="text-sm font-medium text-white">
                      {study.client}
                    </p>
                    <p className="mt-1 text-xs text-neutral-300">
                      {study.metric}
                    </p>
                  </div>
                </motion.div>
              ))}
              <span className="absolute left-4 top-4 rounded-full bg-white/90 dark:bg-neutral-950/80 px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-neutral-900 dark:text-white backdrop-blur-sm">
                {studies[active].index} / {total}
              </span>
            </div>
          </motion.div>

          <motion.div
            variants={listVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="border-t border-neutral-200 dark:border-neutral-800"
          >
            {studies.map((study, index) => (
              <motion.a
                key={study.title}
                href="#how-it-works"
                variants={rowVariants}
                whileHover="hover"
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                className="group grid grid-cols-[auto_1fr_auto] items-start gap-5 sm:gap-8 py-7 sm:py-9 border-b border-neutral-200 dark:border-neutral-800 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-900 dark:focus-visible:outline-white"
              >
                <span
                  className={`pt-1.5 font-mono text-xs tracking-[0.12em] transition-colors duration-200 ${
                    active === index
                      ? "text-neutral-900 dark:text-white"
                      : "text-neutral-500 dark:text-neutral-500"
                  }`}
                >
                  {study.index}
                </span>
                <div className="min-w-0">
                  <h3 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-neutral-900 dark:text-white">
                    {study.title}
                  </h3>
                  <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                    {study.client} · {study.sector} · {study.year}
                  </p>
                  <p className="mt-3 max-w-lg text-sm sm:text-base leading-relaxed text-neutral-600 dark:text-neutral-400 text-pretty">
                    {study.summary}
                  </p>
                </div>
                <span className="mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-white group-hover:bg-neutral-900 group-hover:border-neutral-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:border-white dark:group-hover:text-neutral-900 transition-colors duration-200">
                  <motion.span
                    variants={{ hover: { x: 2, y: -2 } }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="grid place-items-center"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                  </motion.span>
                </span>
              </motion.a>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default Showcase7;
