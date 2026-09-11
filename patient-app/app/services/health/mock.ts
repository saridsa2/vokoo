import { Platform } from "react-native"

import { PASSIVE } from "@/services/mock/careData"
import { load, save } from "@/utils/storage"

import { isSupported, METRICS } from "./catalogue"
import type { HealthAvailability, HealthMetric, HealthSample, HealthSource } from "./types"

/**
 * A health store that is not one.
 *
 * It answers the same questions the real thing will, from the arrays the app
 * already ships. Two things make it worth having rather than just hard-coding
 * the screens:
 *
 * **It refuses what the platform refuses.** Asking for a six-minute walk on
 * Android returns nothing here, exactly as it will in production, because
 * Health Connect has no such record. A mock that cheerfully returned data would
 * hide the one asymmetry the design has to handle.
 *
 * **It can be put into any state.** `setState` walks it through unsupported,
 * needs-install, not-asked, denied and ready, so every one of those screens can
 * be built and looked at before a native module exists. Those are the states
 * that otherwise get discovered on the day the Play declaration clears.
 *
 * **And it remembers.** The first version held the grant in memory, so it died
 * with the process and asked again on every launch — which a real health store
 * never does: the OS owns that decision and hands it back on the next call.
 * A mock that forgets is not standing in for the real thing, it is teaching the
 * app a behaviour that will disappear the day it is replaced.
 */
/* One key, so clearing it resets the whole mock to a first-run device. */
const STORE_KEY = "health.mock.grant"

interface Persisted {
  state: HealthAvailability
  permitted: HealthMetric[]
}

class MockHealthSource implements HealthSource {
  private state: HealthAvailability
  private permitted: HealthMetric[]

  constructor() {
    const saved = load<Persisted>(STORE_KEY)
    this.state = saved?.state ?? "not-asked"
    this.permitted = saved?.permitted ?? []
  }

  private persist() {
    save(STORE_KEY, { state: this.state, permitted: this.permitted } satisfies Persisted)
  }

  /** For development and for tests: force a state and see that screen. */
  setState(next: HealthAvailability) {
    this.state = next
    if (next !== "ready") this.permitted = []
    this.persist()
  }

  async availability() {
    return this.state
  }

  async request(metrics: HealthMetric[]) {
    if (this.state === "unsupported" || this.state === "needs-install") return []
    /* Only what this platform could actually provide. A grant for something the
       store cannot supply would be a permission taken for nothing. */
    const possible = metrics.filter((m) => isSupported(m, Platform.OS === "ios" ? "ios" : "android"))
    this.permitted = possible
    this.state = possible.length > 0 ? "ready" : "denied"
    this.persist()
    return possible
  }

  async granted() {
    return this.permitted
  }

  async read(metric: HealthMetric, days: number): Promise<HealthSample[]> {
    if (this.state !== "ready" || !this.permitted.includes(metric)) return []

    /**
     * Backed by the same arrays the screens draw today, so switching a screen
     * onto this interface changes nothing on screen — which is the point. A
     * mock with its own invented numbers would make the swap a visible event
     * and hide whichever screen it broke.
     */
    const series = PASSIVE.find((s) => KEY_FOR[metric] === s.key)
    if (!series) return []

    const recent = series.readings.slice(-days)
    const today = new Date()
    return recent.map((r, i) => {
      const at = new Date(today)
      at.setDate(today.getDate() - (recent.length - 1 - i))
      return { at: at.toISOString(), value: r.value }
    })
  }
}

/**
 * Which mock series stands in for which metric.
 *
 * Only three of the eight have one, and the gaps are honest: nothing in the app
 * has ever held a blood oxygen reading, so the mock has none to give. A screen
 * asking for it gets an empty series and has to cope — which is the same thing
 * it will get from a patient whose watch does not measure it.
 */
const KEY_FOR: Partial<Record<HealthMetric, string>> = {
  sleep: "sleep",
  steps: "steps",
  resting_heart_rate: "resting_hr",
}

export const mockHealth = new MockHealthSource()

/** Every metric this build would ask a patient to grant. */
export const WANTED: HealthMetric[] = Object.keys(METRICS) as HealthMetric[]
