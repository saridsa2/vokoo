"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { RevealHeadline } from "./reveal-headline";

/**
 * One patient's fortnight, in two states, with the reader dragging between
 * them.
 *
 * This replaces three filled cards that said "here are the problems" in three
 * paragraphs. The problem and the answer are the same fortnight seen twice, so
 * a comparison holds both at once and the reader has something to do with it —
 * which no arrangement of boxes was going to give.
 *
 * ## Only the outcomes are wiped
 *
 * The first version wiped the whole table, which is what an image comparison
 * does and what React Bits' `comparison-7` does. Over text it does not work:
 * each pane's content hugs one edge, so at any divider position one pane shows
 * its writing and the other shows an empty field. Dragging revealed a blank
 * grey rectangle, not a second reading.
 *
 * The fix came from the content. **A protocol does not change between the two
 * states** — the same five contacts are due on the same five days either way.
 * What changes is whether anyone made them. So the protocol is written once,
 * fixed, and the divider lives inside the outcome column alone. Today's
 * outcomes hug its left edge and the answered ones its right, which is what
 * lets both be legible at once at any divider position.
 *
 * That is also the argument, drawn rather than asserted: the protocol is not
 * the thing that is missing.
 *
 * ## What is kept from `comparison-7`
 *
 * The drag mechanic, because it is complete: pointer capture so the pointer
 * can leave the element mid-drag, a touch guard so a thumb travelling down the
 * page still scrolls, and `role="slider"` with arrow keys for anyone not using
 * a mouse.
 */

const easeOutExpo = [0.33, 1, 0.68, 1] as const;

const MIN = 0;
const MAX = 100;

/** Both columns lay their rows out over this, so the two cannot drift apart. */
const BOARD_HEIGHT = "h-[460px]";
/** Explicit rather than derived from padding, for the same reason. */
const HEAD_HEIGHT = "h-14";

interface Day {
    day: string;
    /** What the protocol asks for. The same in both states. */
    asks: string;
    /** What happens on a ward with no spare hands. */
    today: string;
    /** What happens when the protocol carries itself out. */
    answered: string;
    /** The one day she was unwell. It reads differently. */
    urgent?: boolean;
}

const DAYS: Day[] = [
    {
        day: "Day 2",
        asks: "Temperature, and how she slept",
        today: "Nobody had the time",
        answered: "Asked. 37.4, written down",
    },
    {
        day: "Day 5",
        asks: "Eating, drinking, keeping it down",
        today: "Rang once, no answer",
        answered: "Rang twice. Reached her at six",
    },
    {
        day: "Day 8",
        asks: "The line site, and the pain",
        today: "Asked at the desk, onto a slip",
        answered: "In her record that evening",
    },
    {
        day: "Day 11",
        asks: "The next cycle, and getting here",
        today: "She came a day late",
        answered: "Confirmed. She came on the day",
    },
    {
        /* Every other row is a question the protocol asks. This one was
           written as something she reported, under a column headed "what her
           protocol asks for" — so it was the one row the header did not
           describe. */
        day: "Day 13",
        asks: "Any fever, any chills",
        today: "She waited until Monday",
        answered: "38.1 — a nurse came on the line",
        urgent: true,
    },
];

/**
 * One side of the wipe: five outcomes over the same five rows.
 *
 * Each variant hugs its own edge — today's at the left, the answered ones at
 * the right — so wherever the divider falls, neither is cut mid-sentence.
 */
function Outcomes({ variant }: { variant: "today" | "answered" }): ReactNode {
    const answered = variant === "answered";

    return (
        <div
            className={[
                "absolute inset-0 flex flex-col px-6",
                answered ? "bg-foreground text-paper" : "bg-muted",
            ].join(" ")}
        >
            <div
                className={[
                    HEAD_HEIGHT,
                    "flex shrink-0 items-center gap-3 border-b",
                    answered ? "justify-end border-paper/15" : "border-foreground/10",
                ].join(" ")}
            >
                <span
                    className={[
                        "font-mono text-xs uppercase tracking-[0.2em] whitespace-nowrap",
                        answered ? "text-paper" : "text-foreground/45",
                    ].join(" ")}
                >
                    {answered ? "With Sarvathra" : "As it runs today"}
                </span>
                <span
                    className={[
                        "font-mono text-xs tabular-nums",
                        answered ? "text-paper/55" : "text-foreground/35",
                    ].join(" ")}
                >
                    {answered ? "5 of 5" : "1 of 5"}
                </span>
            </div>

            <div className="flex flex-1 flex-col">
                {DAYS.map((entry) => (
                    <div
                        key={entry.day}
                        className={[
                            "flex flex-1 items-center gap-3 border-b last:border-b-0",
                            answered ? "justify-end border-paper/10" : "border-foreground/[0.07]",
                        ].join(" ")}
                    >
                        {/* A ring for a contact that did not happen, a filled
                            mark for one that did. Two states of one symbol
                            rather than two symbols — it is the same row. */}
                        {!answered && (
                            <span
                                aria-hidden
                                className="h-1.5 w-1.5 shrink-0 rounded-full border border-foreground/25"
                            />
                        )}
                        <span
                            className={[
                                "truncate text-sm leading-snug",
                                answered
                                    ? entry.urgent
                                        ? "text-brand-cyan"
                                        : "text-paper/85"
                                    : "text-foreground/45",
                            ].join(" ")}
                        >
                            {answered ? entry.answered : entry.today}
                        </span>
                        {answered && (
                            <span
                                aria-hidden
                                className={[
                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                    entry.urgent ? "bg-brand-cyan" : "bg-paper",
                                ].join(" ")}
                            />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function Fortnight(): ReactNode {
    const sectionRef = useRef<HTMLElement>(null);
    const inView = useInView(sectionRef, { once: true, amount: 0.2 });

    const trackRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLButtonElement>(null);
    /* A ref as well as state: the pointer handlers read it on every move and a
       state read there would be one frame behind. */
    const draggingRef = useRef(false);
    const [position, setPosition] = useState(52);
    const [dragging, setDragging] = useState(false);
    const reduce = useReducedMotion();

    const updateFromClientX = useCallback((clientX: number) => {
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        const pct = ((clientX - rect.left) / rect.width) * 100;
        setPosition(Math.min(MAX, Math.max(MIN, pct)));
    }, []);

    /* While a finger or mouse is down the divider must track it exactly. A
       tween there would lag behind the pointer and read as the page being
       slow. */
    const slide = dragging || reduce ? { duration: 0 } : { duration: 0.5, ease: easeOutExpo };

    return (
        <section
            ref={sectionRef}
            className="relative w-full bg-background text-foreground"
            aria-labelledby="fortnight-heading"
        >
            <div className="mx-auto max-w-[1680px] px-10 py-32 max-[850px]:px-6 max-[850px]:py-24">
                <div className="grid grid-cols-12 gap-x-10 gap-y-6 max-[850px]:grid-cols-1">
                    <div className="col-span-3 pt-2 max-[1100px]:col-span-12 max-[850px]:col-span-1">
                        <motion.span
                            initial={{ opacity: 0, y: 8 }}
                            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                            transition={{ duration: 0.6, ease: easeOutExpo }}
                            className="inline-flex items-center rounded-md border border-foreground/[0.08] px-3.5 py-1.5 font-mono text-xs uppercase tracking-widest text-foreground/70"
                        >
                            Problems healthcare faces
                        </motion.span>
                    </div>

                    <div className="col-span-7 col-start-6 max-[1100px]:col-span-12 max-[1100px]:col-start-1 max-[850px]:col-span-1">
                        <RevealHeadline
                            id="fortnight-heading"
                            delay={0.05}
                            className="text-balance text-[clamp(2rem,4.2vw,4rem)] font-medium leading-[0.85] tracking-tight"
                        >
                            One patient&rsquo;s fortnight, twice.
                        </RevealHeadline>

                        <motion.p
                            initial={{ opacity: 0, y: 8 }}
                            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                            transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.22 }}
                            className="mt-6 max-w-[46ch] text-base leading-relaxed text-foreground/60 max-[850px]:text-sm"
                        >
                            She went home after her second cycle. The protocol is the same on
                            both sides. Drag it.
                        </motion.p>
                    </div>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                    transition={{ duration: 0.8, ease: easeOutExpo, delay: 0.3 }}
                    className="mt-20 max-[850px]:mt-12"
                >
                    <div className={[BOARD_HEIGHT, "flex max-[850px]:hidden"].join(" ")}>
                        {/* The protocol. Written once, because it is the one
                            thing the two states agree on. */}
                        <div className="flex w-[54%] flex-col pr-10">
                            <div
                                className={[
                                    HEAD_HEIGHT,
                                    "flex shrink-0 items-center border-b border-foreground/10",
                                ].join(" ")}
                            >
                                <span className="font-mono text-xs uppercase tracking-[0.2em] text-foreground/45">
                                    What her protocol asks for
                                </span>
                            </div>
                            <div className="flex flex-1 flex-col">
                                {DAYS.map((entry) => (
                                    <div
                                        key={entry.day}
                                        className="flex flex-1 items-center gap-6 border-b border-foreground/[0.07] last:border-b-0"
                                    >
                                        <span className="w-16 shrink-0 font-mono text-xs uppercase tabular-nums text-foreground/30">
                                            {entry.day}
                                        </span>
                                        <span className="truncate text-[15px] leading-snug">
                                            {entry.asks}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* What came of it, in two readings, one over the
                            other. */}
                        <div
                            ref={trackRef}
                            onPointerDown={(event) => {
                                /* On touch, only the handle starts a drag — otherwise a
                                   thumb travelling down the page is captured here and
                                   the section becomes a place scrolling stops. */
                                const fromHandle =
                                    handleRef.current?.contains(event.target as Node) ?? false;
                                if (event.pointerType === "touch" && !fromHandle) return;
                                draggingRef.current = true;
                                setDragging(true);
                                event.currentTarget.setPointerCapture(event.pointerId);
                                updateFromClientX(event.clientX);
                            }}
                            onPointerMove={(event) => {
                                if (draggingRef.current) updateFromClientX(event.clientX);
                            }}
                            onPointerUp={() => {
                                draggingRef.current = false;
                                setDragging(false);
                            }}
                            onPointerCancel={() => {
                                draggingRef.current = false;
                                setDragging(false);
                            }}
                            className="relative w-[46%] cursor-ew-resize select-none"
                        >
                            <div className="absolute inset-0 overflow-hidden">
                                <Outcomes variant="today" />
                                {/* Clipped from the left, so the answered
                                    reading owns the right of the divider —
                                    the side its label is on. */}
                                <motion.div
                                    initial={false}
                                    animate={{ clipPath: `inset(0 0 0 ${position}%)` }}
                                    transition={slide}
                                    className="absolute inset-0 z-10"
                                >
                                    <Outcomes variant="answered" />
                                </motion.div>
                            </div>

                            <motion.div
                                aria-hidden
                                initial={false}
                                animate={{ left: `${position}%` }}
                                transition={slide}
                                className="absolute inset-y-0 z-20 w-px -translate-x-1/2 bg-brand-cyan"
                            />

                            <motion.div
                                initial={false}
                                animate={{ left: `${position}%` }}
                                transition={slide}
                                className="absolute top-1/2 z-30"
                            >
                                <button
                                    ref={handleRef}
                                    type="button"
                                    role="slider"
                                    aria-label="Reveal the fortnight with Sarvathra"
                                    aria-orientation="horizontal"
                                    aria-valuemin={MIN}
                                    aria-valuemax={MAX}
                                    aria-valuenow={Math.round(position)}
                                    aria-valuetext={`${Math.round(position)}% revealed`}
                                    onKeyDown={(event) => {
                                        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                                            event.preventDefault();
                                            setPosition((value) => Math.max(MIN, value - 6));
                                        } else if (
                                            event.key === "ArrowRight" ||
                                            event.key === "ArrowUp"
                                        ) {
                                            event.preventDefault();
                                            setPosition((value) => Math.min(MAX, value + 6));
                                        } else if (event.key === "Home") {
                                            event.preventDefault();
                                            setPosition(MIN);
                                        } else if (event.key === "End") {
                                            event.preventDefault();
                                            setPosition(MAX);
                                        }
                                    }}
                                    className="flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center gap-0.5 rounded-full bg-brand-cyan text-paper"
                                >
                                    <ChevronLeft className="h-3 w-3" />
                                    <ChevronRight className="h-3 w-3" />
                                </button>
                            </motion.div>
                        </div>
                    </div>

                    {/* Below 850px there is no width to drag across, so the two
                        readings sit under each other per day. Same array, so
                        the two layouts cannot come to say different things. */}
                    <div className="hidden max-[850px]:block">
                        {DAYS.map((entry) => (
                            <div
                                key={entry.day}
                                className="border-b border-foreground/[0.07] py-5 last:border-b-0"
                            >
                                <p className="font-mono text-xs uppercase tabular-nums text-foreground/30">
                                    {entry.day}
                                </p>
                                <p className="mt-2 text-sm leading-snug">{entry.asks}</p>
                                <p className="mt-3 flex items-center gap-2.5 text-xs text-foreground/40">
                                    <span
                                        aria-hidden
                                        className="h-1.5 w-1.5 shrink-0 rounded-full border border-foreground/25"
                                    />
                                    {entry.today}
                                </p>
                                <p
                                    className={[
                                        "mt-1.5 flex items-center gap-2.5 text-xs",
                                        entry.urgent ? "text-brand-cyan" : "text-foreground",
                                    ].join(" ")}
                                >
                                    <span
                                        aria-hidden
                                        className={[
                                            "h-1.5 w-1.5 shrink-0 rounded-full",
                                            entry.urgent ? "bg-brand-cyan" : "bg-foreground",
                                        ].join(" ")}
                                    />
                                    {entry.answered}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Under the strip it refers to, not under the protocol
                        column, which has no divider in it. */}
                    <p className="mt-4 text-right font-mono text-xs uppercase tracking-widest text-foreground/35 max-[850px]:hidden">
                        Drag the divider, or focus it and use the arrow keys
                    </p>
                </motion.div>
            </div>
        </section>
    );
}
