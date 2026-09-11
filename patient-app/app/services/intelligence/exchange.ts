import type { DeviceReport } from "./capability"

/**
 * The two-model exchange: the patient's model talking to the clinic's.
 *
 * ## Two intelligences, and they are not the same intelligence
 *
 * They know different things and are trusted with different things, which is
 * the whole reason for splitting them rather than picking one.
 *
 * | | on the phone | on the server |
 * |---|---|---|
 * | holds | the patient's raw words, readings, photographs | the care path, the cohort, this patient's record |
 * | can | converse, ask again, summarise, decide what matters | act — book, escalate, message the team |
 * | costs | nothing per use | per call, per patient, per day, for a year |
 * | needs | no network | a network |
 *
 * ## What crosses, and what does not
 *
 * **The raw never leaves.** A patient says "I've been coughing at night and my
 * chest feels tight and I couldn't sleep" — the local model holds that, asks
 * what it needs to ask, and sends up a `Brief`: structured, small, and about
 * the care path rather than about the conversation. The clinic's model answers
 * the brief, not the sentence.
 *
 * That ordering is the point. Data minimisation happens **at the edge**, by the
 * model that can read the raw and judge what matters, rather than in a filter
 * on the server that has already received it. A redaction step after transit is
 * a promise; not transmitting is a fact.
 *
 * ## Why a schema and not free text between them
 *
 * The server side already fills `structured_outputs` schemas by forced tool
 * call — that machinery exists, is shared, and produces an object by
 * construction rather than prose to be parsed. Sending prose up would mean the
 * clinic's model re-deriving what the patient's model already decided, twice
 * the cost and two places for it to disagree.
 *
 * It also makes the exchange **inspectable**, which is what makes it consentable:
 * a patient cannot agree to something they cannot see, and six named fields can
 * be shown on a screen. A paragraph of model output cannot.
 *
 * ## Offline is the ordinary case, not the error case
 *
 * The local half works with no network — that is most of why it is local. So an
 * exchange that cannot reach the server is **queued**, not failed, and the
 * patient is told what is waiting rather than shown a retry button. Nothing
 * about the morning reading, the questionnaire or the road depends on the
 * server answering.
 */

/** What the patient's model decided is worth sending. */
export interface Brief {
  /** Which request or moment this is about, so the server can place it. */
  about: string
  /**
   * The care path's own vocabulary, filled from the conversation.
   *
   * Keyed by the schema the clinic published, so the clinic's model receives
   * fields it already understands rather than a description to interpret.
   */
  fields: Record<string, string | number | boolean | null>
  /**
   * What the local model could not settle.
   *
   * Named rather than guessed. A local model that fills a field it is unsure of
   * hands the clinic a confident wrong answer, which is worse than a gap the
   * clinic can ask about.
   */
  unresolved: string[]
  /**
   * The patient's own words, only where they were explicitly kept.
   *
   * Empty by default and never populated automatically. Present so that a
   * patient who *wants* to say something in their own words to their team has a
   * way to, not as a transcript channel with a friendlier name.
   */
  verbatim?: string
}

/** What the clinic's model sent back. */
export interface ClinicReply {
  /**
   * What the patient should do, in the clinic's judgement.
   *
   * `none` is a real answer and the common one. An intelligence that always
   * finds something to say trains people to stop reading it.
   */
  action: "none" | "watch" | "contact_unit" | "attend"
  /** One sentence, from the clinic's side, for the local model to render. */
  reason: string
  /** Anything the clinic wants asked before it decides. */
  askBack?: string[]
}

export type ExchangeOutcome =
  | { status: "answered"; reply: ClinicReply }
  /** No network. Held, and the patient told what is waiting. */
  | { status: "queued"; brief: Brief }
  /** The server refused it — a 4xx. Retrying is a bug, not resilience. */
  | { status: "refused"; reason: string }
  /** The server was unreachable or errored — a 5xx. Retrying is correct. */
  | { status: "unavailable"; reason: string }

export interface ExchangeInput {
  brief: Brief
  /**
   * Where the local half ran.
   *
   * Carried so the server knows whether the brief was composed by a model on
   * the phone or assembled from raw answers on a phone that could not run one.
   * The clinic reads those differently: one has had judgement applied, the
   * other has not, and a server that cannot tell them apart will treat an
   * unfiltered form as a considered summary.
   */
  device: DeviceReport
}

/**
 * Sends one brief and returns what the clinic said.
 *
 * **Not implemented against the real endpoint yet.** The control plane route
 * this will post to does not exist, and a version that fabricated a reply would
 * be a health app inventing clinical advice — the one thing this must never do.
 * So it reports `unavailable` and says why, which is true.
 */
export async function exchange(_input: ExchangeInput): Promise<ExchangeOutcome> {
  return {
    status: "unavailable",
    reason: "The clinic endpoint is not wired yet.",
  }
}
