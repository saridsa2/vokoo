"use client";

import { motion } from "motion/react";
import { ArrowRight } from "@/components/icons";

export default function Footer4() {
  /* Only destinations that exist. The block shipped Whitepaper, Tokenomics,
     Bug Bounty and an SDK — a crypto footer. A column of dead anchors fails
     the moment anybody clicks one. */
  const footerColumns = [
    {
      title: "Care paths",
      links: [
        { text: "Chemotherapy", href: "#care-paths" },
        { text: "Type 2 diabetes", href: "#care-paths" },
        { text: "Postpartum", href: "#care-paths" },
        { text: "GLP-1 therapy", href: "#care-paths" },
      ],
    },
    {
      title: "Platform",
      links: [
        { text: "How it works", href: "#how-it-works" },
        { text: "Questions", href: "#faq" },
      ],
    },
    {
      title: "Talk to us",
      links: [
        { text: "+91 80408 02529", href: "tel:+918040802529" },
        { text: "hello@sarvathra.ai", href: "mailto:hello@sarvathra.ai" },
      ],
    },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
      },
    },
  };

  return (
    <footer className="w-full bg-white dark:bg-neutral-950 px-4 sm:px-6 lg:px-8">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
      >
        <div className="mx-auto w-full max-w-[1400px]">
          <motion.div variants={itemVariants} className="py-12">
            <h2 className="text-3xl font-medium tracking-tight leading-tight text-neutral-900 dark:text-white sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl">
              Your care, wherever
              <br />
              your patient is.
            </h2>
          </motion.div>
        </div>

        <div className="border-y border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
            <motion.div
              variants={itemVariants}
              className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_1.5fr]"
            >
              <div className="border-b border-neutral-200 py-8 dark:border-neutral-800 lg:border-b-0 lg:border-r lg:py-8 lg:pr-8">
                <div>
                  <h3 className="mb-6 text-lg font-medium tracking-tight text-neutral-900 dark:text-white sm:text-xl">
                    Talk to the thing itself.
                  </h3>

                  <a
                    href="tel:+918040802529"
                    className="mb-6 inline-flex items-center gap-3 border border-neutral-300 px-4 py-3 text-sm text-neutral-900 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-800 sm:px-6 sm:py-4 sm:text-base"
                  >
                    +91 80408 02529
                    <ArrowRight className="h-5 w-5" />
                  </a>

                  <p className="text-xs text-neutral-600 dark:text-neutral-400 sm:text-sm">
                    It answers. The first conversation after that is about one
                    department, one care path, and where its patient records live.
                  </p>
                </div>
              </div>

              <div className="py-8 lg:py-8 lg:pl-8">
                <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
                  {footerColumns.map((column) => (
                    <div key={column.title}>
                      <h4 className="mb-4 text-sm font-medium tracking-tight text-neutral-900 dark:text-white sm:mb-6 sm:text-base">
                        {column.title}
                      </h4>
                      <ul className="space-y-3">
                        {column.links.map((link) => (
                          <li key={link.text}>
                            <a
                              href={link.href}
                              className="text-sm tracking-tight text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white sm:text-base"
                            >
                              {link.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <motion.div variants={itemVariants} className="py-8">
            <div className="mb-4">
              <h2 className="text-5xl font-medium text-neutral-900 dark:text-white sm:text-6xl md:text-7xl lg:text-8xl">
                Sarvathra
              </h2>
            </div>

            <div className="flex flex-col gap-4 text-xs text-neutral-600 dark:text-neutral-400 sm:flex-row sm:items-center sm:text-sm">
              <p>©{new Date().getFullYear()} Sarvathra</p>
              <span className="hidden sm:inline">•</span>
              <a
                href="mailto:hello@sarvathra.ai"
                className="transition-colors hover:text-neutral-900 dark:hover:text-white"
              >
                hello@sarvathra.ai
              </a>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </footer>
  );
}
