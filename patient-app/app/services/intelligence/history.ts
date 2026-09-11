import {
  COHORT,
  OPEN_REQUESTS,
  PASSIVE,
  PATIENT,
  PROVIDER,
  RING_IF,
  SPIROMETRY,
  SYMPTOMS,
  TACROLIMUS,
  UNIT_PHONE,
  type HomeSeries,
  type SymptomDomain,
} from "@/services/mock/careData"

/**
 * The patient's history, as the server put it on the device.
 *
 * ## Nothing here knows what a lung is
 *
 * The first version of this file named FEV1, wrote out the ten-percent rule as
 * a sentence, and called tacrolimus by name. All three are **this** programme's
 * facts, and the app is not one programme: heart–lung today, heart alone
 * tomorrow, and a GLP-1 or renal cohort after that. A file that says "morning
 * breathing" is a file somebody has to edit before the next cohort can be
 * enrolled — and editing prompt text per cohort is how one patient ends up
 * being told about somebody else's measurement.
 *
 * So every line is derived from the series' own fields. A measurement carries
 * its own patient name, clinical name, unit, decimals, and whichever reference
 * it has — a `band` for a drug level, a `baseline` plus an `action` for a
 * function test, neither for something nobody prescribed a target for. The
 * sentence is generated from whichever of those exist.
 *
 * Adding a cohort should be adding rows, never touching this file.
 *
 * ## Why it is a summary and not the record
 *
 * The model on the phone works in a couple of thousand tokens. A year of
 * readings, a medication list and a message thread do not fit, and the failure
 * is not polite: the prompt is truncated somewhere arbitrary and the model
 * answers confidently from whatever survived.
 *
 * Deciding what a patient's model needs to know is a clinical judgement and it
 * belongs on the clinic's side, where it can be changed for one patient in an
 * afternoon. The phone renders what it is given.
 *
 * ## What is deliberately absent
 *
 * Clinic letters, histology, anything a model could quote back as fact without
 * understanding it. A phone that can recite a biopsy result to a frightened
 * patient at midnight is not a feature.
 */
export interface PatientHistory {
  /** Rendered into the system prompt verbatim. */
  brief: string
  /** When it was composed, so a stale brief can be spotted. */
  at: string
}

export interface HistoryInput {
  /** Whatever this programme measures. Named by the cohort, not by this file. */
  tracked?: HomeSeries[]
  /** Whatever arrives without being asked for. */
  passive?: HomeSeries[]
  /** The questionnaire's domains, if this programme has one. */
  symptoms?: SymptomDomain[]
}

/**
 * The five answers, in the patient's own words.
 *
 * Mirrors `SEVERITY` in the questionnaire, because the model has to describe
 * their week using the words they were actually offered — anything else is the
 * app paraphrasing a patient's own answer back at them slightly differently.
 */
const WORDS = ["none", "a little", "somewhat", "quite a lot", "severe"]

/** One measurement, described from its own fields. */
function describe(s: HomeSeries): string {
  const dp = s.decimals ?? 0
  const show = (v: number) =>
    v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })

  const latest = s.readings[s.readings.length - 1]
  const name = s.clinicalName ? `${s.title} (${s.clinicalName})` : s.title

  const parts = [`${show(latest.value)} ${s.unit} on ${latest.label}.`]

  if (s.band) {
    parts.push(`The unit wants ${show(s.band.low)}–${show(s.band.high)} ${s.unit}.`)
  }

  if (s.baseline !== undefined) {
    parts.push(`Their own baseline is ${show(s.baseline)} ${s.unit}.`)
  }

  /**
   * The threshold, in the direction the care path set.
   *
   * `direction` is not decoration: a lung is watched for a *fall* and a heart
   * patient's weight for a *rise*. Writing "below" here would have been correct
   * for one cohort and wrong for the next.
   */
  if (s.baseline !== undefined && s.action) {
    const limit =
      s.action.direction === "rise"
        ? s.baseline * (1 + s.action.fraction)
        : s.baseline * (1 - s.action.fraction)
    const way = s.action.direction === "rise" ? "above" : "below"
    parts.push(`${way.charAt(0).toUpperCase() + way.slice(1)} ${show(limit)} ${s.unit} matters.`)
  }

  if (!s.band && s.baseline === undefined) {
    parts.push("No target was set for this — it is background, not a task.")
  }

  return `${name}: ${parts.join(" ")}`
}

export function buildHistory(input: HistoryInput = {}): PatientHistory {
  const tracked = input.tracked ?? [SPIROMETRY, TACROLIMUS]
  const passive = input.passive ?? PASSIVE
  const symptoms = input.symptoms ?? SYMPTOMS

  const sections: string[] = [
    "PATIENT",
    `Name: ${PATIENT.firstName}`,
    `Programme: ${COHORT.name}, under ${PROVIDER.full}`,
    `What it involves: ${COHORT.programme}`,
    `Started: ${COHORT.startedOn}. It runs ${COHORT.weeks} weeks.`,
  ]

  if (tracked.length) {
    sections.push("", "WHAT THEY SEND IN", ...tracked.map(describe))
  }

  if (passive.length) {
    sections.push("", "WHAT THEIR WATCH REPORTS", ...passive.map(describe))
  }

  if (symptoms.length) {
    /**
     * Prose, not a table — and this was a real bug, not a preference.
     *
     * It was one line per domain: `Breathless: 2, was 1 last week`. Asked "how
     * am I doing", the model reproduced all six lines verbatim, scores and all.
     * That is not the model misbehaving: given a table it copies the table,
     * and no amount of "two or three sentences" in the instructions beats a
     * worked example of the wrong format sitting in its context.
     *
     * Raw 0–4 severity scores should never reach a patient anyway. They are the
     * instrument's units, for the clinician reading the profile — the patient
     * said "quite a lot", and handing them back a 3 is the app showing its
     * working.
     *
     * So the scores become the words the patient actually chose, and what
     * changed is stated as a sentence the model can paraphrase.
     */
    const said = (n: number) => WORDS[Math.max(0, Math.min(WORDS.length - 1, n))]
    const moved = symptoms.filter((d) => d.thisWeek !== d.lastWeek)

    sections.push(
      "",
      "HOW THEY SAID THEY WERE THIS WEEK",
      symptoms.map((d) => `${d.domain.toLowerCase()} ${said(d.thisWeek)}`).join(", ") + ".",
      moved.length
        ? `Since last week: ${moved
            .map(
              (d) =>
                `${d.domain.toLowerCase()} ${d.thisWeek > d.lastWeek ? "worse" : "better"} (was ${said(d.lastWeek)})`,
            )
            .join(", ")}.`
        : "Nothing has changed since last week.",
    )
  }

  if (OPEN_REQUESTS.length) {
    sections.push(
      "",
      "OUTSTANDING",
      ...OPEN_REQUESTS.map((r) => `${r.what} — ${r.daysLeft} day(s) left`),
    )
  }

  /* The escalation rules are the care path's own words, from the same list the
     care team screen prints. Rewriting them here would let the two drift, and
     the one a patient reads at midnight has to be the one the unit wrote. */
  sections.push(
    "",
    "WHEN THEY MUST RING THE UNIT",
    ...RING_IF.map((r) => `- ${r}`),
    `The number is ${UNIT_PHONE}, answered 24 hours.`,
  )

  return { brief: sections.join("\n"), at: new Date().toISOString() }
}
