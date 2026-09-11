import type { RefObject } from "react"
import { Alert } from "react-native"
import { exportChartSnapshot, shareChartExport } from "@chart-kit/pro"
import * as Sharing from "expo-sharing"
import { captureRef } from "react-native-view-shot"

/**
 * A chart, as a picture the patient can send.
 *
 * ## Why this exists
 *
 * The app already lets a patient photograph a *report* and send it to the unit.
 * It had no way to send **their own readings** — the fortnight of morning blows
 * that is the whole point of the programme lived only inside the app. A
 * clinician on the phone, or a locum who cannot see this system, could not be
 * shown it.
 *
 * ## Chart Kit Pro supplies the pipeline, not the capture
 *
 * `exportChartSnapshot` takes an adapter rather than capturing anything itself,
 * and `ChartPngCaptureRef`'s signature is `react-native-view-shot`'s
 * `captureRef` exactly — which is the integration it is shaped for. Pro's part
 * is normalising the result into `{ fileName, mimeType, uri, dataUri }` and
 * handing it to a share adapter, which is the fiddly half.
 *
 * PNG rather than SVG, deliberately: this leaves the app and lands in a
 * messaging app, a mail client or a clinician's phone gallery. An SVG is
 * sharper and half of those cannot open it.
 */
export interface ChartExportOptions {
  /** Wraps the chart. Anything `captureRef` can photograph. */
  target: RefObject<unknown>
  /** Names the file the clinician receives. */
  fileName: string
  /** Goes in the share sheet's message. */
  title: string
}

export async function shareChart({ target, fileName, title }: ChartExportOptions) {
  try {
    const result = await exportChartSnapshot({
      format: "png",
      target,
      fileName,
      /**
       * A white ground, always.
       *
       * The card behind a chart is near-white and a captured view keeps
       * whatever is behind it — including nothing. A transparent PNG opened in
       * a dark-themed mail client renders dark ink on a dark ground, which is
       * an unreadable chart arriving at a clinician looking for a trend.
       */
      backgroundColor: "#ffffff",
      result: "tmpfile",
      captureRef: (view, options) => captureRef(view as never, options as never),
    })

    if (!(await Sharing.isAvailableAsync())) {
      /* Named plainly rather than failing silently. There is nowhere to send it
         on this device and no amount of retrying changes that. */
      Alert.alert("Cannot share from this phone", "No app on this phone can take the picture.")
      return
    }

    await shareChartExport({
      result,
      title,
      share: async (payload) => {
        if (!payload.url) return
        await Sharing.shareAsync(payload.url, {
          mimeType: payload.mimeType,
          dialogTitle: payload.title ?? title,
        })
      },
    })
  } catch (error) {
    /**
     * Says what failed, and does not pretend it worked.
     *
     * A share sheet the patient dismisses throws here too, so this must not
     * read as an error — it says the picture was not sent, which is true either
     * way, rather than accusing them of a fault.
     */
    Alert.alert("Not sent", "The chart could not be turned into a picture. Try again.")
    if (__DEV__) console.warn("[chartExport]", error)
  }
}
