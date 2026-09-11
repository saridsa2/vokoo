import { FC, useState } from "react"
import { LayoutChangeEvent, TextStyle, View, ViewStyle } from "react-native"
import {
  buildAreaPath,
  buildLinePath,
  createLinearScale,
  generateLinearTicks,
} from "@chart-kit/core"
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop, Text as SvgText } from "react-native-svg"

import { Text } from "@/components/Text"
import type { HomeSeries } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * A reading over time, drawn on Chart Kit's own maths.
 *
 * ## Why this is composed rather than configured
 *
 * `LineChart` is a finished component: it decides its own gutters, its own tick
 * count, where labels sit, how much room the axis takes. Every layout
 * complaint about the previous charts — a dead strip down the right of the
 * card, a band of empty card under the dates, an axis pushed in from the edge —
 * was a default that could be nudged but not removed.
 *
 * `@chart-kit/core` publishes the parts underneath it: `createLinearScale`,
 * `buildLinePath`, `buildAreaPath`. Those are the things that are hard to get
 * right and easy to get subtly wrong. The layout is the easy part, and it is
 * the part that has to answer to this card. So the maths is theirs and the
 * marks are ours.
 */
export interface ReadingChartProps {
  series: HomeSeries
  height?: number
}

const ACCENT = "#2f7d4f"
const AMBER = "#d97706"

/* The plot's own edges. Left carries the axis; the rest is as tight as the
   marks allow, because the card's padding is already the margin. */
const PAD = { left: 30, right: 6, top: 12, bottom: 20 }

const DOT = 3.2
const LATEST = 5

export const ReadingChart: FC<ReadingChartProps> = function ReadingChart({ series, height = 150 }) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const [width, setWidth] = useState(0)
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }

  const readings = series.readings
  const values = readings.map((r) => r.value)
  const latest = values[values.length - 1]
  const dp = series.decimals ?? 2
  const show = (v: number) =>
    v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })

  const action =
    series.baseline !== undefined && series.action
      ? series.action.direction === "rise"
        ? series.baseline * (1 + series.action.fraction)
        : series.baseline * (1 - series.action.fraction)
      : undefined

  /* Every rule is inside the domain, or the chart quietly loses the line it
     exists to draw. */
  const marks = [
    ...values,
    ...(series.baseline !== undefined ? [series.baseline] : []),
    ...(action !== undefined ? [action] : []),
    ...(series.band ? [series.band.low, series.band.high] : []),
  ]

  if (width === 0) return <View onLayout={onLayout} style={{ height }} />

  const plot = {
    x: PAD.left,
    y: PAD.top,
    width: Math.max(1, width - PAD.left - PAD.right),
    height: Math.max(1, height - PAD.top - PAD.bottom),
  }

  /**
   * The domain is the ticks' domain, not the data's.
   *
   * `generateLinearTicks` rounds outward to sensible round numbers, so ticks
   * generated from the raw extent land *outside* it — which is how the amber
   * threshold ended up drawn below the plot's floor. Scaling to the tick
   * extent instead means every label and every rule is inside the box by
   * construction.
   */
  /**
   * The domain is stated, not inferred.
   *
   * `createLinearScale({ values })` nices the extent outward to round numbers,
   * and rounding a *minimum* moves it **up** — so the amber threshold, which is
   * the lowest mark on the chart, fell below the scale's floor and drew outside
   * the plot. Giving it the exact span keeps every rule inside the box, and the
   * ticks are generated against the same span so the labels agree with it.
   */
  const lo = Math.min(...marks)
  const hi = Math.max(...marks)
  const room = (hi - lo || 1) * 0.08
  const domain: [number, number] = [lo - room, hi + room]

  const ticks = generateLinearTicks({ count: 4, domain }).filter(
    (t) => t >= domain[0] && t <= domain[1],
  )
  const y = createLinearScale({ domain, range: [plot.y + plot.height, plot.y] })

  /* Points sit inside a half-step at each end so the first and last marks are
     not clipped by the plot's edge. */
  const step = plot.width / Math.max(1, readings.length - 1)
  /* `index` and `defined` are what the path builders need to break a line at a
     missing reading rather than drawing through it. */
  const points = readings.map((r, i) => ({
    x: plot.x + i * step,
    y: y.scale(r.value),
    index: i,
    defined: true,
  }))

  const line = buildLinePath({ points, curve: "monotone" })
  const area = buildAreaPath({ points, curve: "monotone", baselineY: plot.y + plot.height })

  const dots = series.chart === "dots"

  /* The smallest gap between two ticks decides how many decimals the axis
     needs — one fewer and two labels collide, one more and it is noise. */
  const gap = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1
  const tickDecimals = gap >= 1 ? 0 : gap >= 0.1 ? 1 : 2

  return (
    <View style={themed($wrap)} onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={`fill-${series.key}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ACCENT} stopOpacity={0.22} />
            <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* The target range, where there is one, behind everything. */}
        {series.band ? (
          <Rect
            x={plot.x}
            y={y.scale(series.band.high)}
            width={plot.width}
            height={Math.max(1, y.scale(series.band.low) - y.scale(series.band.high))}
            fill={ACCENT}
            opacity={0.1}
          />
        ) : null}

        {/* Axis values, and only four of them. A tick every gridline turns the
            left of the card into a column of numbers nobody reads. */}
        {ticks.map((t: number) => (
          <SvgText
            key={t}
            x={plot.x - 6}
            y={y.scale(t) + 4}
            fontSize={11}
            fill={colors.textDim}
            textAnchor="end"
          >
            {/* Enough decimals to tell the ticks apart, and no more. Fixed at
                one, 2.35 and 2.28 both printed "2.3" and the axis read as a
                column of repeats. */}
            {t.toFixed(tickDecimals)}
          </SvgText>
        ))}

        {series.baseline !== undefined ? (
          <Line
            x1={plot.x}
            x2={plot.x + plot.width}
            y1={y.scale(series.baseline)}
            y2={y.scale(series.baseline)}
            stroke={colors.textDim}
            strokeWidth={1}
            opacity={0.6}
          />
        ) : null}

        {action !== undefined ? (
          <Line
            x1={plot.x}
            x2={plot.x + plot.width}
            y1={y.scale(action)}
            y2={y.scale(action)}
            stroke={AMBER}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        ) : null}

        {/* No fill under an irregular series: the shape between two lab tests
            weeks apart is not a quantity. */}
        {!dots ? <Path d={area.path} fill={`url(#fill-${series.key})`} /> : null}
        {!dots ? (
          <Path
            d={line.path}
            stroke={ACCENT}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}

        {points.map((p, i) => {
          const last = i === points.length - 1
          return (
            <Circle
              key={readings[i].label}
              cx={p.x}
              cy={p.y}
              r={last ? LATEST : DOT}
              fill={last ? colors.text : ACCENT}
              /* A collar on the latest, so it stays legible wherever it lands —
                 on the line, on a rule, or inside the band. */
              stroke={last ? colors.background : undefined}
              strokeWidth={last ? 2 : 0}
            />
          )
        })}
      </Svg>

      <View style={$dates}>
        <Text preset="formHelper" text={readings[0].label} style={themed($date)} />
        <Text preset="formHelper" text={readings[readings.length - 1].label} style={themed($date)} />
      </View>

      {/* Said once, under the chart, and only where a rule exists to say it
          against. */}
      {action !== undefined ? (
        <Text
          preset="formHelper"
          text={`${show(latest)} ${series.unit} today · ring the unit under ${show(action)}`}
          style={themed($note)}
        />
      ) : null}
    </View>
  )
}

const $wrap: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xxs })

const $dates: ViewStyle = { flexDirection: "row", justifyContent: "space-between" }

const $date: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, fontSize: 11 })

const $note: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, fontSize: 11 })
