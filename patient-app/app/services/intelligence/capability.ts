import { Platform } from "react-native"
import * as Device from "expo-device"

/**
 * Whether this phone should run a model at all.
 *
 * ## Why there is a gate rather than a try-and-see
 *
 * On-device inference does not degrade gracefully. A model that will not fit is
 * not slow — the OS kills the app, and on Android it does so without a dialog,
 * so from the patient's side the app simply vanished. For somebody six weeks
 * out of a transplant who opened it to send a reading, that is the worst
 * failure this app can have, and it is worse than not offering the feature.
 *
 * So capability is decided **before** anything is downloaded or loaded, from
 * facts the phone already knows, and a phone that does not clear the bar is
 * never offered it. Nothing is attempted speculatively.
 *
 * ## The framework this is gating for
 *
 * `react-native-executorch` — Software Mansion's binding to Meta's ExecuTorch,
 * which runs Gemma and similar models from a `.pte` file with XNNPACK or Vulkan
 * behind it. It is the right fit here for three reasons that are about this
 * project rather than benchmarks:
 *
 * - Its stated floor is **Expo SDK 55+, React Native 0.83+, New Architecture**,
 *   which is exactly what this app already is. Nothing has to be upgraded.
 * - It is Software Mansion, whose Reanimated and Gesture Handler are already
 *   dependencies here, so it is the same integration style the app already
 *   carries.
 * - Everything stays on the phone. **Cactus was the other candidate and its
 *   headline feature disqualifies it here**: it routes to the cloud when
 *   on-device confidence drops. In a health app that means a patient's symptom
 *   text leaving the device automatically, without them being asked, at a
 *   moment nobody can predict. A privacy boundary that moves on its own is not
 *   a boundary.
 *
 * Expo Go cannot load it — custom C++ — so this needs a development build,
 * which this project already produces.
 */
export type IntelligenceCapability =
  /** Runs comfortably. Offer it. */
  | "capable"
  /** Meets the floor but has little headroom. Offer it, warn once. */
  | "marginal"
  /** Not enough memory, storage or the wrong architecture. Never offer it. */
  | "insufficient"
  /** Below the framework's own OS or architecture floor. */
  | "unsupported"

export interface DeviceReport {
  capability: IntelligenceCapability
  /** Total physical RAM in bytes, or undefined where the platform hides it. */
  memoryBytes?: number
  /** The single reason, for a settings screen and for a log line. */
  reason: string
}

/**
 * The memory bar, and where it comes from.
 *
 * A 1–2B parameter model quantised to 4 bits is roughly a gigabyte of weights
 * before the KV cache, the runtime and the app itself. Android will not give a
 * single process anything like the phone's total, so the total has to be
 * comfortably more than the model needs rather than merely more.
 *
 * **8 GB is the comfortable bar and 6 GB is the marginal one.** Below 6 the
 * model and a foreground React Native app do not coexist, and the failure is an
 * OOM kill rather than a slow answer.
 *
 * These are the two numbers most likely to need revising against measurement on
 * real hardware, which is why they are named constants and not buried in a
 * comparison.
 */
const COMFORTABLE_BYTES = 8 * 1024 * 1024 * 1024
const MARGINAL_BYTES = 6 * 1024 * 1024 * 1024

/** ExecuTorch's own floors, from its documentation. */
const MIN_ANDROID_API = 26
const MIN_IOS_MAJOR = 17

export async function inspectDevice(): Promise<DeviceReport> {
  /**
   * An emulator is reported as capable regardless.
   *
   * Not to flatter it: a simulator has the host's memory and none of the
   * thermal or scheduling limits, so its numbers say nothing about a phone.
   * Gating on them would make the feature untestable on a developer machine
   * while telling nobody anything true.
   */
  if (!Device.isDevice) {
    return { capability: "capable", reason: "Simulator — the gate is not meaningful here." }
  }

  if (Platform.OS === "android") {
    const api = Device.platformApiLevel ?? 0
    if (api > 0 && api < MIN_ANDROID_API) {
      return { capability: "unsupported", reason: `Android API ${api}; the runtime needs ${MIN_ANDROID_API}.` }
    }

    /**
     * 64-bit only.
     *
     * ExecuTorch ships arm64 backends, and a 32-bit process cannot address a
     * model of this size even if the phone had the RAM. Reported as
     * `unsupported` rather than `insufficient` because no amount of free memory
     * changes it.
     */
    const arch = Device.supportedCpuArchitectures ?? []
    if (arch.length > 0 && !arch.some((a) => a.includes("64"))) {
      return { capability: "unsupported", reason: "32-bit processor." }
    }
  }

  if (Platform.OS === "ios") {
    const major = Number.parseInt(String(Device.osVersion ?? "0"), 10)
    if (major > 0 && major < MIN_IOS_MAJOR) {
      return { capability: "unsupported", reason: `iOS ${major}; the runtime needs ${MIN_IOS_MAJOR}.` }
    }
  }

  const memoryBytes = Device.totalMemory ?? undefined

  /**
   * No memory figure is *not* a pass.
   *
   * iOS does not publish total RAM through this API, and treating "unknown" as
   * "fine" is how a gate that exists to prevent an OOM kill causes one. Marginal
   * is the honest answer: the OS floor was met, the headroom is unverified.
   */
  if (memoryBytes === undefined) {
    return {
      capability: "marginal",
      reason: "This phone does not report its memory, so headroom is unknown.",
    }
  }

  if (memoryBytes >= COMFORTABLE_BYTES) {
    return { capability: "capable", memoryBytes, reason: `${gb(memoryBytes)} GB of memory.` }
  }

  if (memoryBytes >= MARGINAL_BYTES) {
    return {
      capability: "marginal",
      memoryBytes,
      reason: `${gb(memoryBytes)} GB of memory — enough, with little to spare.`,
    }
  }

  return {
    capability: "insufficient",
    memoryBytes,
    reason: `${gb(memoryBytes)} GB of memory; this needs at least ${gb(MARGINAL_BYTES)} GB.`,
  }
}

/** One decimal, because "7.9 GB" is a fact and "7.94921875 GB" is noise. */
function gb(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1)
}

/** The only question most callers have. */
export function shouldRunOnDevice(report: DeviceReport) {
  return report.capability === "capable" || report.capability === "marginal"
}
