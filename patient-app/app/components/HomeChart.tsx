import { FC } from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import Svg, { Line, Rect } from "react-native-svg"

import { Text } from "@/components/Text"
import type { HomeSeries } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/** Where a number came from, said the way a patient would say it. */
const SOURCE_LABEL: Record<HomeSeries["source"], string> = {
  patient: "You",
  device: "Your spirometer",
  lab: "The lab",
  wearable: "Your watch",
}

/**
 * A series of home readings, as bars.
 *
 * **Bars rather than a line, deliberately.** A line says the measurement is
 * continuous and that the points between readings can be read off it. These are
 * discrete acts — one blow on one morning — and a patient who missed Tuesday
 * should see a gap, not an interpolation through it.
 *
 * The console's chart rules carry over, because they were right for the same
 * reasons:
 *
 * - **One hue at several weights, never two.** A second colour would claim two
 *   things are different when they are one measurement seen twice.
 * - **Ink on exactly one bar** — today's. Everything else is the accent.
 * - **Neutral axes, grid and labels.** The data is the only coloured thing.
 * - Tabular figures, so the numbers do not shuffle as they change.
 *
 * What is not from the console is the **reference geometry**, and it is what
 * makes this chart clinical rather than decorative: a baseline rule, and the
 * line below it where the patient is supposed to act. `docs/hlt-follow-up-data.md`
 * has the sources; the short version is that a 10% fall from baseline holding
 * more than two days means rejection or infection, and a chart that draws the
 * bars without that line leaves the reader to do the arithmetic that matters.
 */
export const HomeChart: FC<{ series: HomeSeries; height?: number }> = function HomeChart({
  series,
  height = 156,
}) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const dp = series.decimals ?? 2
  const show = (v: number) =>
    v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })

  const values = series.readings.map((r) => r.value)
  const latest = values[values.length - 1]

  /**
   * The scale has to include the action line and the band, or the one thing the
   * chart exists to show could fall off the bottom of it.
   *
   * **The axis does not start at zero, and that is the right call here even
   * though it usually is not.** Bars from a suppressed zero exaggerate
   * differences, which is why the rule exists. But an FEV1 axis from zero puts
   * every bar at the top of the frame and makes a 10% fall — the fall that
   * means rejection — visually indistinguishable from noise. What makes it
   * honest is that the reference is drawn rather than implied: the baseline
   * rule and the action line are on the chart, so the reader is comparing bars
   * to a line and not to the floor.
   */
  /**
   * The action line, wherever it falls.
   *
   * `rise` puts it above the baseline, so a heart patient's weight threshold is
   * drawn by the same code as a lung patient's FEV1 one. A series with no
   * baseline gets none at all — a passive reading from a watch is a trend, and
   * there is no published rule to draw across it.
   */
  const actionLine =
    series.action && series.baseline !== undefined
      ? series.baseline *
        (series.action.direction === "fall"
          ? 1 - series.action.fraction
          : 1 + series.action.fraction)
      : undefined

  /* Every reference the chart draws has to be inside the scale, or the one
     thing it exists to show falls off the edge. With no references, the
     readings alone set it. */
  const marks = [
    ...values,
    ...(series.band ? [series.band.low, series.band.high] : []),
    ...(series.baseline !== undefined ? [series.baseline] : []),
    ...(actionLine !== undefined ? [actionLine] : []),
  ]
  const lo = Math.min(...marks) * 0.96
  const hi = Math.max(...marks) * 1.04
  const span = hi - lo || 1

  const w = 100
  const n = series.readings.length
  const slot = w / n
  const barW = slot * 0.56
  const y = (v: number) => ((hi - v) / span) * height

  /* Crossed, in whichever direction this measurement is watched. */
  const crossed =
    actionLine !== undefined &&
    (series.action?.direction === "rise" ? latest > actionLine : latest < actionLine)

  return (
    <View style={themed($wrap)}>
      <View style={themed($head)}>
        <View style={$headBody}>
          <Text preset="formHelper" text={series.title.toUpperCase()} style={themed($label)} />
          {/* The name on their lab report, so the two can be matched. Small and
              dim: it is a key, not a heading. */}
          {series.clinicalName ? (
            <Text preset="formHelper" text={series.clinicalName} style={themed($clinical)} />
          ) : null}
          <View style={themed($figureRow)}>
            <Text preset="heading" text={show(latest)} style={themed($figure)} />
            <Text preset="default" text={series.unit} style={themed($unit)} />
          </View>
        </View>
        <View style={$headRight}>
          <Text
            preset="formHelper"
            text={
              series.band
                ? series.band.label
                : series.baseline !== undefined
                  ? "Your usual"
                  : "From"
            }
            style={themed($label)}
          />
          {/* A passive series has no reference to print, so the corner says
              where the number came from instead — which is the thing a patient
              would otherwise have to guess. */}
          <Text
            preset="bold"
            text={
              series.band
                ? `${series.band.low}–${series.band.high}`
                : series.baseline !== undefined
                  ? `${show(series.baseline)} ${series.unit}`
                  : SOURCE_LABEL[series.source]
            }
            style={themed($baselineValue)}
          />
        </View>
      </View>

      <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
        {/* The target band, where there is one, as a wash behind everything. */}
        {series.band && (
          <Rect
            x={0}
            y={y(series.band.high)}
            width={w}
            height={Math.max(1, y(series.band.low) - y(series.band.high))}
            fill={colors.doneBackground}
          />
        )}

        {series.readings.map((r, i) => {
          const top = y(r.value)
          const last = i === n - 1
          return (
            <Rect
              key={r.label}
              x={i * slot + (slot - barW) / 2}
              y={top}
              width={barW}
              height={Math.max(1, height - top)}
              /* Ink for today, the accent for every other day. The one bar
                 worth a second colour is the one the patient is standing in. */
              fill={last ? colors.text : colors.asked}
              opacity={last ? 1 : 0.55}
            />
          )
        })}

        {/* Baseline: what the unit recorded as this patient's usual. Absent on
            a passive series, where no clinician set one. */}
        {series.baseline !== undefined && (
          <Line
            x1={0}
            x2={w}
            y1={y(series.baseline)}
            y2={y(series.baseline)}
            stroke={colors.textDim}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* The line where a fall stops being ordinary variation. Dashed,
            because a rule you must not cross should not look like a rule you
            are measured against. */}
        {actionLine !== undefined && (
          <Line
            x1={0}
            x2={w}
            y1={y(actionLine)}
            y2={y(actionLine)}
            stroke={colors.expiring}
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </Svg>

      {/* Only the ends are labelled. Fourteen dates under fourteen bars is a
          row of unreadable text on a phone, and the question a patient asks of
          this chart is "which way is it going", not "what was the 30th". */}
      <View style={themed($axis)}>
        <Text preset="formHelper" text={series.readings[0].label} style={themed($axisText)} />
        <Text preset="formHelper" text={series.readings[n - 1].label} style={themed($axisText)} />
      </View>

      <Text preset="formHelper" text={series.meaning} style={themed($meaning)} />

      {/* Said in words as well as drawn, because the drawing is the part a
          worried person will misread. */}
      {actionLine !== undefined && (
        <Text
          preset="formHelper"
          text={
            crossed
              ? `This is ${series.action?.direction === "rise" ? "above" : "below"} ${show(actionLine)} ${series.unit}. If tomorrow is too, ring the unit.`
              : `Ring the unit if you are ${series.action?.direction === "rise" ? "over" : "under"} ${show(actionLine)} ${series.unit} two mornings running.`
          }
          style={[themed($rule), crossed && { color: colors.expiring }]}
        />
      )}
    </View>
  )
}

const $wrap: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xs })

const $head: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
})

const $headBody: ViewStyle = { gap: 2, flexShrink: 1 }
const $headRight: ViewStyle = { alignItems: "flex-end", gap: 2, flexShrink: 1, maxWidth: "48%" }

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  letterSpacing: 0.8,
})

const $clinical: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $figureRow: ViewStyle = { flexDirection: "row", alignItems: "baseline", gap: 4 }

const $figure: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})

const $unit: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $baselineValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})

const $axis: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  justifyContent: "space-between",
})

const $axisText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $meaning: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  marginTop: spacing.xxs,
})

const $rule: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })
