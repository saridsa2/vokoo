import { FC, ReactNode } from "react"
import { Linking, TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { Panel } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { Text } from "@/components/Text"
import { useHealthMetric, type HealthAvailability } from "@/services/health"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * What stands where the wearable card goes, when there is no wearable.
 *
 * ## Five states, five screens
 *
 * An empty series has five meanings and they are not interchangeable. Told
 * apart, each one has a different thing to say and a different button — or no
 * button, which is itself information:
 *
 * | | what the patient can do |
 * |---|---|
 * | no health store on the phone | nothing, and the card should not imply otherwise |
 * | Health Connect not installed | install it |
 * | never asked | grant it, here |
 * | refused | change it, and only in system settings |
 * | granted but empty | nothing — their watch has not reported yet |
 *
 * Collapsed into "no data yet", the fourth case tells somebody who declined
 * that their watch is broken, and the first tells somebody with an
 * incompatible phone to keep waiting for something that will never arrive.
 *
 * ## Why it asks for everything at once
 *
 * One sheet. Asking as each card mounts would show five in a row, which is how
 * a patient ends up refusing all of them to make it stop.
 */
export interface WearableGateProps {
  /** Shown once the store is connected and has something to give. */
  children: ReactNode
}

const COPY: Record<
  Exclude<HealthAvailability, "ready">,
  { title: string; body: string; action?: string }
> = {
  unsupported: {
    title: "No health app on this phone",
    /* No button. A screen that offers an action for something the patient
       cannot change is worse than one that admits the limit. */
    body: "Your readings will come from the clinic instead.",
  },
  "needs-install": {
    title: "Health Connect is not set up",
    body: "Android needs it to pass on your watch's readings.",
    action: "Open Health Connect",
  },
  "not-asked": {
    /**
     * Not "connect your watch".
     *
     * The app never talks to a watch. It reads the phone's health app, and any
     * wearable that writes there — Samsung, Fitbit, Garmin, Oura, Apple Watch —
     * arrives through it. "Connect your watch" promises a pairing that does not
     * happen and sets up the wrong thing to blame when a brand is not syncing.
     */
    title: "Connect your health app",
    /* Names the three things and stops. The earlier version explained what a
       wearable is to somebody who owns one. */
    body: "Sleep, steps and heart rate, shared with your team.",
    action: "Connect",
  },
  denied: {
    title: "Not connected",
    /* Named plainly. An app cannot re-prompt once refused, and pretending a
       button here will work is a dead end the patient walks into twice. */
    body: "Turn it back on in your phone's settings.",
    action: "Open settings",
  },
}

export const WearableGate: FC<WearableGateProps> = function WearableGate({ children }) {
  const { themed, theme } = useAppTheme()

  /* Any granted metric answers for all of them: permission is asked once, for
     the whole set, so one is as good a probe as another. */
  const { availability, samples, loading, connect } = useHealthMetric("steps")

  if (loading) return null
  if (availability === "ready" && samples.length > 0) return <>{children}</>

  /* Connected, and the watch simply has not reported. The only one of the six
     that is not a problem. */
  if (availability === "ready") {
    return (
      <Panel>
        <Text preset="bold" text="Nothing has come through yet" style={themed($title)} />
        {/**
         * Names the second step, which is the one we do not control.
         *
         * A patient can grant this app everything and still see nothing,
         * because their watch's own app has to be set to write into the health
         * app first. Left unsaid, the blame lands here — and the fix is
         * somewhere the patient would never think to look.
         */}
        <Text
          preset="formHelper"
          text="Check your watch's app is sharing."
          style={themed($body)}
        />
      </Panel>
    )
  }

  const copy = COPY[availability]

  return (
    <Panel>
      <View style={themed($head)}>
        <Glyph name="heart" size={18} color={theme.colors.textDim} />
        <Text preset="bold" text={copy.title} style={themed($title)} />
      </View>
      <Text preset="formHelper" text={copy.body} style={themed($body)} />
      {copy.action ? (
        <PillButton
          text={copy.action}
          variant="secondary"
          onPress={availability === "not-asked" ? connect : () => Linking.openSettings()}
        />
      ) : null}
    </Panel>
  )
}

const $head: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })
