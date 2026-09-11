import { FC, useState } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Panel } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useModel } from "@/services/intelligence/provider"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * A bench for the on-device model. Not a patient screen.
 *
 * ## Why it exists and why it is not in the navigation
 *
 * The model runtime is linked into the binary and the capability gate decides
 * whether to load it, and until something calls `sendMessage` neither of those
 * claims has been tested on a real phone. A claim about inference that has
 * never run is worth nothing — this project has a whole section in its notes
 * about exactly that failure.
 *
 * So this is reachable by deep link and by nothing else. It is not a tab, not a
 * row in a menu and not behind a long-press, because a patient six weeks out of
 * a transplant has no use for a prompt box and every reason to be confused by
 * one.
 *
 *     adb shell am start -W -a android.intent.action.VIEW \
 *       -d "sarvathra://local-model" ai.sarvathra.patient
 *
 * ## What it shows, in the order it matters
 *
 * The gate's verdict first — the phone's own memory and what was decided from
 * it — because if that says no, nothing below it will ever run and the reason
 * is the answer. Then the download, which is roughly a gigabyte on first use
 * and needs to be visible or it looks like a hang. Then the prompt.
 */
interface LocalModelScreenProps extends AppStackScreenProps<"LocalModel"> {}

export const LocalModelScreen: FC<LocalModelScreenProps> = function LocalModelScreen() {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const model = useModel()
  const [out, setOut] = useState("")
  const [prompt, setPrompt] = useState(
    "I've been coughing at night and my chest feels tight. I couldn't sleep.",
  )

  const percent = Math.round(model.progress * 100)

  return (
    <Screen preset="scroll" contentContainerStyle={themed($container)} safeAreaEdges={["top"]}>
      <Text preset="heading" text="On-device model" style={themed($title)} />

      <Panel>
        <Row name="State" value={model.state} />
        <Row name="Why" value={model.reason ?? "…"} wrap />
        <Row name="Fetch" value={percent > 0 ? `${percent}%` : "—"} last />
      </Panel>

      <TextField
        value={prompt}
        onChangeText={setPrompt}
        label="Prompt"
        multiline
        helper="Nothing typed here leaves the phone."
      />

      <PillButton
        text={model.state === "ready" ? "Run on device" : "Not available"}
        disabled={model.state !== "ready"}
        onPress={() => {
          /* Straight `generate`: a bench that accumulates conversation state
             gives a different answer to the same prompt on the second press. */
          model.ask(prompt).then((r) => setOut(r.card ? `${r.text}\n\n[card: ${r.card.kind}]` : r.text), (e: unknown) => setOut(String(e)))
        }}
      />

      {out ? (
        <Panel>
          <Text preset="formHelper" text="RESPONSE" style={themed($label)} />
          {/* No inner ScrollView. It was a capped 300pt scroller inside a
              scrolling Screen — two scrollers competing for the same gesture,
              so the response clipped and could not be dragged. The page
              scrolls; the text just grows. */}
          <Text preset="default" text={out} style={{ color: colors.text }} />
        </Panel>
      ) : null}
    </Screen>
  )
}

const Row: FC<{ name: string; value: string; wrap?: boolean; last?: boolean }> = function Row({
  name,
  value,
  wrap,
  last,
}) {
  const { themed } = useAppTheme()
  return (
    <View style={[themed($row), last ? null : themed($ruled)]}>
      <Text preset="formLabel" text={name} style={themed($name)} />
      <Text
        preset="default"
        text={value}
        style={themed($value)}
        numberOfLines={wrap ? undefined : 1}
      />
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.lg,
  gap: spacing.md,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 11,
  letterSpacing: 0.6,
})

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "flex-start",
  gap: spacing.sm,
  paddingVertical: spacing.xs,
})

const $ruled: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $name: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, width: 76 })

const $value: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })
