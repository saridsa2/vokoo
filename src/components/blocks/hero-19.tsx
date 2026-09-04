"use client";

/* Icons come from the shim, not lucide — the project rule, and our lucide is
   v1 where several of these names have moved. */
import {
  CheckCircle as CheckCircle2,
  PhoneVolume as Clock3,
  LayerGroup as Layers2,
  Edit01 as PenLine,
  ShieldCheck,
} from "@/components/icons";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react";

/* One cohort, as the practitioner sees it.
 *
 * **Every row is on the same care path**, at a different point in it. An
 * earlier cut headed this "Chemotherapy cohort" and then listed a postpartum
 * patient and a type 2 diabetes patient inside it, which contradicts the
 * model: a cohort is defined by its path, and one agent per path is
 * instantiated per patient in that cohort. Three paths cannot be one cohort. */
const invoices = [
  {
    initials: "SM",
    name: "S. Mehta",
    terms: "Cycle 2 · day 3",
    status: "Answered",
    solid: true,
  },
  {
    initials: "RK",
    name: "R. Kaur",
    terms: "Cycle 1 · day 13",
    status: "With a nurse",
    solid: false,
  },
  {
    initials: "AP",
    name: "A. Prasad",
    terms: "Cycle 3 · day 20",
    status: "Not reached",
    solid: false,
  },
];

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

const headline: Variants = {
  hidden: { opacity: 0, y: 26, filter: "blur(8px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.75, ease: [0.22, 1, 0.36, 1] },
  },
};

const panel: Variants = {
  hidden: { opacity: 0, y: 32, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.75,
      ease: [0.22, 1, 0.36, 1],
      staggerChildren: 0.07,
      delayChildren: 0.25,
    },
  },
};

const panelRow: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

const bar: Variants = {
  hidden: { scaleX: 0 },
  show: {
    scaleX: 1,
    transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 },
  },
};

export function Hero19() {
  const reduceMotion = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, {
    stiffness: 90,
    damping: 28,
    mass: 0.8,
  });
  const springY = useSpring(pointerY, {
    stiffness: 90,
    damping: 28,
    mass: 0.8,
  });
  const cardX = useTransform(springX, [-0.5, 0.5], [-6, 6]);
  const cardY = useTransform(springY, [-0.5, 0.5], [-4, 4]);
  const floatAX = useTransform(springX, [-0.5, 0.5], [14, -14]);
  const floatAY = useTransform(springY, [-0.5, 0.5], [10, -10]);
  const floatBX = useTransform(springX, [-0.5, 0.5], [10, -10]);
  const floatBY = useTransform(springY, [-0.5, 0.5], [-8, 8]);

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (reduceMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
  };

  return (
    <section
      onPointerMove={handlePointerMove}
      className="relative flex min-h-screen w-full items-start overflow-hidden bg-white px-4 py-16 dark:bg-neutral-950 sm:px-6 sm:py-20 lg:items-center lg:px-8"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0px,transparent_95px,rgba(23,23,23,0.035)_95px,rgba(23,23,23,0.035)_96px)] [mask-image:linear-gradient(to_bottom,black,transparent_88%)] dark:bg-[repeating-linear-gradient(90deg,transparent_0px,transparent_95px,rgba(250,250,250,0.04)_95px,rgba(250,250,250,0.04)_96px)]" />
        <div className="absolute -top-32 right-[-10%] h-[480px] w-[480px] rounded-full bg-neutral-100 blur-[120px] dark:bg-neutral-900/80" />
        <div className="absolute bottom-[-20%] left-[-8%] h-[400px] w-[400px] rounded-full bg-neutral-50 blur-[100px] dark:bg-neutral-900/50" />
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="relative z-10 mx-auto w-full max-w-[1400px]"
      >
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16 xl:gap-20">
          <div className="flex flex-col items-start">
            <motion.p
              variants={item}
              className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400"
            >
              Care paths · Cohorts · Practitioners
            </motion.p>

            <motion.h1
              variants={headline}
              className="mt-8 max-w-2xl font-serif text-4xl font-medium leading-[1.08] tracking-tight text-neutral-950 dark:text-white sm:text-5xl lg:text-6xl"
            >
              The care path, running itself.
            </motion.h1>

            <motion.p
              variants={item}
              className="mt-6 max-w-xl text-base leading-relaxed text-neutral-600 dark:text-neutral-400 sm:text-lg"
            >
              Sarvathra turns the care paths your teams already follow into agents
              that call every patient on them — asking what the path asks, listening
              to the reply, and bringing a nurse on when the answer needs one.
            </motion.p>

            <motion.div
              variants={item}
              className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row"
            >
              <button className="inline-flex w-full cursor-pointer items-center justify-center rounded-full bg-neutral-950 px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 dark:focus-visible:ring-neutral-500 dark:focus-visible:ring-offset-neutral-950 sm:w-auto sm:px-8 sm:py-3.5 sm:text-base">
                Hear it answer
              </button>
              <button className="inline-flex w-full cursor-pointer items-center justify-center rounded-full border border-neutral-300 bg-white px-6 py-3 text-sm font-medium text-neutral-900 transition-colors duration-200 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900 dark:focus-visible:ring-neutral-500 dark:focus-visible:ring-offset-neutral-950 sm:w-auto sm:px-8 sm:py-3.5 sm:text-base">
                hello@sarvathra.ai
              </button>
            </motion.div>

            <motion.div
              variants={item}
              className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-neutral-200 pt-6 dark:border-neutral-800"
            >
              <span className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <ShieldCheck className="h-4 w-4" />
                Escalates to a person, never advises
              </span>
              <span className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <Clock3 className="h-4 w-4" />
                Hindi and English, phone and WhatsApp
              </span>
            </motion.div>
          </div>

          <motion.div variants={panel} className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-8 rounded-[3rem] bg-neutral-100 blur-3xl dark:bg-neutral-900"
            />

            <motion.div style={{ x: cardX, y: cardY }} className="relative">
              <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-2xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40 sm:p-6">
                <motion.div
                  variants={panelRow}
                  className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-5 dark:border-neutral-800"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
                      <Layers2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-neutral-950 dark:text-white">
                        Chemotherapy cohort
                      </p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        48 patients · 3 practitioners
                      </p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-neutral-950 dark:bg-white" />
                    Running
                  </span>
                </motion.div>

                <div className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
                  {invoices.map((invoice) => (
                    <motion.div
                      key={invoice.name}
                      variants={panelRow}
                      className="flex items-center gap-3 py-4"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        {invoice.initials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-950 dark:text-white">
                          {invoice.name}
                        </p>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          {invoice.terms}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                          invoice.solid
                            ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"
                            : "border border-neutral-200 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
                        }`}
                      >
                        {invoice.status}
                      </span>
                    </motion.div>
                  ))}
                </div>

                <motion.div
                  variants={panelRow}
                  className="mt-2 rounded-2xl bg-neutral-50 p-4 dark:bg-neutral-950 sm:p-5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.15em] text-neutral-500 dark:text-neutral-400">
                      Reached this week
                    </p>
                    <p className="text-lg font-semibold tracking-tight text-neutral-950 dark:text-white">
                      44 of 48
                    </p>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <motion.div
                      variants={bar}
                      className="h-full w-[78%] origin-left rounded-full bg-neutral-950 dark:bg-white"
                    />
                  </div>
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    Four still to reach · retries are part of the path
                  </p>
                </motion.div>
              </div>
            </motion.div>

            <motion.div
              variants={panelRow}
              className="absolute -top-6 right-2 hidden sm:block lg:-right-6"
            >
              <motion.div
                style={{ x: floatAX, y: floatAY }}
                className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-neutral-950 dark:text-white">
                    Handed to a nurse
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    R. Kaur · during the call
                  </p>
                </div>
              </motion.div>
            </motion.div>

            <motion.div
              variants={panelRow}
              className="absolute -bottom-6 left-2 hidden sm:block lg:-left-8"
            >
              <motion.div
                style={{ x: floatBX, y: floatBY }}
                className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
                  <PenLine className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-neutral-950 dark:text-white">
                    Written back
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    S. Mehta · into your records
                  </p>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}

export default Hero19;
