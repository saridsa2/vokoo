import { useCallback, useEffect, useState } from "react"

import { mockHealth, WANTED } from "./mock"
import type { HealthAvailability, HealthMetric, HealthSample, HealthSource } from "./types"

export * from "./types"
export { METRICS, isSupported, reduceDay } from "./catalogue"
export { WANTED } from "./mock"

/**
 * The one place the app decides where health data comes from.
 *
 * Today it is the mock. When `react-native-health-connect` and
 * `@kingstinct/react-native-healthkit` are installed this becomes a platform
 * switch and **nothing else in the app changes** — which is the whole reason
 * the interface exists before the integration does.
 *
 * Two things are already known about that day and are worth having written
 * down where the swap happens:
 *
 * - iOS must pin `react-native-nitro-modules` to **0.36.5**. 0.37.x fails to
 *   build against React Native 0.83 with static libraries, which is this
 *   project's configuration; the fix is unmerged and `latest` is still broken.
 * - The HealthKit config plugin sets the background-delivery *entitlement* but
 *   does not patch `AppDelegate`, so background reads look wired and die with
 *   the process. That needs a local plugin.
 */
export const health: HealthSource = mockHealth

/**
 * A metric, its samples, and where the patient stands with permission.
 *
 * Returns the state as well as the data because **an empty series has five
 * different meanings** — no health store, not installed, never asked, refused,
 * or genuinely no readings — and a screen that only receives `[]` has to guess
 * between them. Guessing produces the worst version: "no data yet" shown to
 * somebody who was never asked.
 */
export function useHealthMetric(metric: HealthMetric, days = 14) {
  const [availability, setAvailability] = useState<HealthAvailability>("not-asked")
  const [samples, setSamples] = useState<HealthSample[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const state = await health.availability()
    setAvailability(state)
    setSamples(state === "ready" ? await health.read(metric, days) : [])
    setLoading(false)
  }, [metric, days])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Asks for everything at once, not for this metric alone.
   *
   * A health store shows one sheet; asking per metric as each card mounts would
   * show a patient five sheets in a row, which is how somebody ends up
   * refusing all of them to make it stop.
   */
  const connect = useCallback(async () => {
    await health.request(WANTED)
    await load()
  }, [load])

  return { availability, samples, loading, connect, reload: load }
}
