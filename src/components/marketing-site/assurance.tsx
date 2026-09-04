"use client";

import { motion, useInView } from "motion/react";
import { useRef, type ReactNode } from "react";

import { RevealHeadline } from "./reveal-headline";

const easeOutExpo = [0.33, 1, 0.68, 1] as const;

/**
 * Where patient data goes, what this touches, and what happens when it breaks.
 *
 * **The page had nothing on any of it**, which for a hospital is the question
 * asked immediately after "does it work". Anthropod devotes two sections to
 * exactly this — "Connects with the systems your hospital already runs" and
 * "Built for hospital IT realities" — and we were silent, which on a healthcare
 * site does not read as modesty.
 *
 * Every claim here is something that exists rather than a policy statement:
 * `organizations.record_calls` and `retention_days` are columns a customer
 * owns, the outcome delivery is a webhook carrying the call id as an
 * idempotency key, and the escalation number is bound per line. Written that
 * way on purpose — a reassurance section is where a page is most tempted to
 * describe an intention as though it were a mechanism.
 */
const POINTS = [
    {
        term: "Recording is yours to switch off",
        body: "Calls are recorded only if you ask for it, and how long anything is kept is a number you set. When it lapses, the content goes. It is a setting on your workspace rather than a policy we apply to everybody.",
    },
    {
        term: "It reaches your systems, not the reverse",
        body: "Outcomes are delivered outward as a webhook carrying the fields you defined, keyed on the call so a retry can never write a second record. Nothing is installed beside your HIS and no database is opened to us.",
    },
    {
        term: "It escalates rather than improvises",
        body: "A symptom, a dose question or a patient who sounds unwell is not something it answers. Each department names the number those go to, and they go there during the call — with what the patient said, not as a task somebody opens later.",
    },
] as const;

export function Assurance(): ReactNode {
    const ref = useRef<HTMLElement>(null);
    const inView = useInView(ref, { once: true, amount: 0.2 });

    return (
        <section
            ref={ref}
            id="trust"
            className="relative w-full bg-background text-foreground"
            aria-labelledby="trust-heading"
        >
            <div className="mx-auto max-w-[1680px] px-10 py-32 max-[850px]:px-6 max-[850px]:py-24">
                <div className="grid grid-cols-12 gap-x-10 max-[850px]:grid-cols-1">
                    <div className="col-span-3 pt-2 max-[1100px]:col-span-12 max-[850px]:col-span-1">
                        <motion.span
                            initial={{ opacity: 0, y: 8 }}
                            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                            transition={{ duration: 0.6, ease: easeOutExpo }}
                            className="inline-flex items-center rounded-md border border-foreground/[0.08] px-3.5 py-1.5 font-mono text-xs tracking-widest text-foreground/70 uppercase"
                        >
                            Before you ask
                        </motion.span>
                    </div>

                    <div className="col-span-7 col-start-6 max-[1100px]:col-span-12 max-[1100px]:col-start-1 max-[850px]:col-span-1">
                        <RevealHeadline
                            id="trust-heading"
                            delay={0.05}
                            className="text-[clamp(2rem,4.2vw,4rem)] leading-[0.85] font-medium tracking-tight text-balance"
                        >
                            What it touches, and what it is never allowed to do.
                        </RevealHeadline>
                    </div>
                </div>

                <dl className="mt-20 grid grid-cols-3 gap-5 max-[1100px]:grid-cols-1 max-[1100px]:gap-4 max-[850px]:mt-12">
                    {POINTS.map((point, i) => (
                        <motion.div
                            key={point.term}
                            initial={{ opacity: 0, y: 16 }}
                            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
                            transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.1 + i * 0.08 }}
                            className="flex flex-col gap-3 border-t border-foreground/[0.12] pt-6"
                        >
                            <dt className="text-lg font-medium tracking-tight">{point.term}</dt>
                            <dd className="max-w-[46ch] leading-relaxed text-foreground/60">
                                {point.body}
                            </dd>
                        </motion.div>
                    ))}
                </dl>
            </div>
        </section>
    );
}
