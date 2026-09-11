import { FC, useState } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { Chip, Panel } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { OPEN_REQUESTS, PROVIDER } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * Answering one request.
 *
 * Presented as a sheet, which is GoodRx's arrangement for every secondary flow
 * and the right one here: a close ✕ at the top right, a large title, one line of
 * context, and the action pinned to the bottom edge under the thumb. A patient
 * who opened this by accident closes it with the gesture they already use.
 *
 * **Why is on the screen, not behind a link.** The card on the home screen says
 * what; this says why, in the clinic's own words, because a person deciding
 * whether to spend a morning at a lab is entitled to the reason. It is the
 * recommendation the care path was compiled from, said in one sentence.
 *
 * **Declining is a real answer, not a failure.** `declined` sits beside
 * `fulfilled` in the catalogue, and a patient who cannot go this week should be
 * able to say so and have the clinic know. What is refused here is *silence* —
 * which is `expired`, and helps nobody.
 *
 * The camera is simulated. `expo-image-picker` is the real one and changes only
 * `attach()`; nothing else on this screen would move.
 */
interface RequestDetailScreenProps extends AppStackScreenProps<"RequestDetail"> {}

export const RequestDetailScreen: FC<RequestDetailScreenProps> = function RequestDetailScreen({
  route,
  navigation,
}) {
  const { themed, theme } = useAppTheme()
  const request = OPEN_REQUESTS.find((r) => r.id === route.params.requestId) ?? OPEN_REQUESTS[0]

  const [attachments, setAttachments] = useState<string[]>([])
  const [outcome, setOutcome] = useState<"open" | "fulfilled" | "declined">("open")

  function attach(from: "camera" | "files") {
    setAttachments((a) => [
      ...a,
      from === "camera" ? `Photo ${a.length + 1}` : `File ${a.length + 1}`,
    ])
  }

  if (outcome !== "open") {
    return <Answered outcome={outcome} onDone={() => navigation.goBack()} />
  }

  return (
    <Screen
      preset="scroll"
      contentContainerStyle={themed($container)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($sheetHead)}>
        <Chip
          tone={request.daysLeft <= 1 ? "expiring" : "neutral"}
          text={request.daysLeft === 1 ? "Last day" : `${request.daysLeft} days left`}
        />
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Glyph name="close" size={22} color={theme.colors.textDim} />
        </Pressable>
      </View>

      <View style={themed($intro)}>
        <Text preset="heading" text={request.what} style={themed($title)} />
        <Text preset="default" text={request.instructions} style={themed($subtitle)} />
      </View>

      <Panel accent={theme.colors.asked}>
        <Text preset="formHelper" text="WHY WE ASKED" style={themed($label)} />
        <Text preset="default" text={request.because} style={themed($body)} />
        <Text preset="formHelper" text={`Asked by ${request.from}`} style={themed($subtitle)} />
      </Panel>

      {attachments.length > 0 && (
        <Panel>
          <Text preset="formHelper" text="READY TO SEND" style={themed($label)} />
          {attachments.map((a) => (
            <View key={a} style={themed($attachment)}>
              <Glyph name="reports" size={18} color={theme.colors.textDim} />
              <Text preset="default" text={a} style={themed($attachmentName)} />
              {/* Removing before sending is the only edit a patient gets; after
                  it is sent, the clinic has it and pretending otherwise lies. */}
              <Pressable
                onPress={() => setAttachments((list) => list.filter((x) => x !== a))}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${a}`}
                hitSlop={10}
              >
                <Glyph name="close" size={16} color={theme.colors.textDim} />
              </Pressable>
            </View>
          ))}
        </Panel>
      )}

      <View style={themed($actions)}>
        {request.kind === "document" ? (
          <>
            <PillButton
              text="Take a photo"
              onPress={() => attach("camera")}
              icon={<Glyph name="camera" size={18} color={theme.colors.palette.neutral100} />}
            />
            <PillButton
              text="Choose from my phone"
              variant="secondary"
              onPress={() => attach("files")}
            />
            {attachments.length > 0 && (
              <PillButton
                text={`Send ${attachments.length === 1 ? "it" : `all ${attachments.length}`} to ${PROVIDER.name.split(" ")[0]}`}
                onPress={() => setOutcome("fulfilled")}
              />
            )}
          </>
        ) : request.kind === "measurement" ? (
          /**
           * A reading is typed, not answered.
           *
           * This shared the `questions` branch, so a spirometry reading offered
           * "Answer the three questions" — and there is no question, there is a
           * number on a device in the patient's hand.
           */
          <PillButton text="Enter your reading" onPress={() => setOutcome("fulfilled")} />
        ) : (
          /* It opens the questionnaire now. This marked the request fulfilled
             and asked nothing — a task the app set and then blocked.

             No count in the label: the card already says how many, and a number
             written in two places drifts the first time a questionnaire changes
             — it had, the card said six and this said three. */
          <PillButton
            text="Answer the questions"
            onPress={() => navigation.navigate("Questionnaire", { requestId: request.id })}
          />
        )}

        <PillButton
          text="I cannot do this — tell the clinic"
          variant="destructive"
          onPress={() => setOutcome("declined")}
        />
      </View>
    </Screen>
  )
}

/**
 * What happened, and what happens next.
 *
 * Both outcomes get the same treatment and neither is scolded. A decline is
 * routed to a person, and saying so is the difference between a patient who
 * declined and a patient who now thinks nobody knows.
 */
const Answered: FC<{ outcome: "fulfilled" | "declined"; onDone: () => void }> = function Answered({
  outcome,
  onDone,
}) {
  const { themed, theme } = useAppTheme()
  const done = outcome === "fulfilled"

  return (
    <Screen
      preset="fixed"
      contentContainerStyle={themed($answered)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($answeredBody)}>
        <Glyph
          name={done ? "check" : "message"}
          size={40}
          color={done ? theme.colors.done : theme.colors.asked}
        />
        <Text
          preset="heading"
          text={done ? `Sent to ${PROVIDER.name.split(" ")[0]}` : "We have told the unit"}
          style={themed($title)}
        />
        <Text
          preset="default"
          text={
            done
              ? "Your transplant coordinator sees this today. If anything needs doing, they will ring you — you do not need to chase it."
              : "Sister Lakshmi will see this and get in touch to sort out another time. Nothing is marked against you."
          }
          style={themed($answeredText)}
        />
      </View>
      <PillButton text="Done" onPress={onDone} />
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.md,
  paddingBottom: spacing.lg,
  gap: spacing.md,
})

const $sheetHead: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
})

const $intro: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xs })

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  letterSpacing: 0.8,
})

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $attachment: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingVertical: spacing.xs,
})

const $attachmentName: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

/* Pinned to the bottom edge: the answer should be under the thumb however long
   the reason above it runs. */
const $actions: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.sm, marginTop: "auto" })

const $answered: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingBottom: spacing.lg,
})

const $answeredBody: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  justifyContent: "center",
  gap: spacing.sm,
})

const $answeredText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })
