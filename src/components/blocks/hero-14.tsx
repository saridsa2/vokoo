"use client";

import { ArrowRight, Star } from "@/components/icons";
import { motion } from "motion/react";
import { useState } from "react";

export function Hero14() {
  const [email, setEmail] = useState("");
  const [isLinkHovered, setIsLinkHovered] = useState(false);

  return (
    <section className="w-full min-h-screen flex items-start lg:items-center py-12 px-4 sm:px-6 lg:px-8 bg-white dark:bg-neutral-950 relative overflow-hidden">
      <div className="absolute inset-x-0 bottom-0 h-[70%] bg-[radial-gradient(ellipse_at_50%_100%,rgba(115,115,115,0.12),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_50%_100%,rgba(64,64,64,0.25),transparent_70%)] pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-[50%] bg-[radial-gradient(ellipse_at_30%_100%,rgba(163,163,163,0.08),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_30%_100%,rgba(82,82,82,0.12),transparent_60%)] pointer-events-none" />

      <div className="max-w-[1400px] mx-auto w-full relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 xl:gap-16 items-center">
          <div className="flex flex-col">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="flex items-center gap-2 select-none"
            >
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                <Star className="w-3 h-3 fill-neutral-900 dark:fill-white text-neutral-900 dark:text-white" />
              </div>
              <span className="text-sm text-neutral-900 dark:text-white font-semibold">
                5 stars
              </span>
              <span className="text-sm text-neutral-500 dark:text-neutral-400 font-normal">
                3,000+ reviews
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mt-4 text-4xl sm:text-5xl md:text-6xl lg:text-[4rem] xl:text-[4.5rem] font-medium text-neutral-900 dark:text-white leading-[1.08] tracking-[-0.015em]"
            >
              Focus on work.
              <br />
              We handle ops.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-5 sm:mt-6 text-base sm:text-[17px] text-neutral-600 dark:text-neutral-300 leading-relaxed max-w-[440px] font-normal"
            >
              Streamlined team expenses, automated invoicing, payroll
              management, and real-time reporting. All in one place.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-9 sm:mt-10 max-w-[500px]"
            >
              <div className="flex flex-col sm:hidden gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="What's your work email?"
                  className="w-full px-5 py-4 rounded-xl bg-neutral-100 dark:bg-white text-neutral-900 placeholder-neutral-400 text-base focus:outline-none border border-neutral-200 dark:border-0"
                />
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="cursor-pointer w-full px-6 py-4 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-base transition-colors duration-200 hover:bg-neutral-800 dark:hover:bg-neutral-100"
                >
                  Get started for free
                </motion.button>
              </div>

              <div className="hidden sm:flex items-center bg-neutral-100 dark:bg-white rounded-2xl p-2 pl-0 border border-neutral-200 dark:border-0">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="What's your work email?"
                  className="flex-1 px-4 py-3 bg-transparent text-neutral-900 placeholder-neutral-400 text-base focus:outline-none border-0 min-w-0"
                />
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="cursor-pointer px-7 py-3 rounded-[10px] bg-neutral-900 dark:bg-neutral-900 text-white font-semibold text-base transition-colors duration-200 whitespace-nowrap shrink-0 hover:bg-neutral-800 dark:hover:bg-neutral-800"
                >
                  Get started for free
                </motion.button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="mt-9 sm:mt-10"
            >
              <a
                href="#"
                onMouseEnter={() => setIsLinkHovered(true)}
                onMouseLeave={() => setIsLinkHovered(false)}
                className="inline-flex items-center gap-2 text-sm sm:text-base text-neutral-900 dark:text-white font-medium cursor-pointer hover:opacity-70 transition-opacity duration-200"
              >
                Explore product
                <motion.span
                  animate={{ x: isLinkHovered ? 4 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ArrowRight className="w-4 h-4" />
                </motion.span>
              </a>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="relative w-full"
          >
            <div className="w-full aspect-4/3 rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-xl">
              <img
                src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=900&fit=crop"
                alt="Product preview"
                className="w-full h-full object-cover"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default Hero14;
