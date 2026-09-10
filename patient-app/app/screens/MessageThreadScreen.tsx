import { useState } from "react"
import { Pressable, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { useNavigation } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { Glyph } from "@/components/Glyph"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import type { AppStackParamList } from "@/navigators/navigationTypes"
import { PROVIDER, THREAD, type Message } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * Talking to Sarv, and to a person when Sarv hands over.
 *
 * **Rebuilt when it became a tab.** It was written as a sheet — a header with a
 * close button, and a composer held down by `marginTop: "auto"` inside a
 * ScrollView, which pins nothing. As a sheet that was survivable. As the centre
 * tab it meant there was **no way to type at all**: the composer sat below the
 * fold of a scroll nobody would think to scroll. The layout is now three fixed
 * parts — header, scrolling thread, pinned composer — which is what a
 * conversation always needed.
 *
 * **One thread and three senders.** Sarv answers immediately and around the
 * clock; a coordinator takes over when Sarv decides it should not answer. The
 * patient never picks a recipient — picking means picking wrongly and waiting on
 * somebody who is off that week — and the voice path already works this way.
 *
 * **The handover is drawn, not implied.** A rule across the thread saying who
 * has it now. Letting a coordinator's reply appear in Sarv's colours would be
 * the one deception this product cannot afford: a patient must always know
 * whether the sentence in front of them came from a person.
 */
export function MessageThreadScreen() {
  const { themed, theme } = useAppTheme()
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>()

  const [draft, setDraft] = useState("")
  const [messages, setMessages] = useState<Message[]>(THREAD)
  const [pending, setPending] = useState<{ name: string; pages?: number }[]>([])

  /* Who has the conversation now — the last sender who was not the patient. It
     decides the header, the placeholder, and what to expect back. */
  const holder = [...messages].reverse().find((m) => m.from !== "you")?.from ?? "agent"
  const withHuman = holder === "human"

  /* Offered by whatever was said last, and only while it is still last. */
  const last = messages[messages.length - 1]
  const offered = last?.from !== "you" ? last?.replies : undefined

  function attach() {
    setPending((a) => [...a, { name: `Photo ${a.length + 1}`, pages: 1 }])
  }

  function send(text?: string) {
    const body = (text ?? draft).trim()
    if (!body && pending.length === 0) return
    setMessages((m) => [
      ...m,
      {
        id: `msg-${m.length + 1}`,
        from: "you",
        author: "You",
        at: "Just now",
        body: body || (pending.length === 1 ? "Here is the report." : "Here are the reports."),
        attachment: pending[0],
      },
    ])
    setDraft("")
    setPending([])
  }

  return (
    <Screen preset="fixed" contentContainerStyle={themed($container)} safeAreaEdges={["top"]}>
      {/* Sarv, not the hospital. This is the tab for talking to the agent, and
          heading it with the provider's name told the patient they were writing
          to a building. The unit's name belongs on what the unit asks for. */}
      <View style={themed($head)}>
        <View style={$headBody}>
          <Text
            preset="subheading"
            text={withHuman ? "Sister Lakshmi" : "Sarv"}
            style={themed($title)}
          />
          <Text
            preset="formHelper"
            text={
              withHuman
                ? `${PROVIDER.from} · replies in clinic hours`
                : "Answers straight away · fetches a person when it should"
            }
            style={themed($subtitle)}
          />
        </View>
        {/* Voice, one tap from the conversation. Somebody too breathless to type
            should not have to find a different screen to say so. */}
        <Pressable
          onPress={() => navigation.navigate("Call")}
          accessibilityRole="button"
          accessibilityLabel="Call Sarv"
          style={({ pressed }) => [themed($callButton), pressed && { opacity: 0.85 }]}
        >
          <Glyph name="phone" size={20} color={theme.colors.palette.neutral100} />
        </Pressable>
      </View>

      <ScrollView
        style={$thread}
        contentContainerStyle={themed($threadBody)}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message, i) => (
          <View key={message.id}>
            {/* A timestamp only where the run breaks. One under every line put
                the clock in competition with the words. */}
            <Bubble message={message} showTime={messages[i + 1]?.at !== message.at} />
            {message.handover ? <Handover /> : null}
          </View>
        ))}
      </ScrollView>

      <View style={themed($composer)}>
        {offered ? (
          <View style={themed($replies)}>
            {offered.map((reply) => (
              <Pressable
                key={reply}
                onPress={() => send(reply)}
                accessibilityRole="button"
                style={({ pressed }) => [themed($reply), pressed && { opacity: 0.85 }]}
              >
                <Text preset="formHelper" text={reply} style={themed($replyText)} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {pending.map((file, i) => (
          <View key={file.name} style={themed($pending)}>
            <Glyph name="reports" size={16} color={theme.colors.textDim} />
            <Text preset="formHelper" text={file.name} style={themed($pendingName)} />
            <Pressable
              onPress={() => setPending((a) => a.filter((_, j) => j !== i))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${file.name}`}
              hitSlop={10}
            >
              <Glyph name="close" size={14} color={theme.colors.textDim} />
            </Pressable>
          </View>
        ))}

        <View style={themed($composerRow)}>
          <Pressable
            onPress={attach}
            accessibilityRole="button"
            accessibilityLabel="Attach a report"
            style={({ pressed }) => [themed($square), pressed && { opacity: 0.85 }]}
          >
            <Glyph name="attach" size={20} color={theme.colors.text} />
          </Pressable>

          <View style={$field}>
            <TextField
              value={draft}
              onChangeText={setDraft}
              placeholder={withHuman ? "Write to Sister Lakshmi" : "Ask Sarv"}
              multiline
            />
          </View>

          <Pressable
            onPress={() => send()}
            disabled={!draft.trim() && pending.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => [
              themed($square),
              (draft.trim() || pending.length > 0) && themed($squareActive),
              pressed && { opacity: 0.85 },
            ]}
          >
            <Glyph
              name="send"
              size={20}
              color={
                draft.trim() || pending.length
                  ? theme.colors.palette.neutral100
                  : theme.colors.palette.neutral500
              }
            />
          </Pressable>
        </View>
      </View>
    </Screen>
  )
}

/** The rule that says the conversation changed hands. */
function Handover() {
  const { themed, theme } = useAppTheme()
  return (
    <View style={themed($handover)}>
      <View style={themed($rule)} />
      <View style={themed($handoverLabel)}>
        <Glyph name="careTeam" size={14} color={theme.colors.asked} />
        <Text preset="formHelper" text="Passed to the unit" style={themed($handoverText)} />
      </View>
      <View style={themed($rule)} />
    </View>
  )
}

/**
 * A message.
 *
 * Three senders, three treatments: the patient's sit right in the asked-blue,
 * Sarv's sit left on the card ground, and a person's take the ink left border —
 * the same rule the node cards follow, that an element belonging to something
 * takes its colour. Side and weight, never colour alone, so the thread is
 * readable to someone who cannot separate two hues.
 */
function Bubble({ message, showTime }: { message: Message; showTime: boolean }) {
  const { themed, theme } = useAppTheme()
  const mine = message.from === "you"
  const human = message.from === "human"

  return (
    <View style={[themed($bubbleRow), mine && $mineRow]}>
      <View
        style={[
          themed($bubble),
          mine ? themed($mine) : themed($theirs),
          human && [$humanEdge, { borderLeftColor: theme.colors.asked }],
        ]}
      >
        {!mine && (
          <View style={themed($authorRow)}>
            <Glyph name={human ? "careTeam" : "message"} size={13} color={theme.colors.textDim} />
            <Text preset="formHelper" text={message.author} style={themed($author)} />
          </View>
        )}
        <Text preset="default" text={message.body} style={themed($body)} />

        {message.attachment ? (
          <View style={themed($attachment)}>
            <Glyph name="reports" size={18} color={theme.colors.textDim} />
            <View style={$attachmentBody}>
              <Text preset="formHelper" text={message.attachment.name} style={themed($body)} />
              {message.attachment.pages ? (
                <Text
                  preset="formHelper"
                  text={`${message.attachment.pages} page${message.attachment.pages === 1 ? "" : "s"} · sent`}
                  style={themed($at)}
                />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
      {showTime ? <Text preset="formHelper" text={message.at} style={themed($at)} /> : null}
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.sm,
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

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $callButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 44,
  height: 44,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.tint,
})

const $thread: ViewStyle = { flex: 1 }

const $threadBody: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.md,
  paddingVertical: spacing.sm,
})

const $bubbleRow: ThemedStyle<ViewStyle> = () => ({
  alignItems: "flex-start",
  gap: 2,
  maxWidth: "92%",
})

const $mineRow: ViewStyle = { alignSelf: "flex-end", alignItems: "flex-end" }

const $bubble: ThemedStyle<ViewStyle> = ({ spacing }) => ({ padding: spacing.sm, gap: 4 })

const $theirs: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.palette.neutral200,
  borderWidth: 1,
  borderColor: colors.separator,
})

const $mine: ThemedStyle<ViewStyle> = ({ colors }) => ({ backgroundColor: colors.askedBackground })

const $humanEdge: ViewStyle = { borderLeftWidth: 3 }

const $authorRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
})

const $author: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

/* Small and dim. A timestamp is a footnote, not a line of the conversation. */
const $at: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, fontSize: 11 })

const $attachment: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginTop: spacing.xxs,
  padding: spacing.xs,
  backgroundColor: colors.background,
  borderWidth: 1,
  borderColor: colors.separator,
})

const $attachmentBody: ViewStyle = { flex: 1 }

const $handover: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginTop: spacing.md,
})

const $rule: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  height: 1,
  backgroundColor: colors.separator,
})

const $handoverLabel: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
})

const $handoverText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.asked })

const $composer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.xs,
  paddingBottom: spacing.sm,
})

const $replies: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
})

const $reply: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  borderWidth: 1,
  borderColor: colors.asked,
  backgroundColor: colors.askedBackground,
})

const $replyText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.asked })

const $pending: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  padding: spacing.xs,
  backgroundColor: colors.palette.neutral300,
  borderWidth: 1,
  borderColor: colors.separator,
})

const $pendingName: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

const $composerRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "flex-end",
  gap: spacing.xs,
})

const $field: ViewStyle = { flex: 1 }

const $square: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 48,
  height: 48,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.palette.neutral200,
})

const $squareActive: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint,
  borderColor: colors.tint,
})
