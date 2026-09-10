import { FC, Fragment, useState } from "react"
import { LayoutChangeEvent, TextLayoutEventData, TextStyle, View, ViewStyle } from "react-native"
import Svg, { Circle, Line, Path } from "react-native-svg"

import { Text } from "@/components/Text"
import type { Milestone } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * The care path, drawn.
 *
 * ## Why this is not AntV
 *
 * AntV's engine was vendored, compiled and run on the device to find out. It
 * works — their layout, their text measurement, their structures, drawing
 * through `react-native-svg`. What it draws for six milestones is **1020×327**:
 * a laptop canvas. On a 390pt column that is a 0.38 scale, so 14pt labels
 * arrive at five, and their text is laid out as HTML inside `<foreignObject>`,
 * which react-native-svg has no element for and which would have to be
 * re-typeset here regardless.
 *
 * Their visual vocabulary is worth taking. Their canvas is not. So the geometry
 * below is theirs in spirit — a rail, a marker per step, state carried by the
 * marker rather than by a label saying "done" — and the proportions are a
 * phone's.
 *
 * ## Why the rail is SVG and the words are not
 *
 * The device this is built for runs at `font_scale 1.15`, and a patient reading
 * a transplant follow-up is exactly the person likely to have raised it further.
 * Text inside SVG cannot honour that — it is drawn at the size the path says.
 * So the words are real `<Text>`, the rail is `<Svg>` behind them, and the two
 * are married by measurement: each row reports its own height and the rail is
 * drawn to match.
 *
 * That is the same fault this project already hit once, when a fixed 108pt
 * pitch overlapped every card at 1.15. Nothing here assumes a row height.
 */
export interface JourneyTimelineProps {
  milestones: Milestone[]
  /** Shown under the current step. Omitted where a step has nothing to add. */
  showDetail?: boolean
}

/** The rail's column, and where the marker sits in it. */
const RAIL_X = 15
const MARKER_R = 7.5
const GUTTER = 42

/**
 * The row's top padding, which `onTextLayout` cannot see.
 *
 * Line boxes are reported relative to the text, and the text starts below the
 * row's own padding — so the two measurements are in different coordinates and
 * this is the one number that joins them. It is read from the same `spacing.sm`
 * the row's style uses, rather than typed twice.
 */
const TITLE_INSET_KEY = "sm" as const

export const JourneyTimeline: FC<JourneyTimelineProps> = function JourneyTimeline({
  milestones,
  showDetail = true,
}) {
  const { themed, theme } = useAppTheme()
  const TITLE_INSET = theme.spacing[TITLE_INSET_KEY]

  /**
   * Where each marker belongs, measured in two parts.
   *
   * **A marker anchors to the title's first line, not to the row's centre.**
   * With the centre, a step whose name wraps — "Six-week bloods and biopsy" does
   * at this font scale — puts its dot beside the second line, pointing at
   * "biopsy" rather than at the step. The row is the wrong thing to measure,
   * and it is wrong only sometimes, which is how it survives a look.
   *
   * `onTextLayout` reports each rendered line with its own box, so the first
   * line's centre is a measurement rather than a guess about how many lines
   * there were. Both halves are needed: the row for where it sits in the list,
   * the line for where it sits in the row.
   *
   * Nothing is drawn until every row has reported. A rail against guessed
   * positions is visibly wrong for a frame and then jumps.
   */
  const [rowTops, setRowTops] = useState<number[]>([])
  const [lineOffsets, setLineOffsets] = useState<number[]>([])
  const [height, setHeight] = useState(0)

  const remember =
    (set: typeof setRowTops, index: number) =>
    (value: number): void => {
      set((prev) => {
        if (prev[index] !== undefined && Math.abs(prev[index] - value) < 0.5) return prev
        const next = [...prev]
        next[index] = value
        return next
      })
    }

  const onRowLayout = (index: number) => (event: LayoutChangeEvent) =>
    remember(setRowTops, index)(event.nativeEvent.layout.y)

  const onTitleTextLayout =
    (index: number) => (event: { nativeEvent: TextLayoutEventData }) => {
      const first = event.nativeEvent.lines[0]
      if (!first) return
      remember(setLineOffsets, index)(first.y + first.height / 2)
    }

  const complete = (a: number[]) => a.length === milestones.length && a.every((v) => v !== undefined)
  const ready = complete(rowTops) && complete(lineOffsets)
  const centres = milestones.map((_, i) => rowTops[i] + TITLE_INSET + lineOffsets[i])

  const colourFor = (state: Milestone["state"]) =>
    state === "done" ? theme.colors.done : state === "current" ? theme.colors.asked : "#C9C4BC"

  return (
    <View style={$root} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {ready && height > 0 ? (
        <Svg
          style={$rail}
          width={GUTTER}
          height={height}
          pointerEvents="none"
          accessibilityElementsHidden
        >
          {/* One segment per gap, so the rail changes colour exactly where the
              patient's progress does rather than at a rounded position. Ahead
              of the current step it is dashed: a solid line all the way down
              would claim the rest has happened. */}
          {centres.slice(0, -1).map((from, i) => {
            const passed = milestones[i].state === "done"
            return (
              <Line
                key={`seg-${milestones[i].id}`}
                x1={RAIL_X}
                y1={from + MARKER_R + 3}
                x2={RAIL_X}
                y2={centres[i + 1] - MARKER_R - 3}
                stroke={passed ? theme.colors.done : "#DEDAD4"}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={passed ? undefined : "2 5"}
              />
            )
          })}

          {milestones.map((m, i) => {
            const cy = centres[i]
            const colour = colourFor(m.state)
            return (
              <Fragment key={m.id}>
                {/* The current step wears a halo. It is the only marker that
                    does, because it is the only one the patient can act on —
                    and a halo reads at arm's length where a colour alone does
                    not. */}
                {m.state === "current" && (
                  <Circle cx={RAIL_X} cy={cy} r={MARKER_R + 5} fill={colour} opacity={0.16} />
                )}
                <Circle
                  cx={RAIL_X}
                  cy={cy}
                  r={MARKER_R}
                  fill={m.state === "ahead" ? "#FFFFFF" : colour}
                  stroke={colour}
                  strokeWidth={2}
                />
                {/* Done carries a tick rather than a fill alone: the difference
                    between a filled and a hollow disc is not legible to
                    everyone, and this list is read by people who are unwell. */}
                {m.state === "done" && (
                  <Path
                    d={`M ${RAIL_X - 3.4} ${cy} l 2.4 2.5 l 4.6 -5`}
                    stroke="#FFFFFF"
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )}
              </Fragment>
            )
          })}
        </Svg>
      ) : null}

      <View style={$rows}>
        {milestones.map((m, i) => (
          <View key={m.id} style={themed($row)} onLayout={onRowLayout(i)}>
            <Text
              preset={m.state === "current" ? "bold" : "default"}
              text={m.title}
              onTextLayout={onTitleTextLayout(i)}
              style={themed(m.state === "ahead" ? $titleAhead : $title)}
            />
            <Text preset="formHelper" text={m.when} style={themed($when)} />
            {showDetail && m.detail && m.state === "current" ? (
              <Text preset="formHelper" text={m.detail} style={themed($detail)} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  )
}

const $root: ViewStyle = { position: "relative" }

const $rail: ViewStyle = { position: "absolute", left: 0, top: 0 }

const $rows: ViewStyle = { paddingLeft: GUTTER }

/* The gap is padding on the row rather than a gap on the list, so the measured
   centre a marker is drawn against is the centre of the words plus their own
   breathing room — not the centre of a box that stops at the text. */
const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.sm,
  gap: 1,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $titleAhead: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $when: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $detail: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.text,
  marginTop: spacing.xxs,
})
