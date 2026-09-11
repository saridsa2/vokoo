import { FC, useState } from "react"
import { LayoutChangeEvent, Pressable, TextStyle, View, ViewStyle } from "react-native"
import Svg, { Circle, Polyline, Rect } from "react-native-svg"

import { Glyph, type GlyphName } from "@/components/Glyph"
import { Panel } from "@/components/Panel"
import { Text } from "@/components/Text"
import type { HomeSeries } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * What the watch reported, as a fortnight of shape.
 *
 * ## Why this is not rings any more
 *
 * It was two Apple-style progress rings — sleep against eight hours, steps
 * against five thousand — and the component's own docstring admitted the
 * problem: *"Both remaining goals are still placeholders… A ring tells somebody
 * they fell short, so these must not reach a real patient unprescribed."*
 *
 * The data said it louder. `STEPS.meaning` reads **"There is no target to
 * hit"** while `STEPS.goal` was 5000, so the card drew a target under a caption
 * denying one existed. A ring cannot be drawn without a goal, and no clinician
 * set these — five thousand steps is what a healthy adult is told, and a
 * patient six weeks out of a heart–lung transplant is not that.
 *
 * ## And not a computed average either
 *
 * The obvious replacement is "compare it to their own usual", and `HomeSeries`
 * forbids it in as many words: *"Computing an average and drawing it as a
 * baseline would dress a convenience up as a clinical fact, and every bar would
 * then be measured against a line nobody set."*
 *
 * That same doc prescribes what is left: *"No baseline means no reference rule
 * on the chart: the trend, and nothing implied about it."* So this is fourteen
 * days of the actual figure, the latest one picked out, and no line of any kind
 * to be measured against. Nothing here says a patient did well or badly,
 * because nothing here knows.
 *
 * ## Bars, and why the shape is worth showing at all
 *
 * Sleep fell from 6.8 to 5.1 across late August and came back to 7.0. That
 * movement is the whole value of a passive reading — it is the thing a
 * transplant unit asks about at clinic, and the thing a single number cannot
 * show. A bar starts at the floor, so its height *is* the value; a dot floats
 * and has to be measured against an axis that is not there.
 */
export interface WearableTrendsProps {
  series: HomeSeries[]
  /**
   * Opens a metric's full history.
   *
   * A summary invites a tap, and one that does nothing is worse than one
   * plainly inert — the reader tries twice.
   */
  onOpen?: (key: string) => void
}

/**
 * A colour per metric, which departs from this app's chart rule on purpose.
 *
 * The rule — one hue at several weights — exists because a chart shows one
 * measurement, and a second colour would claim two things differ when they are
 * one. These are three unrelated readings that happen to share a device, so the
 * colour is how you tell which strip is which without reading back up to the
 * label. Apple's hues, pulled to values that survive a near-white card.
 */
const TINT: Record<string, string> = {
  sleep: "#4B49D6",
  steps: "#28B44A",
  resting_hr: "#FA114F",
}

const FALLBACK = "#2f7d4f"

const GLYPH: Record<string, GlyphName> = {
  sleep: "sleep",
  steps: "steps",
  resting_hr: "heart",
}

/**
 * Has the latest reading crossed a line somebody set.
 *
 * `band` is a target range and `action` is a fraction off `baseline` in a
 * stated direction — both belong to the care path. Absent, there is nothing to
 * cross and the answer is no.
 */
function crossed(series: HomeSeries) {
  const latest = series.readings[series.readings.length - 1]?.value
  if (latest === undefined) return false
  if (series.band) return latest < series.band.low || latest > series.band.high
  if (series.baseline !== undefined && series.action) {
    const limit =
      series.action.direction === "rise"
        ? series.baseline * (1 + series.action.fraction)
        : series.baseline * (1 - series.action.fraction)
    return series.action.direction === "rise" ? latest > limit : latest < limit
  }
  return false
}

const STRIP_H = 46

/**
 * Which metrics are drawn as bars, and why the other one is not.
 *
 * A bar's height *is* its value, which requires a floor of zero to mean
 * something. Steps and sleep have that: zero steps and zero sleep are real
 * quantities, so a bar from the baseline reads correctly and the fortnight's
 * shape is legible.
 *
 * A resting heart rate of zero is death. Nobody's rate varies between 0 and
 * 103, it varies between 95 and 103 — so on a zero-based scale all fourteen
 * bars came out the same height and the card showed nothing at all. Scaling
 * the bars to 95–103 instead would be worse: a bar four times the height of
 * its neighbour, for a difference of eight beats.
 *
 * A line has no baseline to claim, so it can be scaled to the data's own range
 * honestly — its job is the shape, not the magnitude. Apple splits its own
 * Health charts on exactly this line: steps are bars, heart rate is not.
 */
const BARS = new Set(["sleep", "steps"])

export const WearableTrends: FC<WearableTrendsProps> = function WearableTrends({ series, onOpen }) {
  return (
    /* No card heading. A moon, a pair of footprints and a heart already say
       where these came from — "From your watch" over them restates the card's
       own contents, which is furniture. This was deleted once before and I put
       it back; it is written down here so it does not return a third time. */
    <Panel>
      {series.map((s, i) => (
        <MetricRow key={s.key} series={s} last={i === series.length - 1} onOpen={onOpen} />
      ))}
    </Panel>
  )
}

const MetricRow: FC<{
  series: HomeSeries
  last: boolean
  onOpen?: (key: string) => void
}> = function MetricRow({ series, last, onOpen }) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const [width, setWidth] = useState(0)
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }

  const tint = TINT[series.key] ?? FALLBACK

  /**
   * Shown only when a threshold the care path set has actually been crossed.
   *
   * These three have neither a band nor an action rule, so nothing here ever
   * raises it — which is correct, and is the point. A passive reading with no
   * prescribed target has nothing to say most days, and the honest way to show
   * that is to say nothing.
   */
  const attention = crossed(series)
  const values = series.readings.map((r) => r.value)
  const latest = values[values.length - 1]
  const dp = series.decimals ?? 0

  /**
   * Zero to a little above the tallest bar.
   *
   * A bar has to stand on the floor or its height stops meaning the value —
   * which is the whole reason for choosing bars. The 8% of headroom keeps the
   * tallest one from touching the top edge and reading as clipped.
   */
  const bars = BARS.has(series.key)

  /* Bars measure from zero; the line measures across the range it actually
     occupies, with a tenth of that range as padding so the highest and lowest
     points are not drawn on the edge. */
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo || 1) * 0.25
  const floor = bars ? 0 : lo - pad
  const ceiling = bars ? hi * 1.08 : hi + pad
  const y = (v: number) => STRIP_H - ((v - floor) / (ceiling - floor)) * STRIP_H

  /* Thousands become K. A step count is never read back to the unit, so the
     room is better spent on the figure being large enough to see. Under a
     thousand stays exact: 6.6 hours is not 0.0066K. */
  const show = (v: number) => {
    if (v < 1000)
      return v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })
    const k = v / 1000
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`
  }

  return (
    <Pressable
      onPress={onOpen ? () => onOpen(series.key) : undefined}
      style={[themed($row), last ? null : themed($divider)]}
      accessibilityRole={onOpen ? "button" : undefined}
      accessibilityLabel={`${series.title}, ${show(latest)} ${series.unit}`}
    >
      <View style={$head}>
        <Glyph name={GLYPH[series.key] ?? "heart"} size={16} color={tint} />
        <Text preset="formLabel" text={series.title} style={themed($name)} />
        {attention ? (
          <View style={themed($pill)}>
            <Text preset="formHelper" text="Needs attention" style={themed($pillText)} />
          </View>
        ) : null}
        <Text
          preset="bold"
          text={`${show(latest)} ${series.unit}`}
          style={themed($value)}
          numberOfLines={1}
        />
      </View>

      <View onLayout={onLayout} style={{ height: STRIP_H }}>
        {width > 0 ? (
          <Svg width={width} height={STRIP_H}>
            {bars ? (
              series.readings.map((r, i) => {
                const slot = width / series.readings.length
                const bw = Math.max(2, slot * 0.62)
                const cx = slot * (i + 0.5)
                const barTop = y(r.value)
                const isLatest = i === series.readings.length - 1
                return (
                  <Rect
                    key={r.label}
                    x={cx - bw / 2}
                    y={barTop}
                    width={bw}
                    height={Math.max(2, STRIP_H - barTop)}
                    fill={isLatest ? colors.text : tint}
                    /* The latest in ink at full strength; the fortnight behind
                       it steps back, so the figure printed above is the bar the
                       eye lands on. */
                    opacity={isLatest ? 1 : 0.28}
                  />
                )
              })
            ) : (
              <>
                <Polyline
                  points={series.readings
                    .map((r, i) => {
                      const step = width / Math.max(1, series.readings.length - 1)
                      return `${i * step},${y(r.value)}`
                    })
                    .join(" ")}
                  fill="none"
                  stroke={tint}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Only the latest is marked. A dot on all fourteen turns a
                    shape into a scatter, and the figure above the strip is
                    about today. */}
                <Circle
                  cx={width}
                  cy={y(values[values.length - 1])}
                  r={3.5}
                  fill={colors.text}
                  stroke={colors.background}
                  strokeWidth={2}
                />
              </>
            )}
          </Svg>
        ) : null}
      </View>

      {/* The dates the strip spans. Two labels, not fourteen — the shape is the
          point and a row of tick labels would be longer than the chart. */}
      <View style={$dates}>
        <Text preset="formHelper" text={series.readings[0].label} style={themed($date)} />
        <Text
          preset="formHelper"
          text={series.readings[series.readings.length - 1].label}
          style={themed($date)}
        />
      </View>
    </Pressable>
  )
}

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.xxs,
  paddingVertical: spacing.sm,
})

const $divider: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $head: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8 }

/* Takes the slack, so every metric's figure lands in the same column down the
   card however long its name is. */
const $name: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

const $value: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})

const $pill: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingHorizontal: spacing.xs,
  paddingVertical: 2,
  backgroundColor: colors.expiringBackground ?? colors.palette.neutral300,
})

const $pillText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.expiring })

const $dates: ViewStyle = { flexDirection: "row", justifyContent: "space-between" }

const $date: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })
