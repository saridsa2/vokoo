import type { HealthMetric } from "./types"

/**
 * What each metric is called on each platform, and where it does not exist.
 *
 * The research findings live here as **data rather than as prose in a document
 * nobody opens while writing the read call**. Two of them change what the app
 * can promise, so they are typed:
 *
 * - `healthConnect: null` means the platform has no such record. Six-minute
 *   walk distance is the case, and it is the one that matters: it is a genuine
 *   transplant follow-up measure the clinic already performs, available on
 *   iOS and simply absent on Android.
 * - `aggregatable: false` means the store will not bucket it for us, so the
 *   read comes back as raw records and this app does the bucketing.
 *
 * Keeping both here means a screen can ask "can I offer this to *this* patient
 * on *this* phone" and get an answer without a platform check at the call site.
 */
export interface MetricDefinition {
  /** What the patient calls it. */
  title: string
  unit: string
  decimals: number
  /** Health Connect's record type, or `null` where there is none. */
  healthConnect: string | null
  /** HealthKit's identifier, or `null` where there is none. */
  healthKit: string | null
  /**
   * Whether the store can bucket it by day.
   *
   * Only four of these can, so most series arrive as raw samples and are
   * reduced here. Written down because discovering it per metric during the
   * integration is how a read ends up returning a fortnight of unaggregated
   * points into a chart expecting fourteen.
   */
  aggregatable: boolean
  /** How a day's worth of samples becomes one number. */
  reduce: "latest" | "mean" | "sum" | "min"
}

export const METRICS: Record<HealthMetric, MetricDefinition> = {
  oxygen_saturation: {
    title: "Blood oxygen",
    unit: "%",
    decimals: 0,
    healthConnect: "OxygenSaturation",
    healthKit: "HKQuantityTypeIdentifierOxygenSaturation",
    aggregatable: false,
    /* The worst of the day, not the average: a dip is the signal, and a mean
       buries it under a day of normal readings. */
    reduce: "min",
  },
  respiratory_rate: {
    title: "Breathing rate",
    unit: "breaths/min",
    decimals: 0,
    healthConnect: "RespiratoryRate",
    healthKit: "HKQuantityTypeIdentifierRespiratoryRate",
    aggregatable: false,
    reduce: "mean",
  },
  skin_temperature: {
    title: "Skin temperature",
    unit: "°C",
    decimals: 1,
    healthConnect: "SkinTemperature",
    healthKit: "HKQuantityTypeIdentifierAppleSleepingWristTemperature",
    aggregatable: false,
    reduce: "mean",
  },
  resting_heart_rate: {
    title: "Resting heart rate",
    unit: "bpm",
    decimals: 0,
    healthConnect: "RestingHeartRate",
    healthKit: "HKQuantityTypeIdentifierRestingHeartRate",
    aggregatable: true,
    reduce: "mean",
  },
  heart_rate_variability: {
    title: "Heart rate variability",
    unit: "ms",
    decimals: 0,
    healthConnect: "HeartRateVariabilityRmssd",
    healthKit: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    aggregatable: false,
    reduce: "mean",
  },
  sleep: {
    title: "Sleep",
    unit: "h",
    decimals: 1,
    healthConnect: "SleepSession",
    healthKit: "HKCategoryTypeIdentifierSleepAnalysis",
    aggregatable: true,
    reduce: "sum",
  },
  steps: {
    title: "Steps",
    unit: "steps",
    decimals: 0,
    healthConnect: "Steps",
    healthKit: "HKQuantityTypeIdentifierStepCount",
    aggregatable: true,
    reduce: "sum",
  },
  six_minute_walk: {
    title: "Six-minute walk",
    unit: "m",
    decimals: 0,
    /**
     * **Android cannot supply this.**
     *
     * Not an oversight and not a version to wait for — Health Connect has no
     * such record type. The clinic measures it at review visits, so on Android
     * it comes from them or from the patient, and any screen offering it has to
     * say so rather than showing an empty chart.
     */
    healthConnect: null,
    healthKit: "HKQuantityTypeIdentifierSixMinuteWalkTestDistance",
    aggregatable: false,
    reduce: "latest",
  },
}

/** Whether this platform can supply a metric at all. */
export function isSupported(metric: HealthMetric, platform: "android" | "ios") {
  const def = METRICS[metric]
  return (platform === "android" ? def.healthConnect : def.healthKit) !== null
}

/** A day's samples, as one number, per the metric's own rule. */
export function reduceDay(metric: HealthMetric, values: number[]): number | undefined {
  if (values.length === 0) return undefined
  switch (METRICS[metric].reduce) {
    case "sum":
      return values.reduce((a, b) => a + b, 0)
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length
    case "min":
      return Math.min(...values)
    case "latest":
      return values[values.length - 1]
  }
}
