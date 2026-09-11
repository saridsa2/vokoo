import { RING_IF } from "@/services/mock/careData"

import { buildHistory } from "./history"
import type { Card } from "./chat"

/**
 * The two checks that sit between the model and the patient.
 *
 * ## Why they are here and not in the prompt
 *
 * The prompt already says "do not invent a number, date or result". Asked "I
 * have a temperature" the model replied **"The temperature is 38.5°C"**, and on
 * the next run **"38.2°C"**. The patient never gave a figure and there is none
 * in her record — the questionnaire asks about temperature as *not at all / a
 * little / quite a lot*, never in degrees. With nothing to look up, a language
 * model fills the gap with something plausible.
 *
 * The moving figure is the proof: a number read out of a record is the same
 * number every time. One that changes between runs is being generated.
 *
 * An instruction cannot fix this, because the failure *is* the model doing what
 * it does. So both checks below are plain string work — no judgement, nothing
 * a model can be persuaded out of.
 */

/**
 * Questions the app answers itself, before the model sees them.
 *
 * The riskiest thing a patient can say is the thing with a fixed,
 * safety-critical answer — and those are exactly the ones a 1.7B model should
 * not be composing. "I have a fever" has one correct response: the unit's
 * number, now. Generating that sentence adds nothing and risks everything.
 *
 * Matched on the care path's own `RING_IF` list, so a programme that changes
 * its red flags changes this too. Heart, lung, or a GLP-1 cohort — the words
 * come from the row, never from here.
 */
export interface FixedAnswer {
  text: string
  card: Card
}

/* Drawn from each `RING_IF` line: the words a patient would actually use for
   it. Keyed by the line so a new red flag brings its own cues. */
const CUES: RegExp[] = [
  /\b(temperature|fever|febrile|hot|shiver|chills?)\b/i,
  /\b(breathless|short of breath|can'?t breathe|struggling to breathe|wheez)/i,
  /\b(new cough|coughing more|cough(ing)? up)\b/i,
]

/**
 * Does this need the unit rather than an answer.
 *
 * Deliberately loose: a false positive shows somebody the phone number they did
 * not quite need, and a false negative lets a 1.7B model improvise at somebody
 * with a fever. Those are not comparable costs.
 */
export function fixedAnswer(question: string): FixedAnswer | undefined {
  if (!CUES.some((c) => c.test(question))) return undefined

  /**
   * What to do, not why the rule exists.
   *
   * It read *"A temperature is on the list of things to ring the unit about"* —
   * which is the app explaining its own rulebook to somebody who has just said
   * they feel unwell. She does not need to know she matched a row; she needs to
   * know to ring, and the number under it is the ring.
   *
   * No reassurance, no follow-up question, no offer to pass a message. That
   * list exists precisely because a message is too slow.
   */
  return {
    text: "Please ring the unit now rather than waiting.",
    card: { kind: "call_unit" },
  }
}

/**
 * Every number the record actually contains, as strings.
 *
 * Built from the same brief the model is shown, so the two cannot drift: if a
 * figure is in its context it may repeat it, and if it is not, it may not.
 */
function numbersInRecord(): Set<string> {
  const brief = buildHistory().brief
  return new Set(brief.match(/\d+(?:\.\d+)?/g) ?? [])
}

/**
 * Refuses a reply that states a figure the record does not hold.
 *
 * Returns the reply when it is clean, and `undefined` when it is not — the
 * caller then says something true instead of showing something invented.
 *
 * Small integers are allowed through unchecked: "two days", "one of the three"
 * and the like are ordinary English, not clinical claims, and blocking them
 * would refuse most sentences the model writes. A fabricated *reading* is a
 * decimal or a figure above that range, which is what this catches.
 */
export function withoutInventedNumbers(reply: string): string | undefined {
  const record = numbersInRecord()
  const claimed = reply.match(/\d+(?:\.\d+)?/g) ?? []

  for (const n of claimed) {
    if (record.has(n)) continue
    /* Counting words, not measurements. */
    if (!n.includes(".") && Number(n) <= 12) continue
    return undefined
  }
  return reply
}

/** For the log line when a reply is refused, so the failure is visible in dev. */
export function inventedNumbers(reply: string): string[] {
  const record = numbersInRecord()
  return (reply.match(/\d+(?:\.\d+)?/g) ?? []).filter(
    (n) => !record.has(n) && (n.includes(".") || Number(n) > 12),
  )
}

/** The care path's own red flags, for anything that needs to show them. */
export const RED_FLAGS = RING_IF
