"use client";

import { CutButton } from "@/components/sarvathra/cut-button";
import { CornerPlus } from "@/components/sarvathra/corner-plus";
import { ChevronDown } from "@/components/icons";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type QA = { question: string; answer: string };

/**
 * The questions a hospital asks before it lets somebody else answer its phone.
 *
 * Carried over from the previous site rather than rewritten, because they were
 * already the right questions and every answer is one this product can stand
 * behind. Only the container changed.
 */
const FAQS: QA[] = [
  {
    question: "What is a care pathway here?",
    answer:
      "The contacts your protocol already implies, drawn as a graph: the pre-cycle labs reminder, the confirmation, the symptom check on day three, the scan reminder, the follow-up at six months. Each is a step with its own timing, its own questions and its own rule for when a person takes over. The drawing is what runs.",
  },
  {
    question: "Does it give clinical advice?",
    answer:
      "No, and it is built so that it cannot drift into doing so. It asks the questions your protocol specifies and records the answers. Anything that is a symptom, a dose question or a sign of deterioration is handed to a nurse with what the patient said — it does not triage, reassure or advise.",
  },
  {
    question: "What happens if a patient reports something serious?",
    answer:
      "The call is escalated to a number your department nominates, during the same call rather than as a task somebody picks up later, and what the patient said travels with it. If nobody answers there, that is a failure the platform reports rather than absorbs.",
  },
  {
    question: "Where does patient data go?",
    answer:
      "It stays in your workspace. Recording is off unless you turn it on, and how long a call's content is kept is a number you set — when it lapses the content is deleted. What leaves is what you chose to send: the fields you defined, delivered to your own systems.",
  },
  {
    question: "Does it write into our HIS?",
    answer:
      "It delivers outward. After a call it reads the conversation into the fields you defined and posts them to your HIS or CRM over a webhook, carrying the call id so that a retry can never create a second record. Nothing is installed beside your systems and no database is opened to us.",
  },
  {
    question: "Can it run different pathways per department?",
    answer:
      "That is the usual shape. Oncology and transplant do not ask a patient the same questions, escalate to the same people, or run on the same clock — so each draws its own, and a department can change its own without a release or a ticket to anybody.",
  },
  {
    question: "What about patients who do not answer?",
    answer:
      "Retries are part of the pathway rather than a setting buried somewhere: how many, how far apart, and what happens when the attempts are exhausted — usually a coordinator's list, which is now short and holds only the people who genuinely need a call from a person.",
  },
  {
    question: "Which languages?",
    answer:
      "Hindi and English today, settled before the conversation starts rather than guessed from an accent, so the ear, the voice and the wording stay in one language for the whole call. More languages are a configuration change rather than a rebuild.",
  },
  {
    question: "Does it work on WhatsApp?",
    answer:
      "Yes. WhatsApp Business calls arrive on the same platform and reach the same pathway. There is no keypad there, so it settles the language by asking once.",
  },
  {
    question: "Can we see it run before it touches a patient?",
    answer:
      "Yes, and this is the part worth asking about. A pathway can be replayed against a real finished call and shows every step's input, output and timing — including exactly what would have been written to your systems, without writing it. You watch it execute before it speaks to anybody.",
  },
  {
    question: "How do we start?",
    answer:
      "Call +91 80408 02529 and talk to the thing itself, then write to hello@sarvathra.ai. The first conversation is about one department, one protocol, and where its patient records live — not a signup form.",
  },
];

const EASE = [0.22, 1, 0.36, 1] as const;

function FaqItem({
  item,
  isOpen,
  onToggle,
  index,
}: {
  item: QA;
  isOpen: boolean;
  onToggle: () => void;
  index: number;
}): ReactNode {
  const panelId = `faq-panel-${index}`;
  const buttonId = `faq-button-${index}`;

  return (
    <div className="border-dotted border-border [&:not(:first-child)]:border-t">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="focus-ring flex w-full items-center justify-between gap-6 py-5 pr-1 text-left lg:py-6 lg:pl-12"
        >
          <span className="text-base font-medium tracking-tight sm:text-lg">
            {item.question}
          </span>
          <motion.span
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="shrink-0 text-muted-foreground"
          >
            <ChevronDown className="h-5 w-5" aria-hidden="true" />
          </motion.span>
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="overflow-hidden"
          >
            <p className="max-w-xl pb-6 pr-6 text-sm leading-relaxed text-muted-foreground lg:pl-12">
              {item.answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Faq(): ReactNode {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const accordionRef = useRef<HTMLDivElement | null>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const node = accordionRef.current;
    if (node === null) return;

    let peak = 0;
    let width = node.offsetWidth;

    const observer = new ResizeObserver(() => {
      if (node.offsetWidth !== width) {
        width = node.offsetWidth;
        peak = 0;
        setMinHeight(undefined);
        return;
      }
      const next = node.offsetHeight;
      if (next > peak) {
        peak = next;
        setMinHeight(next);
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="faq"
      className="mx-auto max-w-[1440px] scroll-mt-24 px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10"
    >
      <div className="relative grid border-y border-border lg:grid-cols-[0.85fr_1.15fr]">
        {/* Outer frame corners */}
        <CornerPlus className="left-0 top-0 -translate-x-1/2 -translate-y-1/2" />
        <CornerPlus className="right-0 top-0 translate-x-1/2 -translate-y-1/2" />
        <CornerPlus className="bottom-0 left-0 -translate-x-1/2 translate-y-1/2" />
        <CornerPlus className="bottom-0 right-0 translate-x-1/2 translate-y-1/2" />

        {/* Left: heading */}
        <div className="border-b border-border py-10 lg:border-b-0 lg:border-r lg:py-16 lg:pr-12">
          <h2 className="text-balance font-serif text-4xl font-normal leading-[1.05] tracking-[-0.01em] sm:text-5xl lg:text-[3.5rem]">
            What a hospital asks first
          </h2>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base">
            Before a department lets somebody else speak to its patients. If
            yours is not here, the phone is the fastest way to ask it.
          </p>
          <div className="mt-8">
            <CutButton href="tel:+918040802529" variant="outline">
              Call +91 80408 02529
            </CutButton>
          </div>
        </div>

        {/* Right: accordion */}
        <div
          ref={accordionRef}
          className="relative"
          style={minHeight !== undefined ? { minHeight } : undefined}
        >
          {/* Plus marks where the divider meets the frame */}
          <CornerPlus className="left-0 top-0 hidden -translate-x-1/2 -translate-y-1/2 lg:block" />
          <CornerPlus className="bottom-0 left-0 hidden -translate-x-1/2 translate-y-1/2 lg:block" />
          {FAQS.map((item, i) => (
            <FaqItem
              key={item.question}
              item={item}
              index={i}
              isOpen={openIndex === i}
              onToggle={() => setOpenIndex((cur) => (cur === i ? null : i))}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
