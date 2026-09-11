import { useCallback, useEffect, useState } from "react"
import { Linking } from "react-native"
import { Camera } from "expo-camera"
import * as Notifications from "expo-notifications"

/**
 * The four things this app asks a patient's phone for.
 *
 * Named by **what they are for**, not by the API behind them, because that is
 * what the screens say and what the patient decides about. "Microphone" is a
 * capability; "talking to Sarv instead of typing" is a reason, and a permission
 * without a reason is one people refuse.
 */
import { health, WANTED } from "@/services/health"

export type Capability = "notifications" | "camera" | "microphone" | "health"

/**
 * Three states, and the third is the one that matters.
 *
 * `blocked` is not `denied`: on both platforms a refused permission cannot be
 * asked for again from inside the app. A screen that offers "Allow" to somebody
 * already blocked sends them into a button that silently does nothing — so the
 * state has to be distinguishable, and its action is Settings rather than a
 * prompt.
 */
export type PermissionState = "granted" | "undetermined" | "blocked"

export interface CapabilityStatus {
  state: PermissionState
  /** False where the platform has no such thing to ask for. */
  askable: boolean
}

async function readNotifications(): Promise<CapabilityStatus> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync()
  if (status === "granted") return { state: "granted", askable: false }
  return { state: canAskAgain ? "undetermined" : "blocked", askable: canAskAgain }
}

async function readCamera(): Promise<CapabilityStatus> {
  const { status, canAskAgain } = await Camera.getCameraPermissionsAsync()
  if (status === "granted") return { state: "granted", askable: false }
  return { state: canAskAgain ? "undetermined" : "blocked", askable: canAskAgain }
}

async function readMicrophone(): Promise<CapabilityStatus> {
  const { status, canAskAgain } = await Camera.getMicrophonePermissionsAsync()
  if (status === "granted") return { state: "granted", askable: false }
  return { state: canAskAgain ? "undetermined" : "blocked", askable: canAskAgain }
}

/** Reads a capability without prompting. Safe to call on every mount. */
export async function statusOf(capability: Capability): Promise<CapabilityStatus> {
  switch (capability) {
    case "notifications":
      return readNotifications()
    case "camera":
      return readCamera()
    case "microphone":
      return readMicrophone()
    case "health": {
      /**
       * Asked, not assumed.
       *
       * This branch said "health has its own service" and then never called
       * it — it returned `undetermined` unconditionally. So granting the health
       * permission worked, the grant was written to the store, and the row
       * re-read `undetermined` and did not move. Pressing Allow appeared to do
       * nothing, for the whole life of the screen.
       *
       * The five availability states do not map one-to-one onto three
       * permission states, and the collapse is the interesting part: an
       * `unsupported` phone and a `denied` one both leave the patient with no
       * health data, but only one of them has anything to go and change.
       */
      const availability = await health.availability()
      switch (availability) {
        case "ready":
          return { state: "granted", askable: false }
        case "denied":
          return { state: "blocked", askable: false }
        case "unsupported":
          /* Nothing to ask and nowhere to send them. Reported as blocked so the
             row stops offering a prompt that cannot appear. */
          return { state: "blocked", askable: false }
        case "needs-install":
        case "not-asked":
          return { state: "undetermined", askable: true }
      }
    }
  }
}

/** Prompts, and returns what the patient decided. */
export async function request(capability: Capability): Promise<CapabilityStatus> {
  switch (capability) {
    case "notifications": {
      const { status, canAskAgain } = await Notifications.requestPermissionsAsync()
      return status === "granted"
        ? { state: "granted", askable: false }
        : { state: canAskAgain ? "undetermined" : "blocked", askable: canAskAgain }
    }
    case "camera": {
      const { status, canAskAgain } = await Camera.requestCameraPermissionsAsync()
      return status === "granted"
        ? { state: "granted", askable: false }
        : { state: canAskAgain ? "undetermined" : "blocked", askable: canAskAgain }
    }
    case "microphone": {
      const { status, canAskAgain } = await Camera.requestMicrophonePermissionsAsync()
      return status === "granted"
        ? { state: "granted", askable: false }
        : { state: canAskAgain ? "undetermined" : "blocked", askable: canAskAgain }
    }
    case "health": {
      /* The health sheet is the service's own — `request` here only reports
         where it left things, which is what the row re-reads. */
      await health.request(WANTED)
      return statusOf("health")
    }
  }
}

/** The only route back once a permission is blocked. */
export function openSettings() {
  Linking.openSettings()
}

/**
 * One capability's state, and a way to ask for it.
 *
 * Re-reads on demand rather than on a timer: a patient who leaves for Settings
 * and comes back needs the screen to have noticed, and the moment they come
 * back is a navigation event, not a tick.
 */
export function useCapability(capability: Capability) {
  const [status, setStatus] = useState<CapabilityStatus>({ state: "undetermined", askable: true })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setStatus(await statusOf(capability))
    setLoading(false)
  }, [capability])

  useEffect(() => {
    refresh()
  }, [refresh])

  const ask = useCallback(async () => {
    const next = await request(capability)
    setStatus(next)
    return next
  }, [capability])

  return { ...status, loading, ask, refresh }
}
