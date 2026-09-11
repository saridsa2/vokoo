/**
 * The contract between this app and a phone's health store.
 *
 * ## Why this exists before the integration does
 *
 * Reading Google Health Connect or Apple HealthKit needs a native module, a
 * permissions flow, and — on Android — a Play Console declaration that is
 * reviewed by somebody else on their schedule. None of that blocks the shape of
 * the thing.
 *
 * So the shape is here, with a mock behind it. Every screen reads through this
 * interface today; when the native module lands it is one implementation
 * swapped, and the permission states, the empty states and the "no wearable"
 * path have all been exercised for weeks by then. The alternative is writing
 * the interesting half last and discovering the states on the day the
 * declaration clears.
 */

/**
 * What we would read, and nothing beyond it.
 *
 * Deliberately not "everything the platform offers". Each of these earns its
 * place for a heart–lung recipient, and a health store will hand over a hundred
 * types if asked — asking for one we do not use is a permission a patient has
 * to grant for nothing.
 */
export type HealthMetric =
  /** The most directly relevant thing a watch measures for a lung recipient. */
  | "oxygen_saturation"
  /** Rises with infection, often before the patient feels unwell. */
  | "respiratory_rate"
  /** Fever is on the ring-the-unit list; a watch catches a rise overnight. */
  | "skin_temperature"
  | "resting_heart_rate"
  /** Studied as an early rejection signal, and noisy in a denervated heart. */
  | "heart_rate_variability"
  | "sleep"
  | "steps"
  /**
   * A real transplant follow-up measure — the clinic already does it at review
   * visits, which is what makes it the most interesting thing on this list.
   *
   * **HealthKit only.** Health Connect has no equivalent record, so on Android
   * this can only come from the clinic or from the patient by hand. See
   * `catalogue.ts`, where that asymmetry is data rather than a comment.
   */
  | "six_minute_walk"

/** One reading, as the store gives it. */
export interface HealthSample {
  /** ISO 8601, in the zone the store recorded it. */
  at: string
  value: number
}

/**
 * Where the patient stands with their health store.
 *
 * Five states, and **each one needs a different screen** — which is the whole
 * argument for naming them before the integration exists. A single boolean
 * would have collapsed "this phone cannot do it", "you have not been asked
 * yet", and "you said no" into one blank card.
 */
export type HealthAvailability =
  /** No health store on this device, and nothing the patient can do about it. */
  | "unsupported"
  /** Health Connect exists but is not installed or is out of date. */
  | "needs-install"
  /** Installed, and we have not asked. */
  | "not-asked"
  /** We asked and were refused. Recoverable, and only in system settings. */
  | "denied"
  | "ready"

export interface HealthSource {
  /** Cheap and callable on every mount; must not prompt. */
  availability(): Promise<HealthAvailability>
  /**
   * Asks for exactly the metrics named.
   *
   * Returns what was actually granted, not whether the sheet was shown — a
   * patient may grant sleep and refuse heart rate, and the screen has to be
   * able to say so.
   */
  request(metrics: HealthMetric[]): Promise<HealthMetric[]>
  /** What has been granted so far, without asking for more. */
  granted(): Promise<HealthMetric[]>
  read(metric: HealthMetric, days: number): Promise<HealthSample[]>
}
