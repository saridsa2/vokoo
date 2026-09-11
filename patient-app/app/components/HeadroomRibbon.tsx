import { FC, useState } from "react"
import { LayoutChangeEvent, TextStyle, View, ViewStyle } from "react-native"
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg"

import { Glyph } from "@/components/Glyph"
import { Text } from "@/components/Text"
import type { HomeSeries } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * The margin between the patient and the line that means ring the ward — drawn
 * as a ribbon whose **thickness** is that margin.
 *
 * ## Why every previous attempt was the same chart
 *
 * Line, area, dots, bars, percent-of-baseline, and a run strip. Six forms, and
 * five of them were rectangles in a row: the strip included, whatever it was
 * called. All six encoded *the value*, and left the reader to hold it against a
 * threshold and judge the gap.
 *
 * The gap **is** the clinical quantity. A transplant patient does not act on
 * 2.33 L; they act on being close to, or under, a line their unit set. So the
 * gap is what gets drawn, directly, and the reading becomes something you read
 * off rather than something you compute from.
 *
 * ## The encoding
 *
 * The action line is flat and horizontal — it does not move, so it is the
 * ribbon's own edge rather than a rule drawn across a plot. The other edge is
 * the morning's reading. What is left between them is filled.
 *
 * - **Thick ribbon: room to spare.** Nothing to do.
 * - **Ribbon narrowing: the margin is closing.** Visible as a taper, which is a
 *   shape the eye reads without counting — this is the thing a line chart
 *   cannot say, because a line falling towards a rule and a line falling in
 *   parallel with one look identical until you measure.
 * - **Ribbon pinched shut and crossing over: under the line.** The fill flips
 *   to the other side of the edge and changes colour, so a breach is a change
 *   of *form*, not a change of position.
 *
 * A run of bad mornings is therefore a long stretch of crossed-over ribbon, and
 * a single bad morning is a nick — the duration that the care path actually
 * turns on, without a second chart or a counted axis.
 *
 * ## The verdict leads, and the chart is the evidence
 *
 * `MedicineLevel` is the one card in this app that has been accepted, and its
 * shape is: a one-word verdict at heading size with a tick, the reading it came
 * from, then the chart small and last. This card led with "99% of baseline" —
 * a number, which is still something the reader has to interpret before they
 * know whether to worry.
 *
 * The patient's question is *am I where they want me*, and it has a one-word
 * answer. The chart stops being the thing being read and becomes the thing
 * backing it up, which is the right weight for it: most mornings there is
 * nothing in it, and on the morning there is, the word says so first.
 *
 * ## What is deliberately absent
 *
 * No y-axis, no gridlines, no ticks. The quantity is a thickness, and a
 * thickness is judged against itself and against zero — neither of which needs
 * a scale printed beside it. Adding one would invite the reader back into the
 * arithmetic this exists to remove.
 */
export interface HeadroomRibbonProps {
  series: HomeSeries
  height?: number
  /**
   * Told the verdict, so the card around this can wear it.
   *
   * The card's rail was hardcoded green by the screen that mounts it, which
   * meant a card headed "Ring the unit" in amber had a green edge. The screen
   * cannot know the verdict — this component computes it — so it is reported
   * upward rather than guessed downward.
   *
   * The ribbon's own green and amber are **not** recoloured to match: there
   * they are the data, marking which mornings were under the line, and
   * repainting them would delete the thing the chart is for.
   */
  onVerdict?: (settled: boolean) => void
}

/** Room above the line. */
const SAFE = "#3E8E5A"
/** Under it. */
const BREACH = "#D9822B"

export const HeadroomRibbon: FC<HeadroomRibbonProps> = function HeadroomRibbon({
  series,
  height = 76,
  onVerdict,
}) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const [width, setWidth] = useState(0)
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }

  const baseline = series.baseline
  const action =
    baseline !== undefined && series.action
      ? series.action.direction === "rise"
        ? baseline * (1 + series.action.fraction)
        : baseline * (1 - series.action.fraction)
      : undefined

  const dp = series.decimals ?? 2
  const show = (v: number) =>
    v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })

  const readings = series.readings
  const latest = readings[readings.length - 1].value
  const pct = (v: number) => (baseline ? (v / baseline) * 100 : 100)

  /* Nothing to draw a margin against. The caller should not reach this, and a
     silent empty box is better than a chart that invents a threshold. */
  if (action === undefined || baseline === undefined) return null

  /**
   * How many mornings the current run under the line has lasted.
   *
   * Counted back from today and stopping at the first ordinary morning: the
   * ward asks how long you have been under, and a run that ended last week is
   * history rather than a reason to ring.
   */
  let run = 0
  for (let i = readings.length - 1; i >= 0; i--) {
    if (readings[i].value >= action) break
    run++
  }

  /**
   * The scale, and it is symmetric about the line on purpose.
   *
   * The edge sits at a fixed height and the margin is measured off it in both
   * directions with the same number of points per unit, so a 5% breach is
   * exactly as thick as 5% of headroom. An asymmetric scale would make a
   * shallow breach look catastrophic or a deep one look survivable.
   */
  const margins = readings.map((r) => r.value - action)
  const reach = Math.max(...margins.map(Math.abs), action * 0.02)
  /* The line sits above centre, because headroom is the ordinary case and
     deserves the room; a breach needs enough space to be unmistakable, not
     equal billing. */
  const edgeY = height * 0.62
  const y = (margin: number) => edgeY - (margin / reach) * (height * 0.55)

  /**
   * Three states, and the middle one is why it is not a boolean.
   *
   * Under the line for two mornings is the care path's own trigger. Under it
   * for one is a dip — worth showing, not worth ringing about, and calling it
   * either "steady" or "ring the unit" would be wrong in opposite directions.
   */
  const under = latest < action
  const verdict = run >= 2 ? "Ring the unit" : under ? "Lower than usual" : "Steady"
  const verdictGood = !under
  onVerdict?.(verdictGood)

  const step = width / Math.max(1, readings.length - 1)
  const pointsX = readings.map((_, i) => i * step)

  /**
   * Split into runs of one sign, with the crossing interpolated.
   *
   * Filling one polygon and recolouring part of it is not possible in SVG
   * without a clip per segment; splitting the geometry instead means each piece
   * is a closed shape in a single colour, and the boundary lands exactly where
   * the reading actually crossed rather than at the nearest morning.
   */
  type Seg = { pts: Array<{ x: number; m: number }>; under: boolean }
  const segments: Seg[] = []
  let current: Seg | null = null

  readings.forEach((r, i) => {
    const m = r.value - action
    const under = m < 0
    const x = pointsX[i]

    if (current && current.under !== under) {
      /* Where the line was crossed, between this morning and the last. */
      const prev = current.pts[current.pts.length - 1]
      const t = Math.abs(prev.m) / (Math.abs(prev.m) + Math.abs(m) || 1)
      const crossX = prev.x + (x - prev.x) * t
      current.pts.push({ x: crossX, m: 0 })
      segments.push(current)
      current = { pts: [{ x: crossX, m: 0 }], under }
    }

    if (!current) current = { pts: [], under }
    current.pts.push({ x, m })
  })
  if (current) segments.push(current)

  const pathFor = (seg: Seg) => {
    const top = seg.pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${y(p.m)}`).join(" ")
    const back = `L ${seg.pts[seg.pts.length - 1].x} ${edgeY} L ${seg.pts[0].x} ${edgeY} Z`
    return `${top} ${back}`
  }

  return (
    <View style={themed($wrap)} onLayout={onLayout}>
      <View style={$head}>
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
      </View>

      {/* One word each way, at the size of the thing that matters. */}
      <View style={$verdictRow}>
        <Glyph
          name={verdictGood ? "check" : "close"}
          size={20}
          color={verdictGood ? colors.done : colors.expiring}
        />
        <Text
          preset="heading"
          text={verdict}
          style={[themed($verdict), { color: verdictGood ? colors.done : colors.expiring }]}
        />
      </View>

      {/* The reading it came from. A clinician on the phone asks for the litre
          figure; the percentage is what makes it judgeable without arithmetic. */}
      <View style={$readingRow}>
        <Text preset="default" text={`${show(latest)} ${series.unit}`} style={themed($value)} />
        <Text
          preset="formHelper"
          text={`${Math.round(pct(latest))}% of your baseline · ${readings[readings.length - 1].label}`}
          style={themed($sub)}
          numberOfLines={1}
        />
      </View>

      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={`safe-${series.key}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={SAFE} stopOpacity={0.55} />
              <Stop offset="1" stopColor={SAFE} stopOpacity={0.9} />
            </LinearGradient>
            <LinearGradient id={`breach-${series.key}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={BREACH} stopOpacity={0.95} />
              <Stop offset="1" stopColor={BREACH} stopOpacity={0.55} />
            </LinearGradient>
          </Defs>

          {segments.map((seg, i) => (
            <Path
              key={i}
              d={pathFor(seg)}
              fill={seg.under ? `url(#breach-${series.key})` : `url(#safe-${series.key})`}
            />
          ))}

          {/**
           * The line itself, drawn last so the ribbon meets it exactly.
           *
           * Solid and full-width because it is the only fixed thing on the
           * chart — everything else is measured from it. A dash would make it
           * look provisional, and it is the opposite of provisional.
           */}
          <Path
            d={`M 0 ${edgeY} L ${width} ${edgeY}`}
            stroke={colors.text}
            strokeWidth={1.5}
            fill="none"
          />
        </Svg>
      ) : (
        <View style={{ height }} />
      )}

      <View style={$dates}>
        <Text preset="formHelper" text={readings[0].label} style={themed($date)} />
        <Text
          preset="formHelper"
          text={readings[readings.length - 1].label}
          style={themed($date)}
        />
      </View>
    </View>
  )
}

const $wrap: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xxs })

const $head: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8 }

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 11,
  lineHeight: 14,
  letterSpacing: 0.6,
  flex: 1,
})

const $verdictRow: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8 }

const $verdict: ThemedStyle<TextStyle> = () => ({ fontSize: 24, lineHeight: 29 })

const $readingRow: ViewStyle = { flexDirection: "row", alignItems: "baseline", gap: 8 }

const $value: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})

const $sub: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, flex: 1 })

const $dates: ViewStyle = { flexDirection: "row", justifyContent: "space-between" }

const $date: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })
