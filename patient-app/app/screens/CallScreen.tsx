import { FC, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { PROVIDER } from "@/services/mock/careData"
import {
  createMockCall,
  type CallSnapshot,
  type CallState,
  type Utterance,
} from "@/services/voice/call"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * A call with the agent, inside the app.
 *
 * **Not a dialler screen.** A phone call screen is a picture of a person and
 * three round buttons, because on a phone call there is nothing to look at. Here
 * there is: what the agent just said, in text, as it says it. That is the whole
 * argument for the audio being in the app rather than out through the carrier —
 * a patient who mishears "before your morning dose, not after" can read it.
 *
 * So the transcript is the screen and the controls are a bar under it.
 *
 * **Reading is also the accessibility story.** A hard-of-hearing patient, a
 * patient on a noisy ward, and a patient whose first language is not the one the
 * agent is speaking all get the same call. None of that is available on a
 * carrier call, and it is worth the WebRTC build on its own.
 *
 * The audio is mocked. `services/voice/call.ts` holds the seam and the reason.
 */
interface CallScreenProps extends AppStackScreenProps<"Call"> {}

export const CallScreen: FC<CallScreenProps> = function CallScreen({ navigation }) {
  const { themed, theme } = useAppTheme()
  const call = useMemo(() => createMockCall(), [])
  const [snapshot, setSnapshot] = useState<CallSnapshot>()
  const scroller = useRef<ScrollView>(null)

  useEffect(() => {
    const unsubscribe = call.subscribe(setSnapshot)
    call.start()
    /* Hanging up on unmount, not only on the button: leaving the screen by the
       back gesture must release the microphone, and a call that outlives its
       screen is one nobody can end. */
    return () => {
      call.hangUp()
      unsubscribe()
    }
  }, [call])

  const state = snapshot?.state ?? "connecting"
  const live = state === "connected" || state === "escalating" || state === "with-human"

  function leave() {
    call.hangUp()
    navigation.goBack()
  }

  return (
    <Screen
      preset="fixed"
      contentContainerStyle={themed($container)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($head)}>
        <View style={$headBody}>
          <Text preset="subheading" text={snapshot?.speaking ?? "Sarv"} style={themed($who)} />
          <Text
            preset="formHelper"
            text={statusLine(state, snapshot?.seconds ?? 0)}
            style={themed($status)}
          />
        </View>
        {/* A live dot, not a spinner. A spinner says "waiting"; this call is
            not waiting, it is happening. */}
        {live ? <View style={[themed($dot), { backgroundColor: theme.colors.done }]} /> : null}
      </View>

      {state === "with-human" ? (
        <View style={themed($handover)}>
          <Glyph name="careTeam" size={16} color={theme.colors.asked} />
          <Text
            preset="formHelper"
            text="You are speaking to a person now. Sarv is still listening and taking notes."
            style={themed($handoverText)}
          />
        </View>
      ) : null}

      <ScrollView
        ref={scroller}
        style={$transcript}
        contentContainerStyle={themed($transcriptBody)}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
      >
        {state === "connecting" ? (
          <Text preset="default" text="Connecting…" style={themed($status)} />
        ) : null}
        {snapshot?.transcript.map((u) => (
          <Turn key={u.id} utterance={u} />
        ))}
      </ScrollView>

      <View style={themed($controls)}>
        <View style={themed($controlRow)}>
          <ControlButton
            icon={snapshot?.muted ? "close" : "message"}
            label={snapshot?.muted ? "Unmuted" : "Mute"}
            active={snapshot?.muted}
            onPress={() => call.setMuted(!snapshot?.muted)}
          />
          {/* Only while the agent has it. Asking twice would queue a second
              coordinator for one call. */}
          {state === "connected" ? (
            <ControlButton
              icon="careTeam"
              label="Get a person"
              onPress={() => call.requestHuman()}
            />
          ) : null}
        </View>

        <PillButton
          text={state === "ended" ? "Close" : "End call"}
          variant={state === "ended" ? "secondary" : "destructive"}
          onPress={leave}
        />
      </View>
    </Screen>
  )
}

/**
 * One turn.
 *
 * The agent's turns are the ones that carry instructions, so they get the card
 * and the patient's get the quiet right-hand treatment — the inverse of a chat
 * app, and deliberately: here the thing worth re-reading is what was said *to*
 * them.
 */
const Turn: FC<{ utterance: Utterance }> = function Turn({ utterance }) {
  const { themed } = useAppTheme()
  const mine = utterance.from === "you"

  return (
    <View style={[themed($turn), mine && $turnMine]}>
      {!mine ? (
        <Text preset="formHelper" text={utterance.speaker} style={themed($speaker)} />
      ) : null}
      <View style={[themed($bubble), mine ? themed($bubbleMine) : themed($bubbleTheirs)]}>
        <Text
          preset="default"
          text={utterance.text}
          style={[themed($turnText), utterance.partial && themed($partial)]}
        />
      </View>
    </View>
  )
}

const ControlButton: FC<{
  icon: "close" | "message" | "careTeam"
  label: string
  active?: boolean
  onPress: () => void
}> = function ControlButton({ icon, label, active, onPress }) {
  const { themed, theme } = useAppTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        themed($control),
        active && themed($controlActive),
        pressed && { opacity: 0.85 },
      ]}
    >
      <Glyph
        name={icon}
        size={20}
        color={active ? theme.colors.palette.neutral100 : theme.colors.text}
      />
      <Text
        preset="formHelper"
        text={label}
        style={[themed($controlLabel), active && themed($controlLabelActive)]}
      />
    </Pressable>
  )
}

/** What the line under the name says, in each state. */
function statusLine(state: CallState, seconds: number): string {
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  switch (state) {
    case "connecting":
      return "Connecting…"
    case "escalating":
      return "Getting someone from the unit — stay on the line"
    case "with-human":
      return `${PROVIDER.from} · ${clock}`
    case "ended":
      return `Call ended · ${clock}`
    case "failed":
      return "The call could not connect"
    default:
      return `${PROVIDER.from} · ${clock}`
  }
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.md,
  paddingBottom: spacing.md,
  gap: spacing.sm,
})

const $head: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingBottom: spacing.sm,
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $headBody: ViewStyle = { flex: 1, gap: 2 }

const $who: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $status: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $dot: ThemedStyle<ViewStyle> = () => ({ width: 8, height: 8 })

const $handover: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  backgroundColor: colors.askedBackground,
  padding: spacing.sm,
})

const $handoverText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

const $transcript: ViewStyle = { flex: 1 }

const $transcriptBody: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.sm,
  paddingVertical: spacing.sm,
})

const $turn: ThemedStyle<ViewStyle> = () => ({ maxWidth: "90%", gap: 2 })

const $turnMine: ViewStyle = { alignSelf: "flex-end", alignItems: "flex-end" }

const $speaker: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $bubble: ThemedStyle<ViewStyle> = ({ spacing }) => ({ padding: spacing.sm })

const $bubbleTheirs: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.palette.neutral200,
  borderWidth: 1,
  borderColor: colors.separator,
})

const $bubbleMine: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.askedBackground,
})

const $turnText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

/* A partial turn is still being said. Dimmed, because it may yet change. */
const $partial: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $controls: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.sm })

const $controlRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.sm,
})

const $control: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  minHeight: 52,
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  paddingVertical: spacing.xs,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.palette.neutral200,
})

const $controlActive: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint,
  borderColor: colors.tint,
})

const $controlLabel: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $controlLabelActive: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.palette.neutral100,
})
