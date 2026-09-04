"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";

const categories = [
  {
    id: "path",
    label: "The care path",
    description: "What a pack is, and how much of it is yours to change.",
    faqs: [
      {
        question: "What exactly is a pack?",
        answer:
          "The care path drawn as a graph, the agents that speak it, the skills they use inside a conversation, and the tools that reach your systems. NICE and ICMR define the path; we ship it as something that runs, and you change what your department does differently.",
      },
      {
        question: "Can we change the path we are given?",
        answer:
          "Yes, and most departments do. The pack is a template rather than a fixed product. We help with the customisation.",
      },
      {
        question: "Can different departments run different paths?",
        answer:
          "That is the usual shape. A cohort is defined by one care path, so oncology and obstetrics each have their own, and a department can change its own without a release.",
      },
    ],
  },
  {
    id: "call",
    label: "The conversation",
    description: "What it asks, what it will not do, and who it hands to.",
    faqs: [
      {
        question: "Does it give clinical advice?",
        answer:
          "No, and it is built so that it cannot drift into doing so. It asks the questions the path specifies and records the answers. A symptom, a dose question or a sign of deterioration is handed to a person.",
      },
      {
        question: "What happens if a patient reports something serious?",
        answer:
          "The call is escalated to a number your department nominates, during the same call rather than as a task somebody opens later, and what the patient said travels with it.",
      },
      {
        question: "Which languages and channels?",
        answer:
          "Hindi and English today, on the phone and over WhatsApp. The language is settled before the conversation starts, so the ear, the voice and the wording stay in one language for the whole call.",
      },
      {
        question: "What about patients who do not answer?",
        answer:
          "Retries are part of the path rather than a setting buried somewhere: how many, how far apart, and what happens when the attempts are exhausted — usually a coordinator's list, now short.",
      },
    ],
  },
  {
    id: "data",
    label: "Your data",
    description: "Where it goes, how long it stays, and what reaches your systems.",
    faqs: [
      {
        question: "Does it write into our HIS?",
        answer:
          "It delivers outward. After a call it reads the conversation into the fields you defined and posts them to your HIS or CRM, carrying the call id so that a retry cannot create a second record. Nothing is installed beside your systems.",
      },
      {
        question: "Where does patient data go?",
        answer:
          "It stays in your workspace. Recording is off unless you turn it on, and how long a call's content is kept is a number you set — when it lapses the content is deleted.",
      },
      {
        question: "Can we see it run before it touches a patient?",
        answer:
          "Yes, and this is the part worth asking about. A path can be replayed against a finished call and shows every step's input, output and timing — including exactly what would have been written to your systems, without writing it.",
      },
    ],
  },
]

export default function FAQ7() {
  const reduce = useReducedMotion();
  const [activeId, setActiveId] = useState(categories[0].id);
  const [openIndex, setOpenIndex] = useState(0);
  const active =
    categories.find((category) => category.id === activeId) ?? categories[0];

  const selectCategory = (id: string) => {
    setActiveId(id);
    setOpenIndex(0);
  };

  const list: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.06 } },
  };
  const row: Variants = {
    hidden: { opacity: 0, y: reduce ? 0 : 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
    },
  };

  return (
    <section className="w-full bg-white px-4 py-16 dark:bg-neutral-950 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto w-full max-w-[1400px]">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <h2 className="text-3xl font-medium leading-[1.1] tracking-tighter text-neutral-900 dark:text-white sm:text-4xl lg:text-5xl">
            What a hospital asks first
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
            Answers organized the way you evaluate: from first login to security
            review.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10 grid grid-cols-1 gap-8 lg:mt-14 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12"
        >
          <div
            role="tablist"
            aria-label="Question categories"
            aria-orientation="vertical"
            className="flex gap-1.5 overflow-x-auto pb-1 lg:sticky lg:top-24 lg:flex-col lg:self-start lg:overflow-visible lg:pb-0"
          >
            {categories.map((category) => {
              const isActive = category.id === activeId;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  id={`faq7-tab-${category.id}`}
                  aria-selected={isActive}
                  aria-controls={`faq7-panel-${category.id}`}
                  onClick={() => selectCategory(category.id)}
                  className={`relative shrink-0 cursor-pointer rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 dark:focus-visible:ring-white ${
                    isActive
                      ? "text-neutral-900 dark:text-white"
                      : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="faq7-active-tab"
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute inset-0 rounded-xl bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
                    />
                  )}
                  <span className="relative z-10 flex items-center justify-between gap-4">
                    {category.label}
                    <span
                      className={`text-xs tabular-nums transition-colors duration-200 ${
                        isActive
                          ? "text-neutral-400 dark:text-neutral-500"
                          : "text-neutral-400 dark:text-neutral-600"
                      }`}
                    >
                      {category.faqs.length}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="min-h-[430px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active.id}
                role="tabpanel"
                id={`faq7-panel-${active.id}`}
                aria-labelledby={`faq7-tab-${active.id}`}
                initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -8 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden rounded-3xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="border-b border-neutral-200 px-6 py-5 dark:border-neutral-800 sm:px-8 sm:py-6">
                  <h3 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white">
                    {active.label}
                  </h3>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {active.description}
                  </p>
                </div>
                <motion.div variants={list} initial="hidden" animate="show">
                  {active.faqs.map((faq, index) => {
                    const isOpen = openIndex === index;
                    return (
                      <motion.div
                        key={faq.question}
                        variants={row}
                        className={
                          index !== active.faqs.length - 1
                            ? "border-b border-neutral-200 dark:border-neutral-800"
                            : ""
                        }
                      >
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={`faq7-answer-${active.id}-${index}`}
                          onClick={() => setOpenIndex(isOpen ? -1 : index)}
                          className="group flex w-full cursor-pointer items-center justify-between gap-5 px-6 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900 dark:focus-visible:ring-white sm:px-8 sm:py-6"
                        >
                          <span className="flex-1 text-base font-medium leading-snug text-neutral-900 transition-colors duration-200 group-hover:text-neutral-600 dark:text-white dark:group-hover:text-neutral-300">
                            {faq.question}
                          </span>
                          <motion.span
                            animate={{ rotate: isOpen ? 45 : 0 }}
                            transition={{
                              duration: 0.35,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
                              isOpen
                                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                                : "bg-neutral-100 text-neutral-500 group-hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-400 dark:group-hover:text-white"
                            }`}
                          >
                            <Plus className="h-4 w-4" />
                          </motion.span>
                        </button>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div
                              id={`faq7-answer-${active.id}-${index}`}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{
                                height: {
                                  duration: 0.4,
                                  ease: [0.22, 1, 0.36, 1],
                                },
                                opacity: {
                                  duration: 0.3,
                                  ease: [0.22, 1, 0.36, 1],
                                },
                              }}
                              className="overflow-hidden"
                            >
                              <p className="max-w-2xl px-6 pb-6 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400 sm:px-8 sm:pb-7 sm:text-base">
                                {faq.answer}
                              </p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
