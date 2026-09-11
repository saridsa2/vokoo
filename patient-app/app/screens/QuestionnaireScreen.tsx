import { FC, useState } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { PROVIDER, QUESTIONS, SEVERITY, type SymptomQuestion } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * The weekly questionnaire, which until now could not be answered.
 *
 * `RequestDetailScreen` branched on `document` and `measurement` and fell
 * through to a button reading "Answer the questions" that set the request to
 * fulfilled and asked nothing. The care path could send a questionnaire, the
 * home screen could show it as due, and there was no screen behind it — a task
 * the app sets and then blocks.
 *
 * ## One question per screen
 *
 * Six questions on one scrolling page is a form, and a form is what a patient
 * abandons. One at a time with the answers as large targets is the pattern
 * every clinical PROM instrument uses on paper and every good health app uses
 * on a phone — and it means the progress is visible, so somebody who has
 * answered four knows two remain.
 *
 * ## The scale is words, and the words are the instrument's
 *
 * Five options, "Not at all" to "Severe", because that is the scale the answers
 * are scored on — 0 to 4 — and a patient should never be asked to translate
 * their week into a number. The number exists for the chart and the clinician;
 * the words exist for the person answering.
 *
 * ## Answering advances; there is no Next
 *
 * Tapping an answer moves to the next question. A separate Next button makes
 * every question two taps and adds nothing — the answer *is* the decision. Back
 * is available because a misread question is common and an unfixable one is
 * worse than a slow form.
 */
interface QuestionnaireScreenProps extends AppStackScreenProps<"Questionnaire"> {}

export const QuestionnaireScreen: FC<QuestionnaireScreenProps> = function QuestionnaireScreen({
  navigation,
}) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [index, setIndex] = useState(0)
  const [sent, setSent] = useState(false)

  const question: SymptomQuestion | undefined = QUESTIONS[index]
  const answered = Object.keys(answers).length

  function answer(score: number) {
    if (!question) return
    setAnswers((a) => ({ ...a, [question.key]: score }))
    /* Straight on. The last answer lands on the summary rather than a seventh
       empty question. */
    setIndex((i) => i + 1)
  }

  if (sent) return <Sent onDone={() => navigation.goBack()} />

  /* Past the last question: what was answered, before it goes anywhere. */
  if (!question) {
    return (
      <Screen preset="scroll" contentContainerStyle={themed($container)} safeAreaEdges={["top", "bottom"]}>
        <Close onPress={() => navigation.goBack()} />

        <Text preset="heading" text="Before you send this" style={themed($title)} />

        {/**
         * Shown as words, not scores.
         *
         * The patient answered "A little"; showing them a 1 would be the app
         * translating their week into a number and then asking them to check
         * its arithmetic. The number never appears on this side of the screen.
         */}
        <View style={themed($review)}>
          {QUESTIONS.map((q) => (
            <Pressable
              key={q.key}
              style={themed($reviewRow)}
              onPress={() => setIndex(QUESTIONS.indexOf(q))}
              accessibilityRole="button"
              accessibilityLabel={`${q.short}, ${SEVERITY[answers[q.key] ?? 0]}. Change`}
            >
              <Text preset="formLabel" text={q.short} style={themed($reviewName)} />
              <Text
                preset="default"
                text={SEVERITY[answers[q.key] ?? 0]}
                style={themed($reviewValue)}
              />
              <Glyph name="chevronRight" size={16} color={colors.textDim} />
            </Pressable>
          ))}
        </View>

        <PillButton text={`Send to ${PROVIDER.name.split(" ")[0]}`} onPress={() => setSent(true)} />
        <PillButton text="Back" variant="quiet" onPress={() => setIndex(QUESTIONS.length - 1)} />
      </Screen>
    )
  }

  return (
    <Screen preset="fixed" contentContainerStyle={themed($container)} safeAreaEdges={["top", "bottom"]}>
      <Close onPress={() => navigation.goBack()} />

      {/* Which of six, as a bar rather than "3 of 6". A patient part-way
          through wants to know how much is left, and a length answers that
          without being read. */}
      <View style={themed($track)}>
        <View
          style={[
            themed($fill),
            { width: `${((index + 1) / QUESTIONS.length) * 100}%` },
          ]}
        />
      </View>

      <View style={themed($body)}>
        <Text preset="heading" text={question.text} style={themed($question)} />
        {question.help ? (
          <Text preset="formHelper" text={question.help} style={themed($help)} />
        ) : null}

        <View style={themed($options)}>
          {SEVERITY.map((label, score) => {
            const chosen = answers[question.key] === score
            return (
              <Pressable
                key={label}
                onPress={() => answer(score)}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                style={[themed($option), chosen ? themed($optionChosen) : null]}
              >
                <Text
                  preset={chosen ? "bold" : "default"}
                  text={label}
                  style={[themed($optionText), chosen ? { color: colors.asked } : null]}
                />
                {chosen ? <Glyph name="check" size={18} color={colors.asked} /> : null}
              </Pressable>
            )
          })}
        </View>
      </View>

      {index > 0 ? (
        <PillButton text="Back" variant="quiet" onPress={() => setIndex((i) => i - 1)} />
      ) : null}

      {/* Only once something has been answered — before that it would be a
          control that discards nothing. */}
      {answered > 0 && index === 0 ? null : null}
    </Screen>
  )
}

const Close: FC<{ onPress: () => void }> = function Close({ onPress }) {
  const { themed, theme } = useAppTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={themed($close)}
    >
      <Glyph name="close" size={18} color={theme.colors.text} />
    </Pressable>
  )
}

/**
 * The end, and it says who has it now.
 *
 * "Thank you" would say nothing. What a patient needs to know is that it left
 * the phone, who reads it, and that nothing further is expected of them.
 */
const Sent: FC<{ onDone: () => void }> = function Sent({ onDone }) {
  const { themed, theme } = useAppTheme()
  return (
    <Screen preset="fixed" contentContainerStyle={themed($container)} safeAreaEdges={["top", "bottom"]}>
      <View style={themed($sentBody)}>
        <Glyph name="check" size={36} color={theme.colors.done} />
        <Text preset="heading" text={`Sent to ${PROVIDER.name}`} style={themed($title)} />
        <Text
          preset="default"
          text="Your team reads these alongside your morning readings. Nothing else to do — they will be in touch if anything needs a closer look."
          style={themed($help)}
        />
      </View>
      <PillButton text="Done" onPress={onDone} />
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingBottom: spacing.lg,
  gap: spacing.md,
})

const $close: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  width: 34,
  height: 34,
  alignItems: "center",
  justifyContent: "center",
  alignSelf: "flex-end",
  marginTop: spacing.sm,
  backgroundColor: colors.palette.neutral300,
})

const $track: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 4,
  backgroundColor: colors.palette.neutral400,
})

const $fill: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 4,
  backgroundColor: colors.asked,
})

const $body: ThemedStyle<ViewStyle> = ({ spacing }) => ({ flex: 1, gap: spacing.sm })

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $question: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $help: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $options: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xs, marginTop: spacing.sm })

/* Full width and tall. These are the only targets on the screen and the person
   pressing them may have a tremor, be on a moving bus, or be very tired. */
const $option: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: 56,
  paddingHorizontal: spacing.md,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.palette.neutral200,
})

const $optionChosen: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderColor: colors.asked,
  backgroundColor: colors.askedBackground,
})

const $optionText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $review: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderTopWidth: 1,
  borderTopColor: colors.separator,
})

const $reviewRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingVertical: spacing.sm,
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $reviewName: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

const $reviewValue: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $sentBody: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  justifyContent: "center",
  gap: spacing.sm,
})
