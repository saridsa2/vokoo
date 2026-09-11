import { useCallback, useEffect, useState } from "react"

import { inspectDevice, shouldRunOnDevice, type DeviceReport } from "./capability"

export * from "./capability"
export * from "./exchange"
export * from "./watch"
export * from "./history"
export * from "./chat"

/**
 * Where the app's intelligence runs, decided per phone.
 *
 * ## Three places it can run, and only one of them is free
 *
 * - **On device.** Private by construction — nothing leaves the phone, which
 *   for a transplant patient's symptoms is the only arrangement that needs no
 *   explaining. Costs nothing per use. Requires a phone that can hold the
 *   model.
 * - **In the clinic's own service.** Where a phone cannot. Needs the patient
 *   told, and needs the request to be one they consented to.
 * - **Nowhere.** The app works without it: the road, the readings, the
 *   requests and the messages are all unaffected. That is why the gate can be
 *   strict — refusing costs a convenience, not the care path.
 *
 * ## The gate is a promise, not an optimisation
 *
 * `capability.ts` decides from the phone's own facts before anything is
 * downloaded. A model that will not fit does not run slowly, it gets the app
 * killed by the OS — silently, on Android — so a patient who opened the app to
 * send a reading watches it disappear. Refusing to offer the feature is a
 * better outcome than that, every time.
 *
 * ## What is here and what is not
 *
 * The gate is real and measured. `load` and `ask` are the shape the
 * `react-native-executorch` session will fill — deliberately written as the
 * seam rather than as a stub that pretends to answer, because a fake reply from
 * something called "intelligence" in a health app is worse than a missing
 * feature. **Nothing here has run a model yet**; said plainly so nobody reads
 * this file as working.
 */
export type IntelligenceState =
  /** Still asking the phone what it is. */
  | "checking"
  /** This phone can, and the model is not loaded. */
  | "ready"
  /** Loading or downloading the model. */
  | "loading"
  /** Loaded and answering. */
  | "live"
  /** This phone cannot, and never will. */
  | "unavailable"

export interface Intelligence {
  state: IntelligenceState
  report?: DeviceReport
  /** True only where the model may be offered at all. */
  available: boolean
  refresh: () => Promise<void>
}

export function useIntelligence(): Intelligence {
  const [state, setState] = useState<IntelligenceState>("checking")
  const [report, setReport] = useState<DeviceReport | undefined>()

  const refresh = useCallback(async () => {
    setState("checking")
    const next = await inspectDevice()
    setReport(next)
    setState(shouldRunOnDevice(next) ? "ready" : "unavailable")
  }, [])

  useEffect(() => {
    /* Once per mount and never on a timer: a phone does not gain memory while
       the app is open. */
    refresh()
  }, [refresh])

  return {
    state,
    report,
    available: state === "ready" || state === "loading" || state === "live",
    refresh,
  }
}
