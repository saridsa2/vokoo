import { FC, useState } from "react"
import { LayoutChangeEvent, TextStyle, View, ViewStyle } from "react-native"
import Svg, { Rect } from "react-native-svg"

import { Glyph } from "@/components/Glyph"
import { Text } from "@/components/Text"
import type { HomeSeries } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * A blood level against the range it has to sit in — as results, not a chart.
 *
 * ## Why there is no chart here
 *
 * There were five dots on a time axis, and no patient reads that. It asked them
 * to find a dot, hold its height against a shaded band, and infer a verdict —
 * three steps, on a screen opened at seven in the morning, by someone six weeks
 * out of a transplant. Among patients referred for transplant, limited numeracy
 * runs at 42.8%: the arithmetic a chart delegates is arithmetic half of them
 * will not do.
 *
 * The trend across six blood tests is a clinician's question, and a clinician
 * has the lab system. The patient's question is **"am I where they want me"**,
 * and it has a one-word answer.
 *
 * So the card is the verdict and the number it came from. A list of every past
 * test was here too and is gone: the patient's question is about today, and the
 * history is the clinician's.
 */
export interface MedicineLevelProps {
  series: HomeSeries
  /** Reports the verdict up, so the card's rail can match it. See the ribbon. */
  onVerdict?: (settled: boolean) => void
}

export const MedicineLevel: FC<MedicineLevelProps> = function MedicineLevel({
  series,
  onVerdict,
}) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const [width, setWidth] = useState(0)
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }

  const band = series.band
  if (!band) return null

  const dp = series.decimals ?? 1
  const show = (v: number) =>
    v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })

  const inBand = (v: number) => v >= band.low && v <= band.high

  /* Newest at the top. A patient scans down from the most recent, and the
     oldest test is the one they care least about. */
  const tests = [...series.readings].reverse()
  const latest = tests[0]
  const good = inBand(latest.value)

  /* One word each way. It sits where the reading's own figure would, so it has
     to be short enough to be that — a sentence there is a headline that has to
     be read rather than seen. */
  const verdict = good ? "In range" : latest.value > band.high ? "Too high" : "Too low"
  onVerdict?.(good)

  /* Zero to a little above the highest thing on the chart. A bar has to start
     at the floor or its height stops meaning the value. */
  const top = Math.max(band.high, ...series.readings.map((r) => r.value)) * 1.08
  const y = (v: number) => CHART_H - FLOOR - (v / top) * (CHART_H - FLOOR)

  return (
    <View style={themed($wrap)}>
      <Text
        preset="formHelper"
        text={
          series.clinicalName
            ? `${series.title.toUpperCase()} · ${series.clinicalName}`
            : series.title.toUpperCase()
        }
        style={themed($label)}
        numberOfLines={2}
      />

      {/* The verdict first, at the size of the thing that matters. The number
          it came from follows, because a clinician on the phone will ask for
          the number and the patient has to be able to read it back. */}
      <View style={$verdictRow}>
        <Glyph
          name={good ? "check" : "close"}
          size={20}
          color={good ? colors.done : colors.expiring}
        />
        <Text
          preset="heading"
          text={verdict}
          style={[themed($verdict), { color: good ? colors.done : colors.expiring }]}
        />
      </View>

      {/* The reading, and the range beside it. One line, because the wrap it
          had turned a fact into a paragraph. */}
      <View style={$readingRow}>
        <Text
          preset="default"
          text={`${show(latest.value)} ${series.unit}`}
          style={themed($reading)}
        />
        <Text
          preset="formHelper"
          text={`target ${band.low}–${band.high} · ${latest.label}`}
          style={themed($target)}
          numberOfLines={1}
        />
      </View>

      {/**
       * Bars against the band.
       *
       * The dots were the fault, not the chart: a dot has no baseline, so
       * reading one meant holding its height against a shaded region in
       * mid-air. A bar starts from the floor and either reaches into the band
       * or does not — the same question, answered by looking.
       *
       * Bars and not a line, because six tests weeks apart joined by a curve
       * claims a level on every day between them that nobody measured.
       */}
      <View onLayout={onLayout} style={{ height: CHART_H }}>
        {width > 0 ? (
          <Svg width={width} height={CHART_H}>
            <Rect
              x={0}
              y={y(band.high)}
              width={width}
              height={Math.max(2, y(band.low) - y(band.high))}
              fill={colors.done}
              opacity={0.14}
            />
            {series.readings.map((r, i) => {
              const ok = inBand(r.value)
              const slot = width / series.readings.length
              const bw = slot * 0.46
              const cx = slot * (i + 0.5)
              const top = y(r.value)
              return (
                <Rect
                  key={r.label}
                  x={cx - bw / 2}
                  y={top}
                  width={bw}
                  height={Math.max(2, CHART_H - FLOOR - top)}
                  rx={2}
                  fill={ok ? colors.done : colors.expiring}
                  /* The latest at full strength; the rest step back, so the bar
                     being talked about is the one seen. */
                  opacity={i === series.readings.length - 1 ? 1 : 0.35}
                />
              )
            })}
            {/* The line the bars stand on. Without it the shortest bar looks
                clipped rather than short. */}
            <Rect x={0} y={CHART_H - FLOOR} width={width} height={1} fill={colors.separator} />
          </Svg>
        ) : null}
      </View>

      {/* Each date under its own bar's slot, so "4 Sep" sits beneath the bar it
          names rather than at the card's edge. */}
      <View style={$dates}>
        <Text
          preset="formHelper"
          text={series.readings[0].label}
          style={[themed($target), { width: width / series.readings.length, textAlign: "center" }]}
        />
        <Text
          preset="formHelper"
          text={latest.label}
          style={[themed($target), { width: width / series.readings.length, textAlign: "center" }]}
        />
      </View>
    </View>
  )
}

const $wrap: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xs })

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 11,
  lineHeight: 14,
  letterSpacing: 0.6,
})

const CHART_H = 104

/* Room under the bars for a floor to sit on. Drawn to the SVG's own edge they
   read as cut off rather than as standing on something. */
const FLOOR = 10

const $dates: ViewStyle = { flexDirection: "row", justifyContent: "space-between" }

const $verdictRow: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8 }

const $verdict: ThemedStyle<TextStyle> = () => ({ fontSize: 24, lineHeight: 29 })

const $readingRow: ViewStyle = { flexDirection: "row", alignItems: "baseline", gap: 8 }

const $reading: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})

const $target: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, flex: 1 })

const $rule: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  height: 1,
  backgroundColor: colors.separator,
  marginTop: spacing.xxs,
})

const $summary: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $tests: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xxs })

const $test: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "baseline",
  gap: spacing.sm,
})

/* Takes the slack, so the numbers line up in a column down the card however
   long a date happens to be. */
const $when: ThemedStyle<TextStyle> = ({ colors }) => ({ flex: 1, color: colors.textDim })

const $value: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
  minWidth: 46,
  textAlign: "right",
})

const $state: ThemedStyle<TextStyle> = () => ({ minWidth: 62, textAlign: "right" })
