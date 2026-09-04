"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";

function useIsDark() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const classes = document.documentElement.classList;
      if (classes.contains("dark")) return true;
      if (classes.contains("light")) return false;
      return query.matches;
    };
    const update = () => setIsDark(read());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    query.addEventListener("change", update);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", update);
    };
  }, []);

  return isDark;
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
};

const headline: Variants = {
  hidden: { opacity: 0, y: 26, filter: "blur(10px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.85, ease: [0.22, 1, 0.36, 1] },
  },
};

export function Hero22() {
  const isDark = useIsDark();
  const reduceMotion = useReducedMotion();
  /* The block ships a violet-to-pink mesh. These are the mark's own three
     stops — #15576e teal, #1080a8 cyan, #0f61eb blue — sampled from
     `sarvathra-mark@2x.png`, so the shader is the logo's own colour rather
     than a borrowed palette. */
  const meshColors = isDark
    ? ["#050f14", "#15576e", "#1080a8", "#0f61eb", "#050f14"]
    : ["#ffffff", "#cfe4ec", "#a9d3e4", "#c3d4ff", "#f2f7fa"];

  return (
    <section className="relative flex min-h-screen w-full items-start overflow-hidden bg-white px-4 py-16 dark:bg-neutral-950 sm:px-6 sm:py-20 lg:items-center lg:px-8">
      <MeshGradient
        key={isDark ? "dark" : "light"}
        className="absolute inset-0 h-full w-full"
        style={{ width: "100%", height: "100%" }}
        colors={meshColors}
        distortion={0.9}
        swirl={0.22}
        grainMixer={0.12}
        grainOverlay={0.04}
        scale={1.1}
        speed={reduceMotion ? 0 : 0.45}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_52%_46%_at_50%_48%,rgba(255,255,255,0.74),rgba(255,255,255,0.05)_74%),linear-gradient(to_bottom,rgba(255,255,255,0)_52%,rgba(255,255,255,0.84))] dark:hidden"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(ellipse_58%_52%_at_50%_46%,rgba(10,10,10,0)_26%,rgba(10,10,10,0.6)_100%),linear-gradient(to_bottom,rgba(10,10,10,0.08)_46%,rgba(10,10,10,0.82))] dark:block"
      />

      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col items-center text-center"
      >
        {/* The announcement pill is gone.
            The slot held "Aurelia 2.0: now generally available" — a release
            note, which is why it carried a sparkle. We have no announcement,
            so the icon was decoration pretending to be information, and what
            I put in the pill was three nouns out of our own data model that
            mean nothing to somebody arriving cold. */}
        <motion.h1
          variants={headline}
          className="mt-7 max-w-4xl text-4xl font-medium leading-[1.02] tracking-[-0.04em] text-neutral-950 dark:text-white sm:text-6xl md:text-7xl"
        >
          Your care, wherever
          <br />
          <span className="text-neutral-500 dark:text-neutral-400">
            your patient is.
          </span>
        </motion.h1>

        <motion.p
          variants={item}
          className="mt-6 max-w-xl text-base leading-relaxed text-neutral-600 dark:text-neutral-300 sm:text-lg"
        >
          An ally for your patients. Relief for your care teams.
        </motion.p>

        {/* Not a button pair.
            The block ships a primary and a secondary CTA because every SaaS
            template assumes a funnel. There is no signup, no pricing, no
            trial and no self-serve here, so the realistic outcome of reading
            this page is that somebody gets in touch — which is a contact
            detail, not a call to action. */}
        <motion.div
          variants={item}
          className="mt-10 flex flex-col items-center gap-2 text-base text-neutral-800 dark:text-neutral-200 sm:flex-row sm:gap-6 sm:text-lg"
        >
          <a
            href="tel:+918040802529"
            className="underline decoration-neutral-400 underline-offset-4 transition-colors hover:decoration-neutral-900 dark:decoration-neutral-500 dark:hover:decoration-white"
          >
            +91 80408 02529
          </a>
          <a
            href="mailto:hello@sarvathra.ai"
            className="underline decoration-neutral-400 underline-offset-4 transition-colors hover:decoration-neutral-900 dark:decoration-neutral-500 dark:hover:decoration-white"
          >
            hello@sarvathra.ai
          </a>
        </motion.div>

        {/* The line that sat here was mine and unapproved:
            "Every other platform can only send. This one asks, and listens to
            the answer." An absolute nobody can stand behind, referring to the
            product as "this one", in a register far too casual for a page a
            clinician reads. Left empty rather than replaced with a third
            invention. */}
      </motion.div>
    </section>
  );
}

export default Hero22;
