import { AsciiIcon } from "@/components/sarvathra/ascii-icon";
import type { CSSProperties, ReactNode } from "react";

// Reusing `AsciiIcon`'s own union rather than re-declaring a narrower copy:
// the template listed three of the six shapes, and adding a fourth meant
// editing a type that already existed one file away.
import type { Shape } from "@/components/sarvathra/ascii-icon";

type Feature = {
  id: string;
  shape: Shape;
  title: string;
  body: string;
  meta: string;
};

/**
 * The four things the platform does, and the four anchors the nav menu points
 * at. They are one list conceptually and two in the code — if a card is added
 * here it needs an entry in `nav.tsx` too, or the menu links somewhere that
 * does not exist.
 *
 * `id` rather than `href`: the template used these cards as links out to
 * sections further down the page. There are no such sections, so each card is
 * the destination, and the arrow is gone with the link it followed.
 */
const FEATURES: Feature[] = [
  {
    id: "pathways",
    shape: "scan",
    title: "Your protocol, drawn once",
    body: "Every contact your protocol asks for becomes a step, with its own day, its own questions and its own rule for when a person takes over. A department changes its own without a release or a ticket.",
    meta: "Care pathways",
  },
  {
    id: "the-call",
    shape: "bars",
    title: "It calls, and it listens",
    body: "Hindi or English, on the phone or over WhatsApp. The language is settled before the call starts, so the ear, the voice and the wording stay in one language the whole way through.",
    meta: "The call",
  },
  {
    id: "escalation",
    shape: "plus",
    title: "It hands over rather than advises",
    body: "A symptom, a dose question or a patient who sounds unwell goes to the number your department names, during the same call, carrying what the patient said. It does not triage or reassure.",
    meta: "Escalation",
  },
  {
    id: "records",
    shape: "shield",
    title: "It reaches your systems, not the reverse",
    body: "What the patient said arrives as the fields you defined, keyed on the call so a retry cannot write a second record. Nothing is installed beside your HIS and no database is opened to us.",
    meta: "Your records",
  },
];

const CARD_CLIP =
  "polygon(0 0, calc(100% - 34px) 0, 100% 34px, 100% 100%, 0 100%)";

export function Features(): ReactNode {
  const clip = { clipPath: CARD_CLIP } as CSSProperties;

  return (
    <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
      <div className="max-w-2xl">
        <h2 className="text-balance font-serif text-3xl font-normal leading-[1.12] tracking-[-0.01em] sm:text-4xl lg:text-[2.75rem]">
          The protocol you already follow,{" "}
          <span className="font-sans font-semibold tracking-tight">
            carrying itself out
          </span>
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Give us the pathway your department already works to. It runs for every
          patient on it, on the day it should, and what they say comes back to
          you the same day.
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:gap-6">
        {FEATURES.map((feature) => (
          <div
            key={feature.id}
            id={feature.id}
            className="bg-border scroll-mt-24 p-px"
            style={clip}
          >
            <article
              className="flex h-full flex-col bg-background p-6 sm:p-7"
              style={clip}
            >
              <h3 className="text-lg font-semibold tracking-tight">
                {feature.title}
              </h3>

              <div className="my-5 border-t border-dotted border-border" />
              <div className="flex justify-center py-6 sm:py-8">
                <AsciiIcon shape={feature.shape} />
              </div>
              <div className="mb-6 border-t border-dotted border-border" />

              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.body}
              </p>

              {/* The arrow was a link to a section further down the page.
                  There is no such section — the card is the destination — so
                  the control is gone rather than pointing at nothing. */}
              <div className="mt-auto pt-8">
                <span className="text-xs font-medium text-muted-foreground">
                  {feature.meta}
                </span>
              </div>
            </article>
          </div>
        ))}
      </div>
    </section>
  );
}
