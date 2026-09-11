/**
 * Everything on screen, in one file.
 *
 * **The values are synthetic. The rules they obey are not.**
 * `docs/hlt-follow-up-data.md` is the research behind this file — what a heart–
 * lung transplant follow-up actually collects, with citations — and every
 * threshold below points back at it. The numbers are invented to be plausible;
 * the baseline definition, the 10%-over-2-days rule, the 20% CLAD line and the
 * 9–12 ng/mL trough band are published, and a screen that got those wrong would
 * be wrong in a way that matters.
 *
 * Nothing here should reach a patient. The hospital has its own schedule, its
 * own targets and its own question set, and none of them are in the backend yet.
 *
 * The provider name below is a placeholder and is the ONLY place it appears.
 * Changing it changes every screen; that is the point of it being here.
 *
 * The mock lives in one file so the screens agree with each other: the request
 * the home screen lists is the one the detail screen opens, and the report sent
 * for it appears under Reports with the same date. A demo where those three
 * disagree teaches the wrong thing about the product.
 */

/** `cohorts` — the group a patient is enrolled in, and the programme it runs. */
export type Cohort = {
  id: string
  name: string
  provider: string
  programme: string
  startedOn: string
  weeks: number | null
}

/**
 * Who a request is addressed to.
 *
 * Mirrors `RequestActor` in `bridge/src/vokoo/compiler/types.rs`. The compiler
 * gained this on 9 September so that a clinician's action could never be lowered
 * into patient outreach — those stop as blocking `clinical.task` gaps instead of
 * quietly becoming something a patient is asked to do.
 *
 * It is repeated here deliberately. The compiler refusing to *emit* the wrong
 * thing and this app refusing to *render* it are two independent guards, and a
 * patient being shown a clinician's task is the failure both exist to prevent.
 * One of them being right is not a reason for the other to trust the feed.
 */
export type RequestActor = "patient" | "clinician" | "care_team" | "system"

/** `care_path_outreach` — a thing asked of the patient, and its four outcomes. */
export type OutreachRequest = {
  id: string
  /** Only `patient` may reach a screen. See `forPatient`. */
  actor: RequestActor
  /** `outreach.request.what`. */
  what: string
  /** `outreach.request.instructions`. */
  instructions: string
  /** How the patient answers. */
  kind: "document" | "questions" | "measurement"
  /** Days until `expires_at`. Zero is today. */
  daysLeft: number
  from: string
  /** The recommendation behind it, in one line a patient can act on. */
  because: string
}

/** `documents` — what the patient sent, and what the clinic did with it. */
export type Report = {
  id: string
  title: string
  sentOn: string
  state: "pending" | "reviewed" | "rejected"
  note?: string
  pages: number
}

/** A step in the care path, as the patient sees it. */
export type Milestone = {
  id: string
  title: string
  when: string
  state: "done" | "current" | "ahead"
  detail?: string
}

/** `agents` / `agent_extensions` — a person, not a queue. */
export type CareTeamMember = {
  id: string
  name: string
  role: string
  /** A registration, not employment. See the console's note on the difference. */
  available: boolean
}

/**
 * One message in the single thread.
 *
 * **Three senders, one conversation.** The agent answers first, a coordinator
 * takes over when it escalates, and the patient never chooses who to write to —
 * choosing means choosing wrongly and waiting on somebody who is off that week.
 * It is the same shape the voice path already has, where the agent stays on the
 * call muted after handing over.
 *
 * `agent` and `human` are separate rather than one "clinic", because a patient
 * must always be able to tell which one they are talking to. Conflating them is
 * the one thing this product must not do.
 */
export type Message = {
  id: string
  from: "you" | "agent" | "human"
  author: string
  at: string
  body: string
  /** Marks where the conversation changed hands. Rendered as a rule, not a message. */
  handover?: boolean
  /**
   * A document sent with the message.
   *
   * It lives on the message rather than in a separate list because that is what
   * it is to the patient: a thing they said, with the report attached. A
   * conversation that files the photo somewhere else leaves them scrolling a
   * thread wondering whether it went.
   */
  attachment?: { name: string; pages?: number }
  /**
   * Answers offered as taps rather than typing.
   *
   * They belong to the message that asked, not to the screen, because what is
   * worth offering depends entirely on the question. A fixed row of chips would
   * be a keyboard with three keys.
   *
   * For somebody breathless, arthritic, or holding a phone in one hand on a
   * ward, this is the difference between answering and not.
   */
  replies?: string[]
}

/** One home reading. `value` is whatever `HomeSeries.unit` says it is. */
export type Reading = { label: string; value: number }

/**
 * A series of home readings, with the lines that make it readable.
 *
 * `baseline` is the stored figure the unit set — for FEV1, the average of two
 * maximal post-transplant tests at least three weeks apart. It is deliberately
 * a field and not a computed mean of `readings`: a baseline recomputed from
 * recent values would rise and fall with the very decline it exists to detect,
 * and the drop would disappear into its own reference.
 */
export type HomeSeries = {
  key: string
  /**
   * What the patient calls it. Leads.
   */
  title: string
  /**
   * What their lab report and medicine box call it. Follows, small.
   *
   * **Both names, never one.** Printing only the clinical term assumes a
   * vocabulary the patient may not have; printing only the plain one leaves
   * them holding a report headed "Tacrolimus" with no way to tell it is the
   * thing the app asked for. Showing both is what teaches the mapping.
   *
   * Like every threshold here, this belongs to the care path and not to the
   * app — `catalogue_observation_kinds` should carry a clinical name and a
   * patient name per measurement, so no screen ever chooses vocabulary.
   */
  clinicalName?: string
  unit: string
  /**
   * How many decimals this measurement is written with.
   *
   * A property of the thing measured, not of the chart: FEV1 is 2.35 L, a
   * heart rate is 95 bpm and steps are 4,000. Formatting them all alike gives
   * "4000.00 steps", which reads as a machine that does not know what it is
   * showing.
   */
  decimals?: number
  readings: Reading[]
  /**
   * The figure the unit recorded as this patient's usual.
   *
   * **Optional, because only some measurements have one.** FEV1's baseline is
   * a clinical act — two maximal tests at least three weeks apart, signed off.
   * Sleep has no such thing. Computing an average and drawing it as a baseline
   * would dress a convenience up as a clinical fact, and every bar would then
   * be measured against a line nobody set.
   *
   * No baseline means no reference rule on the chart: the trend, and nothing
   * implied about it.
   */
  baseline?: number
  /**
   * Where a reading stops being ordinary variation and becomes a reason to ring.
   *
   * **The direction is not decoration.** Lung watches FEV1 for a *fall* — 10%
   * below baseline held two days means rejection or infection. Heart watches
   * weight for a *rise* — fluid. A chart that can only draw a line below the
   * baseline cannot serve a heart patient at all, which is what designing both
   * specialities revealed and what a single-speciality build would have hidden.
   *
   * **A third shape exists and this cannot express it.** Heart's real weight
   * rule is an absolute delta over a window — 2kg in 2 days — measured against
   * two days ago rather than against a stored baseline. That is neither a
   * fraction of a baseline nor a band. It is named here and deliberately not
   * faked: a rule drawn in the wrong shape is a threshold a patient trusts and
   * that does not mean what they think it means.
   */
  action?: { fraction: number; direction: "fall" | "rise" }
  /** A target range, where the measurement has one rather than a baseline. */
  band?: { low: number; high: number; label: string }
  /** What the chart is for, in the patient's words. */
  meaning: string
  /**
   * Where the number came from.
   *
   * Mirrors the `source` field the compiler already carries on
   * `RecordObservation`. It is the difference between a number the patient
   * produced and one that arrived while they slept, and it changes three
   * things on screen:
   *
   * - **`asked` never appears for a passive source.** Asking a patient for a
   *   figure their watch already sent is the fastest way to teach them the app
   *   is not paying attention.
   * - **A passive series carries no action line.** See `action` below.
   * - The chart says where it came from, so an unfamiliar number is not a
   *   mystery.
   */
  source: "patient" | "device" | "lab" | "wearable"
  /**
   * How this measurement should be drawn.
   *
   * A property of the thing measured, not a style choice — which is why it
   * lives here beside the unit and the decimals rather than being passed to the
   * chart per screen.
   *
   * - `line` — a continuous quantity whose **direction** is the question. A
   *   blow and a resting heart rate both are: nobody cares what Tuesday was,
   *   they care whether it is drifting.
   * - `dots` — irregular samples that must land inside a range. A lab level is
   *   this: joining two blood tests three weeks apart with a line would draw a
   *   value for every day between them that nobody measured.
   * - `bar` — a count that accumulates over a period, where the height *is* the
   *   quantity. Steps in a day, hours slept in a night.
   * - `gauge` — a value whose only question is whether it sits inside a range.
   *   A blood level is this, and it is why `dots` is currently unused: five
   *   samples on a time axis answered "what was the trend", which is the
   *   clinician's question, not the patient's.
   *
   * Everything was a bar before, which said all five were the same kind of
   * fact.
   */
  chart: "bar" | "line" | "dots" | "gauge"
  /**
   * Draw this against the patient's own baseline, in percent.
   *
   * ISHLT grades CLAD entirely in percent of personal baseline — 0 is >90%,
   * grade 1 is 66–80%, grade 3 is ≤50% — and asthma action plans have used
   * percent-of-personal-best zones for thirty years. Litres are the unit the
   * device reports; percent is the unit the medicine is written in.
   *
   * It matters more here than it would elsewhere: among patients referred for
   * transplant, limited numeracy runs at 42.8%. `2.33 L` against a baseline of
   * `2.35 L` requires a division that half of them will not do, and the app
   * doing it is the whole point.
   */
  relative?: boolean
  /**
   * The fall at which this stops being a warning and becomes the diagnosis.
   *
   * Zikmund-Fisher 2018 (N=1618) measured what this is worth: adding a second
   * reference marked "many doctors are not concerned until here" cut
   * inappropriate urgent contact from 55.8% to 34.7%. A patient at 93% who can
   * see where the serious line actually sits reacts proportionately; one who
   * can only see they are below normal does not.
   *
   * For FEV1 it is published and needs no inventing — a 20% sustained fall is
   * CLAD.
   */
  harmFraction?: number
  /**
   * What a full ring means, where a ring is the right shape.
   *
   * **A placeholder, and it must not stay one.** A daily step count and a
   * night's sleep are the two passive numbers with a target a person can close,
   * which is what a ring draws — but the target belongs to the care path, not
   * to this file. Eight hours and five thousand steps are what a healthy adult
   * is told; a patient six weeks out of a heart–lung transplant is not that,
   * and the unit should be setting both.
   *
   * Absent means no ring: a resting heart rate has no goal to close, and
   * inventing one would draw a patient towards a number nobody prescribed.
   */
  goal?: number
  /**
   * Which side of the goal is the good side.
   *
   * Steps and sleep close by reaching the number; a resting heart rate closes
   * by staying **under** it. Without this the heart-rate ring would fill as the
   * patient got worse, which is the exact inversion of what a ring means.
   */
  goalIs?: "at least" | "at most"
}

/**
 * The hospital, as one value.
 *
 * **A tenant is data, never a string in a screen.** Sarvathra is the product;
 * the hospital is a customer of it, and the name that appeared 24 times across
 * nine files was a placeholder that hardened into copy. Every one of those was
 * a line that would have to be found and edited to run this app for a second
 * hospital — which is not a port, it is a fork.
 *
 * `unit` is deliberately separate from `name`: a patient says "the transplant
 * unit", not the name of the hospital group, and the two are different words in
 * every sentence the app writes.
 */
export const PROVIDER = {
  /** The organisation, as it appears on paperwork. */
  name: "KIMS Hospitals",
  /** Where. Said after the name, or alone when the name is already established. */
  city: "Secunderabad",
  /** The department a patient deals with, in their words. */
  unit: "Transplant Unit",
  /** What the app writes when it needs the whole thing. */
  get full() {
    return `${this.name}, ${this.city}`
  },
  /** Who a request came from. */
  get from() {
    return `${this.name.split(" ")[0]} ${this.unit}`
  },
} as const

export const PATIENT = {
  firstName: "Sunita",
  fullName: "Sunita Reddy",
  /** The hospital's own number for her — what she is asked for at a desk. */
  uhid: "HLT-4471902",
}

export const COHORT: Cohort = {
  id: "c-1",
  name: "Heart–lung transplant — first year",
  provider: PROVIDER.full,
  programme:
    "Blow into your spirometer every morning and send the number. A short set of questions each week. Bloods for your tacrolimus level at the dates below, and a biopsy at each clinic visit for the first year.",
  startedOn: "24 July 2026",
  weeks: 52,
}

/**
 * The morning spirometry, fourteen days.
 *
 * Baseline 2.35 L. The dip on the 3rd and 4th is about 6% — under the 10% that
 * would mean ringing the unit, and there so the chart shows what ordinary
 * variation looks like. A chart whose every bar is the same height teaches a
 * patient nothing about which change matters.
 */
export const SPIROMETRY: HomeSeries = {
  key: "fev1",
  title: "Morning reading",
  clinicalName: "FEV1",
  unit: "L",
  decimals: 2,
  baseline: 2.35,
  action: { fraction: 0.1, direction: "fall" },
  source: "device",
  chart: "line",
  meaning:
    "The first thing to change if your lungs are unhappy — usually before you feel anything.",
  readings: [
    { label: "27 Aug", value: 2.34 },
    { label: "28", value: 2.31 },
    { label: "29", value: 2.36 },
    { label: "30", value: 2.28 },
    { label: "31", value: 2.33 },
    { label: "1", value: 2.3 },
    /**
     * A three-day run under the action line, then recovery.
     *
     * The baseline is 2.35 and a 10% fall puts the line at 2.115, so these
     * three mornings are 88%, 87% and 89% — under it, consecutively. Everything
     * before was 93%–101%, which never crossed, so the one thing the strip
     * exists to show could not happen and the chart could not be judged.
     *
     * Clinically ordinary: a chest infection that a fortnight's monitoring
     * catches and that resolves. The patient is fine today, which is the point
     * — the run is history the ward asks about at clinic, not a live alarm.
     */
    { label: "2", value: 2.07 },
    { label: "3", value: 2.04 },
    { label: "4", value: 2.09 },
    { label: "5", value: 2.29 },
    { label: "6", value: 2.34 },
    { label: "7", value: 2.32 },
    { label: "8", value: 2.37 },
    { label: "9 Sep", value: 2.33 },
  ],
}

/**
 * Tacrolimus troughs, six results.
 *
 * The band is the target for the first three months after transplant. It is
 * the *spread* that predicts rejection rather than any one reading, which is
 * why this is a series with a band drawn on it and never a single figure.
 */
export const TACROLIMUS: HomeSeries = {
  key: "tacrolimus",
  title: "Medicine level",
  clinicalName: "Tacrolimus",
  unit: "ng/mL",
  decimals: 1,
  baseline: 10.5,
  band: { low: 9, high: 12, label: "Target" },
  source: "lab",
  chart: "dots",
  meaning:
    "Your anti-rejection medicine. Too little and your body can reject; too much is hard on your kidneys.",
  readings: [
    { label: "30 Jul", value: 13.1 },
    { label: "6 Aug", value: 11.8 },
    { label: "13 Aug", value: 10.4 },
    { label: "21 Aug", value: 9.6 },
    { label: "28 Aug", value: 10.2 },
    { label: "4 Sep", value: 10.8 },
  ],
}

/**
 * The only list a screen may read.
 *
 * A filter and not a thrown error, because the right behaviour when a
 * clinician task arrives is for the patient to see nothing — not for their app
 * to crash on the morning they were meant to do their bloods.
 */
export function forPatient(requests: OutreachRequest[]): OutreachRequest[] {
  return requests.filter((r) => r.actor === "patient")
}

const ALL_REQUESTS: OutreachRequest[] = [
  {
    id: "r-1",
    what: "Your morning breathing test",
    instructions:
      "Sit up straight. Take the deepest breath you can, then blow out as fast as you can and keep going as long as you can. Best of three — send the highest.",
    kind: "measurement",
    daysLeft: 0,
    actor: "patient",
    from: PROVIDER.from,
    because:
      "A fall of 10% from your normal, holding for 2 days, is how rejection and infection show themselves first — before you feel unwell.",
  },
  {
    id: "r-2",
    /**
     * TODO: this should be triggered, not weekly.
     *
     * A fixed weekly ping is noise, and noise is what patients learn to
     * dismiss. It should fire off a signal in their own data — sleep falling
     * away, resting heart rate drifting up — or off a backend flow trigger.
     * `docs/hlt-follow-up-data.md` has the reasoning and what it needs.
     */
    what: "How have you been this week?",
    instructions:
      "Six questions about breathlessness, cough, temperature, swelling and weight. It takes a minute.",
    kind: "questions",
    daysLeft: 1,
    actor: "patient",
    from: PROVIDER.from,
    because:
      "Your numbers say what your lungs are doing. These say what the rest of you is doing, and the two are read together.",
  },
  {
    id: "r-3",
    what: "Blood test — before your morning dose",
    instructions:
      "The blood must be taken BEFORE you take your morning tablet, not after. Any lab can do it. Send us a photo of the report.",
    kind: "document",
    daysLeft: 5,
    actor: "patient",
    from: PROVIDER.from,
    because:
      "Your dose is set from this number. Taken after a tablet it measures something else, and the unit cannot use it.",
  },
]

export const OPEN_REQUESTS = forPatient(ALL_REQUESTS)

export const REPORTS: Report[] = [
  {
    id: "d-1",
    title: "Tacrolimus level — Vijaya Diagnostics",
    sentOn: "28 August 2026",
    state: "reviewed",
    note: "10.2 — inside where we want you. No change to your dose. — Dr Rao",
    pages: 1,
  },
  {
    id: "d-2",
    title: `Biopsy report — ${PROVIDER.name.split(" ")[0]}`,
    sentOn: "21 August 2026",
    state: "reviewed",
    note: "No rejection on this one. Next biopsy at your September visit. — Dr Rao",
    pages: 3,
  },
  {
    id: "d-3",
    title: `Discharge summary — ${PROVIDER.name.split(" ")[0]}`,
    sentOn: "26 July 2026",
    state: "reviewed",
    pages: 8,
  },
  {
    id: "d-4",
    title: "Chest X-ray — Vijaya Diagnostics",
    sentOn: "4 September 2026",
    state: "pending",
    pages: 1,
  },
]

export const MILESTONES: Milestone[] = [
  { id: "m-1", title: "Transplant", when: "24 July", state: "done" },
  { id: "m-2", title: "Home from hospital", when: "26 July", state: "done" },
  {
    id: "m-3",
    /**
     * The clinic recording this patient's baseline FEV1.
     *
     * It read "Your usual was set", which is the app's own word for a baseline
     * doing a job it cannot do on a milestone: on the chart "Usual" sits beside
     * the number it labels, so it is obvious; on a card by itself it names
     * nothing. What actually happened is that a number was agreed, and every
     * morning reading is now compared against it — so the card says that.
     */
    title: "Your normal reading set",
    when: "21 August",
    state: "done",
    detail: "2.35 L, from 2 tests 3 weeks apart. Your morning reading is compared to it.",
  },
  {
    id: "m-4",
    title: "6-week bloods and biopsy",
    when: "Due by 14 September",
    state: "current",
    detail: "The blood test is open now.",
  },
  { id: "m-5", title: "3-month review", when: "24 October", state: "ahead" },
  { id: "m-6", title: "6-month review", when: "24 January", state: "ahead" },
]

export const CARE_TEAM: CareTeamMember[] = [
  { id: "t-1", name: "Dr Anand Rao", role: "Transplant physician", available: true },
  { id: "t-2", name: "Sister Lakshmi", role: "Transplant coordinator", available: true },
  { id: "t-3", name: "Dr Meera Shah", role: "Registrar", available: false },
]

/**
 * When to ring rather than message.
 *
 * The last one is the reason this app exists: a number the patient can see
 * falling, with an instruction attached to it, rather than a number somebody
 * reads twice a week.
 */
export const RING_IF = [
  "a temperature over 38°C",
  "more breathless than usual, or a new cough",
  "your morning reading is 10% below your normal 2 days running",
]

export const THREAD: Message[] = [
  {
    id: "msg-0",
    from: "you",
    author: "You",
    at: "28 August, 09:12",
    body: "Here is the report from this morning.",
    attachment: { name: "Tacrolimus level — Vijaya Diagnostics", pages: 1 },
  },
  {
    id: "msg-1",
    from: "you",
    author: "You",
    at: "28 August, 10:04",
    body: "Has anyone looked at it?",
  },
  {
    id: "msg-2",
    from: "agent",
    author: "Sarv",
    at: "28 August, 10:04",
    body: "Yes — it arrived at 9.12 and it is with Dr Rao today. Your level was 10.2, which is inside the range the unit wants you in.",
    replies: ["Thank you", "I have a question"],
  },
  {
    id: "msg-3",
    from: "you",
    author: "You",
    at: "28 August, 10:31",
    body: "Should I keep taking the same dose until then? I have been more breathless the last two days.",
  },
  {
    id: "msg-4",
    from: "agent",
    author: "Sarv",
    at: "28 August, 10:31",
    body: "Breathlessness is one I do not answer on my own. I am passing this to the unit now — please stay with me.",
    handover: true,
  },
  {
    id: "msg-5",
    from: "human",
    author: "Sister Lakshmi",
    at: "28 August, 11:05",
    body: "Hello Sunita — Lakshmi here. Keep the same dose for now. Do your blow this evening as well as the morning and send me both.",
  },
  {
    id: "msg-6",
    from: "human",
    author: "Sister Lakshmi",
    at: "28 August, 11:06",
    body: "If it drops below 2.12 or you get a temperature, ring the unit rather than messaging.",
    replies: ["Understood", "Better today", "Same", "Worse"],
  },
]

/** The number a patient rings. `organizations.escalation_number`, dialable. */
export const UNIT_PHONE = "+91 40 4488 5000"

/**
 * What the watch sends while the patient gets on with their life.
 *
 * **Passive, and rendered so it reads as passive.** Everything else in this app
 * is an ask with four outcomes; these arrive on their own. So they never appear
 * on Today — asking somebody for a figure their watch already sent teaches them
 * the app is not paying attention — and they carry no action line.
 *
 * **No thresholds, and that is the point.** FEV1's 10%-over-two-days rule is
 * published in the ISHLT consensus. There is no published transplant guidance
 * saying "ring the unit if you slept under six hours", and inventing one would
 * be exactly the confidently-wrong number `docs/hlt-follow-up-data.md` exists to
 * prevent. These are context for the unit and for Sarv, not instructions to the
 * patient.
 *
 * **A consumer watch's own reference ranges are wrong here, sometimes
 * dangerously.** A transplanted heart is denervated — it has no vagal supply —
 * so a resting rate of 95 to 105 is ordinary for these patients where a watch
 * will flag it as high and frighten them. That is the strongest argument for
 * showing a patient their own trend and never a population band.
 *
 * All readable through Android Health Connect: `SleepSessionRecord`,
 * `RestingHeartRateRecord`, `StepsRecord`, plus HRV, SpO2 and respiratory rate
 * when the device supplies them.
 */
export const SLEEP: HomeSeries = {
  key: "sleep",
  title: "Sleep",
  unit: "h",
  decimals: 1,
  source: "wearable",
  chart: "line",
  /* No goal. Eight hours is what a healthy adult is told, and nobody's unit
     prescribed it for a patient six weeks out of a heart–lung transplant — so
     drawing it would tell them they fell short of a target that does not
     exist. */
  meaning: "Nothing for you to do. Sleep often changes before anything else does.",
  readings: [
    { label: "27 Aug", value: 6.8 },
    { label: "28", value: 7.1 },
    { label: "29", value: 6.4 },
    { label: "30", value: 5.9 },
    { label: "31", value: 6.2 },
    { label: "1", value: 5.4 },
    { label: "2", value: 5.1 },
    { label: "3", value: 5.6 },
    { label: "4", value: 6.3 },
    { label: "5", value: 6.9 },
    { label: "6", value: 7.2 },
    { label: "7", value: 6.7 },
    { label: "8", value: 7.0 },
    { label: "9 Sep", value: 5.2 },
  ],
}

export const RESTING_HR: HomeSeries = {
  key: "resting_hr",
  title: "Resting heart rate",
  clinicalName: "Resting HR",
  unit: "bpm",
  decimals: 0,
  source: "wearable",
  chart: "line",
  meaning:
    "A new heart beats faster at rest. That is expected — your own pattern is what matters, not the number.",
  readings: [
    { label: "27 Aug", value: 96 },
    { label: "28", value: 95 },
    { label: "29", value: 97 },
    { label: "30", value: 99 },
    { label: "31", value: 98 },
    { label: "1", value: 101 },
    { label: "2", value: 103 },
    { label: "3", value: 102 },
    { label: "4", value: 99 },
    { label: "5", value: 97 },
    { label: "6", value: 96 },
    { label: "7", value: 95 },
    { label: "8", value: 96 },
    { label: "9 Sep", value: 95 },
  ],
}

export const STEPS: HomeSeries = {
  key: "steps",
  title: "Steps",
  unit: "steps",
  decimals: 0,
  source: "wearable",
  chart: "line",
  /* No goal, which is what the line below already said. The card drew a 5000
     target under a caption reading "There is no target to hit". */
  meaning: "Getting further as the months go on. There is no target to hit.",
  readings: [
    { label: "27 Aug", value: 3100 },
    { label: "28", value: 3400 },
    { label: "29", value: 2900 },
    { label: "30", value: 2600 },
    { label: "31", value: 3000 },
    { label: "1", value: 2400 },
    { label: "2", value: 2200 },
    { label: "3", value: 2700 },
    { label: "4", value: 3300 },
    { label: "5", value: 3800 },
    { label: "6", value: 4100 },
    { label: "7", value: 3900 },
    { label: "8", value: 4300 },
    { label: "9 Sep", value: 4000 },
  ],
}

/** Everything the patient does not have to send. */
export const PASSIVE = [SLEEP, RESTING_HR, STEPS]


/**
 * The weekly symptom answers, as a profile.
 *
 * ## Six domains, because that is what the request already promises
 *
 * `r-2` says "six questions about breathlessness, cough, temperature, swelling
 * and weight" — so these are those, not a set invented for the chart.
 *
 * ## Scored 0–4, and higher is worse
 *
 * The plotted shape therefore *shrinks* as a patient improves, which is the
 * opposite of the intuition a fitness app builds. It is the right way round
 * here: these are symptoms, the clinician reads severity, and inverting them
 * into a "wellness score" would put the app's own arithmetic between the
 * patient's answer and the person reading it.
 *
 * Two weeks, because a single profile says nothing. What a transplant unit asks
 * at clinic is whether the shape has grown, and that needs the week before it
 * on the same axes.
 */
export type SymptomDomain = {
  /** What the question asked about. */
  domain: string
  /** 0 none, 4 severe. */
  thisWeek: number
  lastWeek: number
}

export const SYMPTOMS: SymptomDomain[] = [
  { domain: "Breathless", thisWeek: 2, lastWeek: 1 },
  { domain: "Cough", thisWeek: 2, lastWeek: 1 },
  { domain: "Temperature", thisWeek: 1, lastWeek: 0 },
  { domain: "Swelling", thisWeek: 0, lastWeek: 0 },
  { domain: "Weight", thisWeek: 1, lastWeek: 1 },
  { domain: "Tiredness", thisWeek: 3, lastWeek: 1 },
]

/** The worst a domain can score, so the chart's rings mean the same every week. */
export const SYMPTOM_MAX = 4


/**
 * The five answers, in the order they are scored.
 *
 * The index **is** the score: "Not at all" is 0 and "Severe" is 4, so the
 * questionnaire never has to carry a second table mapping words to numbers.
 * The words are what the patient sees; the index is what the profile plots.
 */
export const SEVERITY = ["Not at all", "A little", "Somewhat", "Quite a lot", "Severe"] as const

export type SymptomQuestion = {
  /** Matches a domain in `SYMPTOMS`, so an answer lands on the right axis. */
  key: string
  /** Asked in full, as a question. */
  text: string
  /** Named in one or two words for the review list and the chart's axis. */
  short: string
  /** Only where the question is genuinely ambiguous without it. */
  help?: string
}

/**
 * The six the weekly request promises.
 *
 * `r-2` says "breathlessness, cough, temperature, swelling and weight", so
 * these are those and not a set invented to fill a chart. Each is phrased about
 * *this week* rather than today, because that is the window the request asks
 * about and a patient answering about this morning would answer differently.
 */
export const QUESTIONS: SymptomQuestion[] = [
  {
    key: "Breathless",
    short: "Breathlessness",
    text: "This week, how breathless have you been?",
    help: "Compared with your usual — walking, stairs, getting dressed.",
  },
  { key: "Cough", short: "Cough", text: "This week, how much have you been coughing?" },
  {
    key: "Temperature",
    short: "Temperature",
    text: "This week, have you had a temperature?",
    help: "Feeling hot or shivery counts, even if you did not measure it.",
  },
  {
    key: "Swelling",
    short: "Swelling",
    text: "This week, how much swelling have you had?",
    help: "Ankles, legs or hands.",
  },
  {
    key: "Weight",
    short: "Weight change",
    text: "This week, has your weight changed?",
    help: "A gain of two kilos or more in a few days is what matters.",
  },
  { key: "Tiredness", short: "Tiredness", text: "This week, how tired have you been?" },
]


/**
 * A year of mornings, so a detail screen has something a card cannot show.
 *
 * ## Why this is generated and not typed
 *
 * The fourteen readings above are hand-written because every one of them is
 * making a point — the three-day dip, the recovery, the value today. A year is
 * 365 numbers whose individual values mean nothing; what matters is that the
 * shape is plausible at every window a period selector can ask for, and that is
 * a property of the generator rather than of any one figure.
 *
 * ## The shape it produces
 *
 * A transplanted lung's FEV1 does not wander randomly. It climbs through the
 * first months as the patient recovers, settles near baseline, and dips where
 * something happened. So: a rising curve early, a plateau after, day-to-day
 * noise of a couple of percent — which is what a home spirometer actually
 * varies by — and the recorded three-day episode.
 *
 * Deterministic, from a seeded generator rather than `Math.random`: a chart
 * that redraws differently on every render is one nobody can screenshot, report
 * a bug against, or write a test for.
 */
function seeded(seed: number) {
  let state = seed
  return () => {
    /* A small linear congruential generator. Not for anything that matters —
       it exists so the same day always produces the same reading. */
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

export type LongReading = { day: number; value: number }

function buildHistory(days: number, seed: number, shape: (t: number) => number): LongReading[] {
  const rand = seeded(seed)
  const out: LongReading[] = []
  for (let d = days - 1; d >= 0; d--) {
    const t = (days - 1 - d) / (days - 1)
    /* ±2%, which is a home device's own repeatability. Noise larger than the
       instrument's error would be inventing variation the patient never had. */
    const noise = (rand() - 0.5) * 0.04
    out.push({ day: d, value: shape(t) * (1 + noise) })
  }
  return out
}

/**
 * FEV1 across the year, in litres.
 *
 * Climbs from 62% of baseline at discharge to about baseline by month four,
 * then holds — the recovery curve a heart–lung recipient is counselled to
 * expect. The dip at day 8 is the episode the fortnight above records, so the
 * two agree where they overlap.
 */
export const SPIROMETRY_YEAR: LongReading[] = buildHistory(365, 20260724, (t) => {
  const base = 2.35
  const recovery = 0.62 + 0.38 * Math.min(1, t / 0.35)
  return base * recovery
}).map((r) => (r.day >= 5 && r.day <= 7 ? { ...r, value: r.value * 0.88 } : r))

/** Steps across the year: further as the months go on, which is the care path's own line. */
export const STEPS_YEAR: LongReading[] = buildHistory(365, 20260725, (t) => 900 + 3600 * t)

/** Sleep across the year, in hours. Recovers slowly and never becomes eight. */
export const SLEEP_YEAR: LongReading[] = buildHistory(365, 20260726, (t) => 5.0 + 1.9 * t)

/** Resting heart rate: a new heart runs fast and settles. */
export const RESTING_HR_YEAR: LongReading[] = buildHistory(365, 20260727, (t) => 108 - 13 * t)

/** By series key, so a screen can ask for whichever it was opened for. */
export const YEAR_BY_KEY: Record<string, LongReading[]> = {
  fev1: SPIROMETRY_YEAR,
  steps: STEPS_YEAR,
  sleep: SLEEP_YEAR,
  resting_hr: RESTING_HR_YEAR,
}
