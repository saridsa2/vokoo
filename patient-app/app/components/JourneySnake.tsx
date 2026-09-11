import { FC, Fragment, useEffect, useState } from "react"
import { Animated, LayoutChangeEvent, Pressable, TextStyle, View, ViewStyle } from "react-native"
import Svg, { Path } from "react-native-svg"

import { PATH_INSET, TimelinePath } from "@/components/TimelinePath"
import { Text } from "@/components/Text"
import type { Milestone } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * The care path, as a road.
 *
 * A serpentine: every step gets the full width for its words, and the line
 * turns back on itself between them. That is the shape a phone wants from a
 * sequence — a step's name is the long dimension, not the sequence itself, so
 * the sequence is what folds.
 *
 * ## Every position is a fraction, so a tablet is not a second component
 *
 * There is no fixed cell width, no baseline device, no `ms()`. The markers sit
 * at `PATH_INSET` and `1 - PATH_INSET` of the measured container, which is the
 * same contract `TimelinePath` draws its curve to — so widening the screen
 * widens the road and moves the markers with it, and nothing has to agree about
 * a number twice.
 *
 * ## The vertical joins are measured, not tuned
 *
 * A marker has to sit exactly on the end of the curve above it. The obvious way
 * is a negative margin chosen by eye, and it holds until somebody's text is
 * larger than the text it was eyed at — which on this device it already is, at
 * `font_scale 1.15`. So each row reports its own height and pulls itself up by
 * half of it, which puts the marker's centre on the curve's end at any text
 * size, in any language.
 */
export interface JourneySnakeProps {
  milestones: Milestone[]
  /**
   * The screen's scroll offset, when the screen wants steps to focus.
   *
   * Optional: the road is a component, not a scroll behaviour, and it draws the
   * same on a screen that never scrolls. Passed in rather than owned because
   * the offset belongs to the ScrollView, and a component that owned its own
   * would need to own the scrolling too.
   */
  scrollY?: Animated.Value
  /** How far down the screen the road's own top sits, so focus can be measured. */
  offsetTop?: number
  /** The band a step is fully in focus within: below the hero, above the fold. */
  focusWindow?: { top: number; bottom: number }
  /**
   * The furthest the screen can scroll.
   *
   * Needed because the last cards **cannot rise far enough to finish arriving**
   * — the content ends before they reach the position the entry fade completes
   * at, so they freeze part-faded at exactly the moment the reader is looking
   * at them. Knowing where the scroll stops lets the ramp finish there instead.
   */
  maxScroll?: number
  /**
   * Reports every row's top once measured.
   *
   * The screen needs one of these numbers — where the last completed step
   * starts — to open the road at today rather than at the beginning. It is the
   * same measurement the road already takes for its own geometry, handed out
   * rather than taken twice.
   */
  onRowsMeasured?: (tops: number[]) => void
  /**
   * What a step offers once it is open, if anything.
   *
   * A function rather than a field on the milestone, because what you can do
   * about a step is a fact about the screen you are on — the same care path is
   * read from Today, where a bloods request can be answered, and from Progress,
   * where it is history.
   */
  actionFor?: (milestone: Milestone) => { label: string; onPress: () => void } | undefined
}

const MARKER = 50
/**
 * Two rings, not one.
 *
 * The reference's marker is concentric: an outer ring in the **road's own
 * colour**, a white gap, then an inner ring in the step's colour around the
 * number. The outer ring is what does the work — it makes the road look like it
 * swells into a marker rather than being interrupted by a disc dropped on top
 * of it, which is what a single ring in the step's colour looked like.
 */
const MARKER_RING = 4
const MARKER_INNER = 36

/**
 * The palette, read off the reference rather than derived from the app's.
 *
 * Three deliberate departures from what a single hue would give you, each of
 * which is doing a job:
 *
 * - **The ring is lighter than the card it sits beside.** Same hue at the same
 *   weight and the marker reads as part of the card rather than as a point on
 *   the road.
 * - **The step being worked on is orange on the card and blue on the ring.**
 *   The card says "this one is different from the green ones behind it"; the
 *   ring says "this is where you are". They are two facts and they are shown
 *   separately.
 * - **The road has only two states, travelled and not.** It is a distance, and
 *   a distance cannot be in progress.
 */
const CARD: Record<Milestone["state"], string> = {
  done: "#6B9E3F",
  current: "#E28743",
  ahead: "#9E9E9E",
}

const RING: Record<Milestone["state"], string> = {
  done: "#8CC152",
  current: "#1B6FE3",
  ahead: "#D5D5D5",
}

const ROAD = { travelled: "#A5CFA0", ahead: "#E0E0E0" }

/**
 * How thick the road is — **a fifth of a marker, not a third.**
 *
 * Measured off a close crop of the reference rather than estimated from the
 * whole screen, which is how it got to 18: at that weight the road is piping
 * the cards have to squeeze past, and every card ended up touching it. A
 * narrower pipe is what leaves the marker reading as the heavy thing on the
 * line.
 */
const ROAD_WIDTH = 10

/** Clear space between one card and the next, which the bend has to provide. */
const ROAD_GAP = 26

/** A floor, so an unmeasured first paint still looks like a road. */
const MIN_BEND = 72

/**
 * What an open step says when it carries no detail of its own.
 *
 * Written per state rather than left blank, because a card that opens onto
 * nothing reads as one that failed to load — and the three states genuinely
 * have different things to say about their own silence.
 */
const NOTHING_MORE: Record<Milestone["state"], string> = {
  done: "This is done. Nothing is needed from you.",
  current: "Nothing more to do yet — your team will be in touch.",
  ahead: "Not due yet. It will open closer to the date.",
}

export const JourneySnake: FC<JourneySnakeProps> = function JourneySnake({
  milestones,
  actionFor,
  scrollY,
  offsetTop = 0,
  focusWindow,
  maxScroll,
  onRowsMeasured,
}) {
  const { themed, theme } = useAppTheme()

  const [width, setWidth] = useState(0)
  const [heights, setHeights] = useState<number[]>([])
  const [tops, setTops] = useState<number[]>([])

  /**
   * Which step is open, if any.
   *
   * **One at a time.** Several open steps turn the road into a column of cards
   * and lose the thing the shape is for — where you are in a sequence. Opening
   * one closes the last, which is also why this holds an id rather than a set.
   *
   * It opens closed. A step opened by default would be a claim that this is the
   * one worth reading, and on a care path that claim belongs to the current
   * step or to nothing.
   */
  const [openId, setOpenId] = useState<string | undefined>(undefined)

  /* The card's own height, for the road's geometry. */
  const onRowLayout = (index: number) => (event: LayoutChangeEvent) => {
    const h = event.nativeEvent.layout.height
    setHeights((prev) => {
      if (prev[index] !== undefined && Math.abs(prev[index] - h) < 0.5) return prev
      const next = [...prev]
      next[index] = h
      return next
    })
  }

  /**
   * Where a step sits **in the road**, measured on the wrapper.
   *
   * A layout `y` is relative to the element's own parent, and each card's
   * parent is its per-milestone wrapper — so measuring the card gave 0 for
   * every one of them. Six rows sharing one position share one set of focus
   * thresholds, which is why they faded out together and left the bare road
   * behind: the effect was working perfectly on six identical numbers.
   *
   * The wrapper's parent is the road itself, so its `y` is the cumulative
   * position, which is what was wanted.
   */
  const onStepLayout = (index: number) => (event: LayoutChangeEvent) => {
    const y = event.nativeEvent.layout.y
    setTops((prev) => {
      if (prev[index] !== undefined && Math.abs(prev[index] - y) < 0.5) return prev
      const next = [...prev]
      next[index] = y
      return next
    })
  }

  /* Announced once every row has reported, not per row — a caller acting on a
     half-measured list would scroll to a position that then moves. */
  useEffect(() => {
    if (tops.length === milestones.length && tops.every((t) => t !== undefined)) {
      onRowsMeasured?.(tops)
    }
  }, [tops, milestones.length, onRowsMeasured])

  /**
   * How present a step is, from where it sits on screen.
   *
   * A card **dissolves as it slides under the hero** and **resolves as it rises
   * from the bottom** — which is the whole of "comes into focus". Between those
   * two edges it is simply itself; a chart that dimmed everything but the exact
   * middle would make a list of six into a list of one.
   *
   * Driven off the scroll offset directly, so it runs on the native thread and
   * does not re-render a card per frame.
   */
  const focusOf = (index: number) => {
    if (!scrollY || !focusWindow || tops[index] === undefined || !heights[index]) return undefined
    /* The wrapper starts at the bend above it, so the card itself begins one
       bend further down. */
    const bend = index > 0 ? bendHeight(index - 1, index) : 0
    const top = offsetTop + tops[index] + bend
    const height = heights[index]

    /* The scroll offsets at which this row crosses each boundary. */
    const leavesUnderHero = top + height - focusWindow.top
    const clearOfHero = top - focusWindow.top
    let entersFromFold = top + height - focusWindow.bottom
    let belowFold = top - focusWindow.bottom

    /**
     * Finish the arrival by the time the scroll does.
     *
     * Without this the last two or three cards sit permanently part-faded: they
     * need to rise past a point the content never reaches. Pulling the ramp's
     * end back to `maxScroll` costs nothing on rows that could complete it
     * anyway, because their end is already below it.
     */
    if (maxScroll !== undefined && entersFromFold > maxScroll) {
      entersFromFold = maxScroll
      belowFold = Math.min(belowFold, maxScroll - 1)
    }

    /**
     * `interpolate` requires a strictly ascending input range and silently
     * misbehaves without one — and one case genuinely breaks it: an **open
     * card taller than the focus band**, where "entering" and "leaving"
     * overlap. Those get no fade rather than a wrong one.
     */
    const points = [belowFold, entersFromFold, clearOfHero, leavesUnderHero]
    const ascending = points.every((v, i) => i === 0 || v > points[i - 1])
    if (!ascending) return undefined

    return { leavesUnderHero, clearOfHero, entersFromFold, belowFold }
  }

  /**
   * The road carries the state of the step **behind** it, not the one ahead.
   *
   * It is the distance already covered, so it stays green all the way up to the
   * step being worked on and turns grey only once it leaves it. Taking the next
   * step's state instead — which the first version did — paints the run into
   * today's step in today's colour and quietly moves the finish line one step
   * early.
   */
  const roadAfter = (previous: Milestone) =>
    previous.state === "done" ? ROAD.travelled : ROAD.ahead

  /* Left column on the even steps, right on the odd. The first step starts on
     the left because that is where reading starts. */
  const sideOf = (index: number) => (index % 2 === 0 ? "left" : "right")

  /**
   * How far a row shifts to put its marker's centre on the curve's end.
   *
   * Zero until that row has been measured — an unmeasured row sits where it
   * falls rather than jumping up by a guess and settling a frame later.
   */
  const lift = (index: number) => (heights[index] ? -heights[index] / 2 : 0)

  /**
   * How tall the bend between two steps has to be.
   *
   * **Not a constant, and this is the whole of why the first attempt failed.**
   * Both rows pull up by half their own height to seat their markers on the
   * curve's ends, so a fixed bend loses `(above + below) / 2` of itself to
   * them. At a fixed 80 and two-line cards that arithmetic goes negative: the
   * cards touch and the road is buried underneath, which is exactly what it
   * did.
   *
   * Deriving it from the two rows it joins makes `ROAD_GAP` mean what it says —
   * the clear space between one card and the next — at any text size, and it
   * keeps meaning it when a card opens and grows.
   */
  const bendHeight = (above: number, below: number) =>
    Math.max(MIN_BEND, (heights[above] ?? 0) / 2 + (heights[below] ?? 0) / 2 + ROAD_GAP)

  /**
   * Where the road should cross, as a fraction of the turn's own height.
   *
   * The turn runs from one marker's centre to the next, and a marker sits at
   * its card's centre — so the clear gap between the two cards is not in the
   * middle of the turn unless the cards happen to be the same height. Opening a
   * card makes them very different, and the road then ran underneath the
   * expanded one.
   *
   * The gap starts half the upper card below the turn's top; crossing in the
   * centre of that gap puts the road between the two cards whatever either of
   * them is doing.
   */
  const crossAt = (above: number, below: number) => {
    const total = bendHeight(above, below)
    return ((heights[above] ?? 0) / 2 + ROAD_GAP / 2) / total
  }

  /* The marker hangs half outside the content column, so the road runs under it
     rather than stopping at it. */
  const edgeOffset = width ? PATH_INSET * width - MARKER / 2 : 0

  return (
    <View style={$root} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {milestones.map((m, index) => {
        const card = CARD[m.state]
        const ring = RING[m.state]
        const onRight = sideOf(index) === "right"
        const open = openId === m.id
        const action = open ? actionFor?.(m) : undefined
        const focus = focusOf(index)

        return (
          <View key={m.id} onLayout={onStepLayout(index)}>
            {index > 0 && width > 0 ? (
              /* The run into this step takes **this** step's colour, so the
                 road is grey from the moment it leaves the last thing that
                 happened — the change of colour lands where progress stops
                 rather than one step past it. */
              <TimelinePath
                towards={sideOf(index)}
                width={width}
                height={bendHeight(index - 1, index)}
                crossAt={crossAt(index - 1, index)}
                stroke={roadAfter(milestones[index - 1])}
                strokeWidth={ROAD_WIDTH}
              />
            ) : null}

            <Animated.View
              style={[
                themed($row),
                onRight && $rowRight,
                focus
                  ? {
                      /* Fades out under the hero and in from the fold. The two
                         ranges are one interpolation, so a card cannot be
                         half-claimed by both. */
                      opacity: scrollY!.interpolate({
                        inputRange: [
                          focus.belowFold,
                          focus.entersFromFold,
                          focus.clearOfHero,
                          focus.leavesUnderHero,
                        ],
                        outputRange: [0.25, 1, 1, 0],
                        extrapolate: "clamp",
                      }),
                      transform: [
                        {
                          /* Rises the last few points as it arrives. Small
                             enough that it reads as arriving rather than as
                             moving. */
                          translateY: scrollY!.interpolate({
                            inputRange: [focus.belowFold, focus.entersFromFold],
                            outputRange: [14, 0],
                            extrapolate: "clamp",
                          }),
                        },
                      ],
                    }
                  : null,
                {
                  marginTop: index > 0 ? lift(index) : 0,
                  /* Pulls the next curve up so it begins at this marker's
                     centre, which is the other half of the same join. */
                  marginBottom: index < milestones.length - 1 ? lift(index) : 0,
                },
              ]}
              onLayout={onRowLayout(index)}
            >
              <View
                style={[
                  themed($marker),
                  { borderColor: index === 0 ? ROAD.travelled : roadAfter(milestones[index - 1]) },
                  onRight ? { marginRight: edgeOffset } : { marginLeft: edgeOffset },
                ]}
              >
                <View style={[themed($markerInner), { borderColor: ring }]}>
                  <Text
                    preset="bold"
                    text={String(index + 1).padStart(2, "0")}
                    style={[themed($markerText), { color: ring }]}
                  />
                </View>
              </View>

              <Pressable
                style={[
                  themed($card),
                  { backgroundColor: card },
                  onRight ? { marginLeft: MARKER / 2 } : { marginRight: MARKER / 2 },
                ]}
                onPress={() => setOpenId(open ? undefined : m.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${m.title}. ${m.when}`}
              >
                <View style={$cardHead}>
                  <View style={$cardBody}>
                    <Text preset="bold" text={m.title} style={themed($cardTitle)} />
                    <Text preset="formHelper" text={m.when} style={themed($cardWhen)} />
                  </View>
                  {/* The chevron turns down when the step is open. It is the
                      only thing on the card that says the card does anything,
                      so it has to change when it has. */}
                  {/* A bare chevron, not a disc.
                      The white circle behind it was a second shape on a card
                      that already has three — marker, fill, text — and it read
                      as a button, which it is not: the whole card is the
                      target. Drawn in the card's own contrast colour it says
                      "this opens" and nothing more. */}
                  <View style={$chevron}>
                    <Svg width={22} height={22}>
                      <Path
                        d={open ? "M 5 8 l 6 6 l 6 -6" : "M 8 5 l 6 6 l -6 6"}
                        stroke={theme.colors.background}
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </Svg>
                  </View>
                </View>

                {open ? (
                  <View style={themed($detail)}>
                    <Text
                      preset="default"
                      text={m.detail ?? NOTHING_MORE[m.state]}
                      style={themed($detailText)}
                    />
                    {action ? (
                      <Pressable
                        style={themed($action)}
                        onPress={action.onPress}
                        accessibilityRole="button"
                      >
                        <Text
                          preset="bold"
                          text={action.label}
                          style={[themed($actionText), { color: card }]}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            </Animated.View>
          </View>
        )
      })}
    </View>
  )
}

const $root: ViewStyle = { width: "100%" }

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  /* The card clears the marker by about a third of its diameter, which is what
     lets the road run between the two instead of the card sitting on it. */
  gap: spacing.md,
  /* Over the road rather than under it. */
  zIndex: 1,
})

const $rowRight: ViewStyle = { flexDirection: "row-reverse" }

/* A ring, not a disc: the road passes behind it, and a filled marker would cut
   the line it is meant to sit on. */
const $marker: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: MARKER,
  height: MARKER,
  borderRadius: MARKER,
  borderWidth: MARKER_RING,
  backgroundColor: colors.background,
  alignItems: "center",
  justifyContent: "center",
})

const $markerInner: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: MARKER_INNER,
  height: MARKER_INNER,
  borderRadius: MARKER_INNER,
  borderWidth: 3,
  backgroundColor: colors.background,
  alignItems: "center",
  justifyContent: "center",
})

const $markerText: ThemedStyle<TextStyle> = () => ({ fontSize: 14, lineHeight: 17 })

/* Stops half a marker short of the opposite column, so the outer swing of the
   next bend stays visible instead of being covered by the card that precedes
   it. Without this the road only shows where it happens to miss a card. */
const $card: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  /* Rounded, against this app's square-by-default rule. A card that sits on a
     curve and is read as riding along it cannot have corners the curve does
     not: the square version read as a box dropped on the road rather than as
     part of it. The rule is about controls; this is a shape on a path. */
  borderRadius: 16,
  paddingVertical: spacing.sm,
  paddingLeft: spacing.md,
  paddingRight: spacing.xs,
  gap: spacing.xs,
})

const $cardHead: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8 }

/* Divided from the title by a rule in the card's own white, at low opacity —
   a separator in any other colour would be a third colour on a card that has
   two. */
const $detail: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.xs,
  paddingRight: spacing.sm,
  paddingTop: spacing.xs,
  borderTopWidth: 1,
  borderTopColor: "rgba(255,255,255,0.32)",
})

const $detailText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.background })

const $action: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  alignSelf: "flex-start",
  backgroundColor: colors.background,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.sm,
})

const $actionText: ThemedStyle<TextStyle> = () => ({})

const $cardBody: ViewStyle = { flex: 1, gap: 1 }

/**
 * Smaller than body copy, and deliberately.
 *
 * These were set at the app's default size, which on this device is scaled 1.15
 * — so every title wrapped to two lines, each card grew to about 110pt, and six
 * of them became a wall. The reference's cards are one line of title over one
 * line of date, and that compactness is most of why the road reads as a road
 * rather than as a column of blocks with a line behind it.
 *
 * Bold stays: on a saturated card the weight is what keeps the title legible
 * against the fill, and the date below it is the thing that steps back.
 */
const $cardTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.background,
  fontSize: 15,
  lineHeight: 19,
})

const $cardWhen: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.background,
  opacity: 0.85,
  fontSize: 12,
  lineHeight: 16,
})

const $chevron: ViewStyle = { opacity: 0.75 }
