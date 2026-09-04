"use client";

import {
  animate,
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, type ReactNode } from "react";
import { ArrowChip } from "@/components/marketing-site/arrow-chip";
import { ShaderCanvas } from "@/components/marketing-site/shader-canvas";
import { Nav } from "@/components/marketing-site/nav";

const easeOutExpo = [0.33, 1, 0.68, 1] as const;

const START_W = 110;
const START_H = 60;
const FINAL_RADIUS = 24;
const FRAME_INSET = 10; 

const SCROLL_RANGE = 80;

export function Hero(): ReactNode {

  const progress = useMotionValue(0);

  const { scrollY } = useScroll();
  const rawExit = useTransform(scrollY, [0, SCROLL_RANGE], [0, 1], {
    clamp: true,
  });

  const exit = useSpring(rawExit, {
    stiffness: 120,
    damping: 22,
    mass: 0.4,
  });

  const padding = useTransform(exit, [0, 1], [FRAME_INSET, 0]);

  const width = useTransform(
    progress,
    (p) => `calc(${START_W}px + (100% - ${START_W}px) * ${p})`,
  );
  const height = useTransform(
    progress,
    (p) => `calc(${START_H}px + (100% - ${START_H}px) * ${p})`,
  );

  const borderRadius = useTransform([progress, exit], (latest) => {
    const [p, e] = latest as [number, number];

    const viewportH =
      typeof window !== "undefined" ? window.innerHeight - 20 : 800;
    const h = START_H + (viewportH - START_H) * p;
    const pillRadius = h / 2;

    const PILL_HOLD = 0.4;
    const t = Math.max(0, (p - PILL_HOLD) / (1 - PILL_HOLD));
    const eased = t * t * (3 - 2 * t);

    const entranceRadius = pillRadius * (1 - eased) + FINAL_RADIUS * eased;

    return entranceRadius * (1 - e);
  });

  useEffect(() => {
    const controls = animate(progress, 1, {
      duration: 1.8,
      ease: easeOutExpo,
    });
    return () => controls.stop();
  }, [progress]);

  return (
    <>
      <Nav delay={1.3} />

      <motion.section
        className="relative w-full h-screen"
        style={{ padding }}
      >
      <div className="relative w-full h-full flex items-center justify-center">
        <motion.div
          className="relative overflow-hidden bg-[#0a2430]"
          style={{ width, height, borderRadius }}
        >
          <div aria-hidden="true" className="absolute inset-0 w-full h-full">
            <ShaderCanvas />
          </div>

          <motion.div
            className="absolute inset-0 flex flex-col justify-between p-10 pt-40 max-[850px]:p-6 max-[850px]:pt-32 text-white pointer-events-none max-w-[1680px] mx-auto"
            initial="hidden"
            animate="visible"
            transition={{ staggerChildren: 0.12, delayChildren: 1.4 }}
          >
            <motion.h1
              className="max-w-[22ch] text-[clamp(2.75rem,7.75vw,7.75rem)] font-medium leading-[0.95] tracking-tight"
              variants={{
                hidden: {},
                visible: {},
              }}
              transition={{ staggerChildren: 0.12 }}
            >
              {["Care pathways", "that make the call."].map((line) => (
                <span
                  key={line}
                  className="block overflow-hidden pb-[0.05em]"
                >
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
            </motion.h1>

            <div className="flex items-end justify-between gap-8 max-[850px]:flex-col max-[850px]:items-start">
              <motion.p
                className="max-w-2xl text-2xl font-medium leading-snug tracking-tight text-white/90"
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  visible: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.8, ease: easeOutExpo }}
              >
                One chemotherapy cycle is a dozen contacts before it happens.
                Sarvathra runs them as agents — the pre-cycle labs, the
                reminder, the symptom check after — so your coordinators spend
                the day on the patients who need a person.
              </motion.p>

              {/* **The demo is the product.** There is no signup to send
                  anybody to, and for a thing that answers the phone the
                  honest call to action is the phone: this number is live and
                  a Sarvathra agent picks it up. */}
              <motion.a
                href="tel:+918040802529"
                className="group pointer-events-auto inline-flex items-stretch gap-1 cursor-pointer"
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  visible: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.8, ease: easeOutExpo }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <span className="px-5 py-3 rounded-md bg-white text-neutral-900 text-xs font-medium tracking-widest uppercase border border-neutral-900/[0.08]">
                  Call +91 80408 02529
                </span>
                <ArrowChip className="bg-accent text-accent-foreground" />
              </motion.a>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </motion.section>
    </>
  );
}
