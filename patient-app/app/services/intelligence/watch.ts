import type { Brief } from "./exchange"

/**
 * The standing instruction from the clinic, and what the phone sends back.
 *
 * ## The loop, in one paragraph
 *
 * The server sends a **`Watch`**: what to look at for *this* patient, with
 * their thresholds and what their team is currently concerned about. The phone
 * holds it, and every time new data arrives — a morning blow, a night of sleep,
 * six answers — the local model reads the whole picture against that
 * instruction. Most days it finds nothing and nothing is sent. When it finds
 * something, it emits a **`Signal`**: small, structured, and about the care
 * path rather than about the conversation.
 *
 * ## Why the instruction is data and not a prompt in the binary
 *
 * A transplant unit changes what it watches. A patient at week six is watched
 * for rejection; at month nine for CLAD; after a bad biopsy, for something
 * specific to them. If the instruction lives in the app, every one of those
 * changes is a release, a review and a fortnight — and the patients who most
 * need the new rule are the ones still on the old build.
 *
 * As a row the clinic edits, it changes for one patient this afternoon. It is
 * the same argument the flow catalogue on the server side already makes about
 * not hard-coding the care path.
 *
 * ## Why it is not a stream
 *
 * Sending everything and letting the server decide would put the whole point
 * back to front: the raw data would leave the phone, the per-patient cost would
 * return, and the phone would need a network to be useful. The local model
 * exists to be the filter, so the filter has to be the thing that decides
 * whether anything is sent at all.
 *
 * Most days the answer is no. **A watch that reports every day is a watch
 * nobody reads** — which is the same failure the app's own notification rules
 * were written against.
 */

/** What the clinic is asking the phone to watch, for one patient. */
export interface Watch {
  /**
   * Which version of the instruction this is.
   *
   * Carried on every signal, so a clinician reading one knows which rule
   * produced it. Without it, a rule changed on Tuesday makes Monday's signals
   * unreadable — you cannot tell whether the phone was quiet because nothing
   * happened or because it was following a different instruction.
   */
  id: string
  /** Human-readable, for the audit trail and for a settings screen. */
  label: string
  /**
   * The clinic's own words to the model, about this patient.
   *
   * Written by the unit, not by the app. It is the system prompt, and it is
   * theirs because they are the ones accountable for what is watched.
   */
  instruction: string
  /**
   * What the model is allowed to look at.
   *
   * Named explicitly rather than "everything", so a patient can be shown the
   * list and a clinic cannot quietly widen it. Minimisation stated as a field.
   */
  sources: Array<"readings" | "wearable" | "questionnaire" | "messages">
  /**
   * The fields a signal must fill — the schema id the server already holds.
   *
   * The same registry the post-call flows use, so what the phone sends and what
   * the clinic's flows already understand are the same shape.
   */
  schemaId: string
  /**
   * How long the same finding stays quiet after being sent, in hours.
   *
   * A three-day fall is one event, not three. Without this the phone reports
   * the same thing every morning until it resolves, and the ward learns to
   * ignore the patient rather than the rule.
   */
  cooldownHours: number
}

/** Everything the model is shown, assembled from the sources the Watch allows. */
export interface Observation {
  /** Readings, most recent last, per series key. */
  readings: Record<string, Array<{ label: string; value: number }>>
  /** The latest questionnaire, by domain. */
  answers?: Record<string, number>
  /** Baselines and thresholds, so the model judges against the care path. */
  reference: Record<string, { baseline?: number; low?: number; high?: number }>
  /** When this was assembled. A model with no clock invents a date. */
  at: string
}

export type Urgency =
  /** Worth the ward knowing at the next review. */
  | "note"
  /** Worth someone looking this week. */
  | "attention"
  /** Worth someone looking today. */
  | "urgent"

/** What the phone sends when it finds something. */
export interface Signal {
  watchId: string
  /** One line, in the model's words, about what it noticed. Never advice. */
  finding: string
  urgency: Urgency
  /** The fields the Watch's schema asked for. */
  brief: Brief
  /**
   * Which readings led to it.
   *
   * Named so a clinician can check the phone's reasoning against the numbers
   * rather than taking a small model's word for it. A signal nobody can audit
   * is a signal nobody should act on.
   */
  evidence: string[]
  at: string
}

/**
 * The model's job, written once, and it is deliberately narrow.
 *
 * Appended to whatever the clinic wrote, and it constrains rather than
 * instructs: the clinic says *what to watch*, this says *what a phone is
 * allowed to conclude*.
 *
 * The bench run is the reason it exists. Given a bare prompt and a patient
 * sentence, a 1.7B model on the phone began differential-diagnosing chest
 * tightness — angina, heart attack — and got the epidemiology wrong on the way.
 * Nothing about that was a bad model; it was a model asked an open question. So
 * it is not asked one.
 */
export const GUARDRAIL = [
  "You are reading one patient's own data on their phone. You do not diagnose,",
  "you do not name conditions, and you do not tell the patient what to do.",
  "Your only job is to notice whether anything has changed against the",
  "thresholds you were given, and to fill the fields you were asked for.",
  "If you are unsure about a field, leave it out and name it as unresolved.",
  "A guess presented as a finding is worse than a gap.",
].join(" ")

/**
 * Whether this finding may be sent, given what has already gone up.
 *
 * Keyed on the watch and the finding rather than on time alone: a *new* problem
 * during another problem's cooldown still has to get through, and a cooldown
 * that suppressed it would be the mechanism turning a quiet phone into a silent
 * one.
 */
export function withinCooldown(
  watch: Watch,
  finding: string,
  lastSentAt: Record<string, string>,
  now = new Date(),
) {
  const key = `${watch.id}:${finding}`
  const last = lastSentAt[key]
  if (!last) return false
  const hours = (now.getTime() - new Date(last).getTime()) / 3_600_000
  return hours < watch.cooldownHours
}

/**
 * The one Watch that exists, until the server serves them.
 *
 * Written to the shape the endpoint will return so that swapping a fetch in
 * changes one function and nothing else. Its instruction is the transplant
 * unit's actual concern at week six, phrased the way a registrar would phrase
 * it — which is what makes it a fair test of whether a small model can follow
 * a clinic's own words.
 */
export const MOCK_WATCH: Watch = {
  id: "watch-hlt-wk6-v1",
  label: "Heart–lung, first year",
  instruction: [
    "This patient is six weeks after a heart–lung transplant.",
    "Watch their morning breathing reading against the baseline you are given:",
    "a fall of a tenth or more, on two mornings running, is the thing that matters.",
    "Watch for a rising resting heart rate together with worsening breathlessness or cough.",
    "Sleep falling away for several nights is worth noting even on its own.",
  ].join(" "),
  sources: ["readings", "wearable", "questionnaire"],
  schemaId: "clinic-lead",
  /* Two days. Long enough that one event is one signal; short enough that a
     situation which is still deteriorating is reported again. */
  cooldownHours: 48,
}
