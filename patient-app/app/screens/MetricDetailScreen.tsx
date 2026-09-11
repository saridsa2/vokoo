import { FC, useState } from "react"
import { LayoutChangeEvent, Pressable, TextStyle, View, ViewStyle } from "react-native"
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg"

import { Panel } from "@/components/Panel"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { PASSIVE, SPIROMETRY, TACROLIMUS, YEAR_BY_KEY } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * The long view — the question a fortnight cannot be asked.
 *
 * ## What Apple and Samsung actually do, and what does not transfer
 *
 * Both build a metric screen the same way: a **period selector** across the
 * top, one chart, a short highlight, and an "About" note at the bottom. The raw
 * numbers are buried under "Show All Data" at the very end, which is the
 * clearest possible statement that a table is not what a detail screen is for.
 * Three versions of this screen tried to be one; that structure is the
 * correction.
 *
 * What does **not** transfer is the content. Apple has never had to display
 * FEV1 — it shows steps, heart rate, sleep, all judged against population
 * ranges or a goal the user set. A transplanted lung is judged against *this
 * patient's own baseline*, and the decision rule is a fall that is sustained.
 * There is no Apple screen to copy for that.
 *
 * ## So the long window asks a different question
 *
 * The card asks *am I where they want me* over a fortnight. Over months the
 * question is the one chronic rejection is actually detected by: **is the curve
 * drifting away from baseline** — CLAD is a slow decline, graded in percent of
 * baseline, and it is invisible in any fourteen-day window because two weeks of
 * a slow drift look like noise.
 *
 * That is why the axis here is fixed. 100 and 90 stay in the same place at every
 * period, so a year and a month are directly comparable and a drift shows as the
 * band thinning rather than as a scale quietly rescaling under it. Letting the
 * chart fit its own data would hide exactly the thing it exists to show.
 */
interface MetricDetailScreenProps extends AppStackScreenProps<"MetricDetail"> {}

const SERIES = Object.fromEntries([SPIROMETRY, TACROLIMUS, ...PASSIVE].map((s) => [s.key, s]))

/**
 * Three, not five.
 *
 * A day and a week are what the card already shows, so offering them here would
 * put the same picture behind two more buttons. These are the windows the card
 * cannot hold.
 */
const PERIODS = [
  { id: "m", label: "Month", days: 30 },
  { id: "6m", label: "6 months", days: 182 },
  { id: "y", label: "Year", days: 365 },
] as const

const ABOVE = "#3E8E5A"
const BELOW = "#D9822B"
const PLOT_H = 170

export const MetricDetailScreen: FC<MetricDetailScreenProps> = function MetricDetailScreen({
  route,
}) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme

  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("6m")
  const [width, setWidth] = useState(0)
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }

  const series = SERIES[route.params.metricKey]
  const history = YEAR_BY_KEY[route.params.metricKey]
  if (!series || !history) return null

  const chosen = PERIODS.find((p) => p.id === period) ?? PERIODS[1]
  /* Newest last, so the curve runs left to right like every other chart here. */
  const window = history.filter((r) => r.day < chosen.days).sort((a, b) => b.day - a.day)

  /**
   * Everything is a percentage of this patient's baseline.
   *
   * Not litres: the axis has to mean the same thing at every period and for
   * every patient, and 100 does while 2.35 does not. It is also the unit the
   * grading system uses, so what the screen shows and what a clinic writes down
   * are the same number.
   */
  const baseline = series.baseline
  const limitPct =
    baseline !== undefined && series.action
      ? series.action.direction === "rise"
        ? 100 + series.action.fraction * 100
        : 100 - series.action.fraction * 100
      : undefined

  /**
   * Percent of baseline only where there *is* a baseline.
   *
   * Sleep and steps have none — `HomeSeries` says so in as many words, because
   * a computed average dressed as a baseline is a convenience presented as a
   * clinical fact. Running them through the percent path printed "6% of your
   * baseline" over 6.2 hours of sleep and drew the curve off the bottom of a
   * scale fixed for lungs.
   *
   * So there are two charts here, and the difference is the axis: against a
   * baseline it is fixed at 60–115 so periods are comparable; without one it
   * fits the window, because there is no external level to hold it to.
   */
  const relative = baseline !== undefined
  const pct = (v: number) => (relative ? (v / baseline!) * 100 : v)
  const values = window.map((r) => pct(r.value))

  /**
   * A fixed axis, deliberately.
   *
   * 60 to 115 covers a discharge-day lung and a fully recovered one, so the
   * 100 rule and the 90 rule sit in the same place whichever period is chosen.
   * A scale fitted to the window would rescale under a slow decline and draw it
   * flat — the one failure this screen exists to prevent.
   */
  const span = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1]
  const room = (span[1] - span[0] || 1) * 0.15
  const LO = relative ? 60 : span[0] - room
  const HI = relative ? 115 : span[1] + room
  const y = (p: number) => PLOT_H - ((p - LO) / (HI - LO)) * PLOT_H

  /**
   * The highlight: this period against the one before it.
   *
   * Apple's screens carry one sentence of comparison and it is the most useful
   * thing on them — a number is not a trend until something else is beside it.
   * The comparison is against the *previous* window of the same length, which is
   * the only fair one.
   */
  const previous = history
    .filter((r) => r.day >= chosen.days && r.day < chosen.days * 2)
    .map((r) => pct(r.value))
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const now = mean(values)
  const before = mean(previous)
  const delta = previous.length ? now - before : undefined

  /* Two vocabularies, because "points" is meaningless without a percentage and
     "hours" is meaningless with one. */
  const dp = series.decimals ?? 0
  const amount = relative
    ? `${Math.round(now)}% of your baseline`
    : `${now.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })} ${series.unit}`
  const moved = relative ? 1.5 : Math.max(0.05, before * 0.03)

  const highlight =
    delta === undefined
      ? `Averaging ${amount}.`
      : Math.abs(delta) < moved
        ? `Averaging ${amount} — the same as the ${chosen.label.toLowerCase()} before.`
        : `Averaging ${amount}, ${delta > 0 ? "up" : "down"} on the ${chosen.label.toLowerCase()} before.`

  const step = width / Math.max(1, values.length - 1)
  const line = values.map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${y(p)}`).join(" ")
  const area = `${line} L ${(values.length - 1) * step} ${PLOT_H} L 0 ${PLOT_H} Z`

  return (
    <Screen preset="scroll" contentContainerStyle={themed($container)} safeAreaEdges={["top"]}>
      <Text preset="heading" text={series.title} style={themed($title)} />
      {series.clinicalName ? (
        <Text preset="formHelper" text={series.clinicalName} style={themed($sub)} />
      ) : null}

      {/* The period selector, which is the whole reason this screen exists. */}
      <View style={themed($periods)}>
        {PERIODS.map((p) => {
          const on = p.id === period
          return (
            <Pressable
              key={p.id}
              onPress={() => setPeriod(p.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[themed($period), on ? themed($periodOn) : null]}
            >
              <Text
                preset={on ? "bold" : "default"}
                text={p.label}
                style={[themed($periodText), on ? { color: colors.palette.neutral100 } : null]}
              />
            </Pressable>
          )
        })}
      </View>

      <Panel>
        <Text preset="default" text={highlight} style={themed($highlight)} />

        <View onLayout={onLayout} style={{ height: PLOT_H }}>
          {width > 0 ? (
            <Svg width={width} height={PLOT_H}>
              <Defs>
                <LinearGradient id="drift" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={ABOVE} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={ABOVE} stopOpacity={0.02} />
                </LinearGradient>
              </Defs>

              {/* The two rules, drawn first so the curve sits over them. Fixed
                  positions at every period — that is the point of the screen. */}
              {relative ? (
                <Path
                  d={`M 0 ${y(100)} L ${width} ${y(100)}`}
                  stroke={colors.textDim}
                  strokeWidth={1}
                />
              ) : null}
              {relative && limitPct !== undefined ? (
                <Path
                  d={`M 0 ${y(limitPct)} L ${width} ${y(limitPct)}`}
                  stroke={BELOW}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              ) : null}

              <Path d={area} fill="url(#drift)" />
              <Path d={line} stroke={ABOVE} strokeWidth={2} fill="none" strokeLinejoin="round" />
            </Svg>
          ) : null}
        </View>

        {/* Both rules named once, since they are the only two numbers on the
            axis and neither is printed beside it. */}
        <View style={$rules}>
          {relative ? (
            <Text preset="formHelper" text="— your baseline (100%)" style={themed($sub)} />
          ) : null}
          {relative && limitPct !== undefined ? (
            <Text
              preset="formHelper"
              text={`- - ring the unit under ${Math.round(limitPct)}%`}
              style={[themed($sub), { color: BELOW }]}
            />
          ) : null}
        </View>
      </Panel>

      {/* Learned once, so it lives here rather than on every card. */}
      <Text preset="formHelper" text={series.meaning} style={themed($sub)} />
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.lg,
  gap: spacing.sm,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $sub: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $highlight: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.text,
  marginBottom: spacing.xs,
})

const $periods: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flexDirection: "row",
  borderWidth: 1,
  borderColor: colors.border,
})

const $period: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  alignItems: "center",
  paddingVertical: spacing.xs,
})

const $periodOn: ThemedStyle<ViewStyle> = ({ colors }) => ({ backgroundColor: colors.tint })

const $periodText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $rules: ViewStyle = { flexDirection: "row", justifyContent: "space-between", gap: 12 }
