import { FC, useState } from "react"
import { LayoutChangeEvent, TextStyle, View, ViewStyle } from "react-native"
import { RadarChart } from "@chart-kit/pro"

import { Glyph } from "@/components/Glyph"
import { Panel } from "@/components/Panel"
import { Text } from "@/components/Text"
import { SYMPTOM_MAX, SYMPTOMS, type SymptomDomain } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * How the patient has been, across the six domains the weekly request asks
 * about — on Chart Kit Pro's `RadarChart`.
 *
 * ## Why a radar here and nowhere else in this app
 *
 * Every other measurement in Sarvathra is one quantity over time, and time is
 * the reason a line or a bar is right for those: both put time on a straight
 * axis, which is how people read it.
 *
 * This is the opposite shape of data — **six unrelated domains at one moment**.
 * There is no ordering among breathlessness, cough, temperature, swelling,
 * weight and tiredness; putting them on an x axis would invent one, and the
 * reader would look for a trend that does not exist. A radar has no first and
 * no last, which is exactly the claim to make about six things measured at
 * once. Patient-reported outcome profiles are drawn this way in the literature
 * for the same reason.
 *
 * ## Two weeks on the same axes
 *
 * A single profile says nothing — a patient cannot tell whether a 2 for cough
 * is their normal. What a transplant unit asks at clinic is whether the shape
 * has *grown*, so last week is drawn underneath in the same rings. The
 * comparison is the point; the absolute scores are not.
 *
 * ## The shape shrinks when things improve
 *
 * These are severities: 0 is none and 4 is severe, so a well week is a small
 * shape near the centre. That is the opposite of a fitness app, where a big
 * shape is a good one, and it is right here — a clinician reads severity, and
 * inverting the scores into a wellness figure would put the app's own
 * arithmetic between the patient's answer and the person reading it.
 */
export interface SymptomProfileProps {
  domains?: SymptomDomain[]
}

/**
 * This week's shape takes the verdict's own colour.
 *
 * It was fixed green while the headline above it read "Worse than last week" in
 * amber — and green means *settled* everywhere else in this app. The card made
 * two claims at once and the louder one was the wrong one.
 *
 * The shape is the evidence for the sentence, so it wears the sentence's
 * colour: green when nothing has moved, amber when it has.
 */
const SETTLED = "#2f7d4f"
const WORSE = "#D9822B"
/** Last week, underneath. Neutral: it is context, not a second answer. */
const BEFORE = "#B9B4AD"

type Row = {
  domain: string
  thisWeek: number
  lastWeek: number
}

export const SymptomProfile: FC<SymptomProfileProps> = function SymptomProfile({
  domains = SYMPTOMS,
}) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const [width, setWidth] = useState(0)
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }

  const data: Row[] = domains.map((d) => ({
    domain: d.domain,
    thisWeek: d.thisWeek,
    lastWeek: d.lastWeek,
  }))

  /**
   * Which domains got worse, and by how many steps.
   *
   * The chart shows the shape; this is the sentence a patient would have to
   * derive from it by comparing six pairs of points by eye. One step is
   * ordinary week-to-week variation, so only a rise is counted — and the
   * verdict names the domains rather than a total, because "two worse" tells
   * nobody which two.
   */
  const worse = domains.filter((d) => d.thisWeek > d.lastWeek)
  const bad = worse.filter((d) => d.thisWeek - d.lastWeek >= 2)

  const verdict = bad.length > 0 ? "Worse than last week" : worse.length > 0 ? "Slightly worse" : "About the same"
  const settled = bad.length === 0
  const now = settled ? SETTLED : WORSE

  return (
    <Panel accent={settled ? colors.done : colors.expiring}>
      <Text preset="formHelper" text="HOW YOU HAVE BEEN · THIS WEEK" style={themed($label)} />

      <View style={$verdictRow}>
        <Glyph
          name={settled ? "check" : "close"}
          size={20}
          color={settled ? colors.done : colors.expiring}
        />
        <Text
          preset="heading"
          text={verdict}
          style={[themed($verdict), { color: settled ? colors.done : colors.expiring }]}
        />
      </View>

      {worse.length > 0 ? (
        <Text
          preset="formHelper"
          text={worse.map((d) => d.domain.toLowerCase()).join(", ")}
          style={themed($sub)}
        />
      ) : null}

      <View onLayout={onLayout} style={$plot}>
        {width > 0 ? (
          <RadarChart<Row>
            data={data}
            categoryKey="domain"
            width={width}
            /* Square: a radar in a wide box is an ellipse, and an ellipse makes
               the domains on its long axis look worse than the ones on its
               short axis for the same score. */
            height={width}
            maxValue={SYMPTOM_MAX}
            series={[
              { valueKey: "lastWeek", label: "Last week", color: BEFORE },
              { valueKey: "thisWeek", label: "This week", color: now },
            ]}
          />
        ) : null}
      </View>

      {/* A key, because two overlaid shapes in one chart cannot name themselves
          and this is the one chart in the app with more than one series. */}
      <View style={$keys}>
        <Key colour={now} text="This week" />
        <Key colour={BEFORE} text="Last week" />
      </View>
    </Panel>
  )
}

const Key: FC<{ colour: string; text: string }> = function Key({ colour, text }) {
  const { themed } = useAppTheme()
  return (
    <View style={$key}>
      <View style={[$swatch, { backgroundColor: colour }]} />
      <Text preset="formHelper" text={text} style={themed($sub)} />
    </View>
  )
}

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 11,
  lineHeight: 14,
  letterSpacing: 0.6,
})

const $verdictRow: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8 }

const $verdict: ThemedStyle<TextStyle> = () => ({ fontSize: 24, lineHeight: 29 })

const $sub: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $plot: ViewStyle = { marginTop: 4 }

const $keys: ViewStyle = { flexDirection: "row", gap: 16, marginTop: 4 }

const $key: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 6 }

/* Square, like every other control and mark in this app. */
const $swatch: ViewStyle = { width: 10, height: 10 }
