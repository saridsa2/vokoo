"use client";

import { ArrowRight } from "@/components/icons";
import { motion } from "motion/react";
import { useState } from "react";

export function Hero16() {
  const [isCtaHovered, setIsCtaHovered] = useState(false);

  return (
    <section className="relative w-full min-h-screen flex flex-col py-12 px-4 sm:px-6 lg:px-8 bg-white dark:bg-neutral-950">
      <div className="max-w-[1400px] mx-auto w-full flex flex-col flex-1">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <img
            src="/mock-logos/biosynthesis.svg"
            alt="Biosynthesis"
            className="h-7 sm:h-8 w-auto dark:invert"
          />
        </motion.div>

        <div className="flex-1 flex items-start pt-12 sm:pt-16 md:pt-20">
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-medium text-neutral-900 dark:text-white leading-[1.05] tracking-[-0.02em] max-w-4xl"
          >
            Pioneering the next
            <br />
            era of precision
            <br className="hidden sm:block" /> therapeutics.
          </motion.h1>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-5 sm:gap-8">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="text-sm sm:text-base md:text-lg text-neutral-600 dark:text-neutral-400 leading-relaxed font-normal flex-1 min-w-0 max-w-md"
          >
            We decode complex biology with genomics, chemistry, and AI for
            next-generation therapeutic discovery.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="flex items-center gap-2.5 w-full sm:w-auto shrink-0"
            onMouseEnter={() => setIsCtaHovered(true)}
            onMouseLeave={() => setIsCtaHovered(false)}
          >
            <motion.a
              href="#"
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center justify-center flex-1 sm:flex-none px-7 sm:px-8 py-3.5 sm:py-4 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] sm:text-xs font-medium tracking-[0.12em] uppercase cursor-pointer hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors duration-200"
              style={{
                fontFamily:
                  "'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace",
              }}
            >
              Discover our platform
            </motion.a>
            <motion.a
              href="#"
              whileTap={{ scale: 0.95 }}
              className="shrink-0 inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-amber-400 dark:bg-amber-400 text-neutral-900 cursor-pointer hover:bg-amber-300 dark:hover:bg-amber-300 transition-colors duration-200"
            >
              <motion.span
                animate={{ x: isCtaHovered ? 3 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </motion.span>
            </motion.a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default Hero16;
