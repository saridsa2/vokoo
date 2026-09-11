import { FC, useState } from "react"
import { LayoutChangeEvent, TextStyle, View, ViewStyle } from "react-native"
import { Circle, Rect } from "react-native-svg"

import { ReadingChart } from "@/components/ReadingChart"
import { Text } from "@/components/Text"
import type { HomeSeries } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/** Where a number came from, said the way a patient would say it. */
const SOURCE_LABEL: Record<HomeSeries["source"], string> = {
  patient: "You",
  device: "Your spirometer",
  lab: "The lab",
  wearable: "Your wearable",
}

/**
 * The one colour the data is drawn in.
 *
 * The *action* line is amber and today's reading is ink, and that separation is
 * the point: the accent is what was measured, amber is the one thing worth
 * ringing about, ink is where you are now. Three colours, three jobs, none
 * decorative.
 */
const ACCENT = "#2f7d4f"
const AMBER = "#d97706"

/**
 * A series of home readings.
 *
 * ## The mark follows the measurement
 *
 * `series.chart` decides, and it lives on the measurement rather than being
 * passed per screen — a lab level is dots wherever it appears. Everything was
 * bars once, which said all five were the same kind of fact.
 *
 * ## Why the library, and what it does not do
 *
 * Chart Kit's v2 charts carry the two things this needed most and a hand-rolled
 * chart got wrong: **`referenceLines`** and **`referenceBands`**, drawn behind
 * the series, which is what a baseline, an action threshold and a target range
 * actually are. `docs/hlt-follow-up-data.md` has the clinical sources; the
 * short version is that a 10% fall from baseline holding more than two days
 * means rejection or infection, and a chart that draws readings without that
 * line leaves the reader to do the arithmetic that matters.
 *
 * Two of its defaults are dangerous here and are overridden deliberately:
 *
 * - **`includeZero` is on by default.** FEV1 moves between 2.28 and 2.40, so a
 *   zero baseline flattens a fortnight of readings into the top sliver of a
 *   140pt card.
 * - **A reference line outside the domain is dropped silently** — the library
 *   returns early rather than clamping. So the domain is pinned around the
 *   *thresholds*, not around the data: otherwise the 2.12 rule would vanish,
 *   with no error, on exactly the weeks a patient is doing well, and reappear
 *   only once they were not.
 *
 * Bars get neither: `referenceLines` is not a `BarChart` prop. Nothing that
 * uses bars here has a threshold, which is why that is a note rather than a
 * problem.
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

  /* The chart needs real pixels, not a percentage: it draws into a fixed
     viewport rather than sizing itself from its parent. */
  const [width, setWidth] = useState(0)
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }

  const values = series.readings.map((r) => r.value)
  const latest = values[values.length - 1]
  const n = series.readings.length

  /* The line the patient is told to act on, derived from the baseline and the
     fraction the care path allows — never typed as a literal beside it. */
  const actionLine =
    series.baseline !== undefined && series.action
      ? series.action.direction === "rise"
        ? series.baseline * (1 + series.action.fraction)
        : series.baseline * (1 - series.action.fraction)
      : undefined

  /**
   * Drawn as a percentage of the patient's own baseline, where the measurement
   * says so.
   *
   * ISHLT grades CLAD in percent of personal baseline, and asthma action plans
   * have used percent-of-personal-best for thirty years — so this is the unit
   * the medicine is already written in. Litres are what the device reports.
   *
   * The conversion happens here rather than in the data because the *reading*
   * is still 2.33 L: that is the number on the spirometer and the one the
   * patient reads back to the unit. Only the chart's axis changes.
   */
  const asPercent = series.relative === true && series.baseline !== undefined
  const scale = (v: number) => (asPercent ? (v / series.baseline!) * 100 : v)

  const data = series.readings.map((r) => ({ at: r.label, value: scale(r.value) }))

  /* Where a fall stops being a warning and becomes the diagnosis. Published for
     FEV1 — a sustained 20% fall is CLAD — so it is read, not invented. */
  const harmLine =
    series.baseline !== undefined && series.harmFraction !== undefined
      ? series.baseline * (1 - series.harmFraction)
      : undefined

  /**
   * The domain, and it deliberately includes every rule as well as the data.
   *
   * A threshold the chart cannot show is worse than no chart: it is a chart
   * that looks complete and is missing the one line it exists for.
   */
  const marks = [
    ...values,
    ...(series.baseline !== undefined ? [series.baseline] : []),
    ...(actionLine !== undefined ? [actionLine] : []),
    ...(harmLine !== undefined ? [harmLine] : []),
    ...(series.band ? [series.band.low, series.band.high] : []),
  ].map(scale)
  const low = Math.min(...marks)
  const high = Math.max(...marks)
  const pad = (high - low || 1) * 0.12

  /**
   * How often this has been where the unit wants it — the headline for a value
   * with a target range.
   *
   * Continuous glucose monitoring faced the identical problem — a level that
   * must stay inside a band, sampled over time — and the field settled on
   * **time in range** as the number to lead with, with the trace secondary. It
   * is a real named measure in transplant too, not a borrowed metaphor.
   *
   * A **count, not a percentage**: "5 of your last 6" from six blood tests is
   * the truth, where "83%" claims a precision six samples cannot carry.
   */
  const inRange = series.band
    ? values.filter((v) => v >= series.band!.low && v <= series.band!.high).length
    : undefined

  const crossed =
    actionLine !== undefined &&
    (series.action?.direction === "rise" ? latest > actionLine : latest < actionLine)

  /**
   * Two labels, not fourteen.
   *
   * `labelStrategy="show"` matters: under the default the empty strings are
   * de-duplicated to one candidate and the collision solver can then drop an
   * end label, so the axis loses the very dates it is meant to carry.
   */
  const formatXLabel = (_v: unknown, i: number) =>
    i === 0 ? series.readings[0].label : i === n - 1 ? series.readings[n - 1].label : ""

  const common = {
    data,
    xKey: "at" as const,
    yKey: "value" as const,
    width,
    height,
    legend: false,
    labelStrategy: "show" as const,
    formatXLabel,
    /* One sentence a screen reader can act on, instead of fourteen numbers
       read aloud in order. */
    accessibilityLabel: `${series.title}. Latest ${show(latest)} ${series.unit}. ${series.meaning}`,
    /**
     * A fixed left gutter, and a narrow one.
     *
     * `"auto"` sizes it to the widest tick, which on a four-character label
     * pushed the plot a long way in from the card's edge and left the drawing
     * squeezed into the middle. Fixed also stops the plot shifting sideways as
     * the numbers change width.
     */
    yAxisLabelWidth: 26,
  }

  return (
    <View style={themed($wrap)}>
      <View style={themed($head)}>
        <View style={$headBody}>
          {/* Both names on one line. They were stacked, which read as a
              heading and a subheading for one measurement — the lab's word is
              a key for matching a report, not a second title. */}
          <Text
            preset="formHelper"
            text={
              series.clinicalName
                ? `${series.title.toUpperCase()} · ${series.clinicalName}`
                : series.title.toUpperCase()
            }
            style={themed($label)}
            numberOfLines={1}
          />
          <View style={themed($figureRow)}>
            {/**
             * The percentage leads, the reading follows small.
             *
             * Hawley 2008 (N=2412): graphs carry *gist* — what it means — and
             * exact figures carry *verbatim* — what it was. Neither alone is
             * enough, so both are shown rather than one being chosen.
             */}
            <Text
              preset="heading"
              text={asPercent ? `${Math.round(scale(latest))}%` : show(latest)}
              style={themed($figure)}
            />
            <Text
              preset="default"
              text={asPercent ? `of your normal · ${show(latest)} ${series.unit}` : series.unit}
              style={themed($unit)}
            />
          </View>
        </View>
        <View style={$headRight}>
          <Text
            preset="formHelper"
            text={
              series.band ? series.band.label : series.baseline !== undefined ? "Normal" : "From"
            }
            style={themed($label)}
            numberOfLines={1}
          />
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

      {/* Sized by the chart, not by a box around it. A fixed height left a
          band of empty card under the dates on every reading. */}
      {/* Composed on Chart Kit's scales and path geometry rather than on its
          finished component — see `ReadingChart`. */}
      <ReadingChart series={series} height={height} />

      {/**
       * One sentence, and only when there is something to say.
       *
       * Each card carried two: what the measurement is for, and what to do if
       * it crosses the line. Both were printed on every card on every visit —
       * five charts, ten paragraphs, most of it read once and then scrolled
       * past forever.
       *
       * The explanation is a thing you learn, not a thing you check, so it
       * belongs where a patient goes to learn it rather than on the card they
       * glance at each morning. The instruction stays, but only while it
       * applies: a rule you are nowhere near is already drawn, in amber, with
       * its own number on the axis — saying it again in prose adds nothing but
       * a line of worry.
       */}
      {crossed && actionLine !== undefined ? (
        <Text
          preset="formHelper"
          text={`This is ${series.action?.direction === "rise" ? "above" : "below"} ${show(actionLine)} ${series.unit}. If tomorrow is too, ring the unit.`}
          style={themed($warn)}
        />
      ) : null}
    </View>
  )
}

const $wrap: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xs })

const $head: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  gap: spacing.sm,
})

const $headBody: ViewStyle = { flex: 1 }

/* Sized to its content and never wider. Both columns were free to grow, so
   "YOUR MORNING READING" and "Your usual" each took half the row and each
   wrapped — two headings colliding over one line of space. */
const $headRight: ViewStyle = { alignItems: "flex-end", maxWidth: "38%" }

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 11,
  lineHeight: 14,
  letterSpacing: 0.6,
})


const $figureRow: ViewStyle = { flexDirection: "row", alignItems: "baseline", gap: 4 }

/* Tabular figures, so the number does not shuffle as it changes. */
const $figure: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})

const $unit: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $baselineValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})


const $warn: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.expiring })

const $good: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.done })

const $watch: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })
