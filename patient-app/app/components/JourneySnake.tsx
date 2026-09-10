import { FC, useState } from "react"
import { LayoutChangeEvent, Pressable, TextStyle, View, ViewStyle } from "react-native"
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
   * What a step offers once it is open, if anything.
   *
   * A function rather than a field on the milestone, because what you can do
   * about a step is a fact about the screen you are on — the same care path is
   * read from Today, where a bloods request can be answered, and from Progress,
   * where it is history.
   */
  actionFor?: (milestone: Milestone) => { label: string; onPress: () => void } | undefined
}

const MARKER = 54
const MARKER_RING = 5

/** Clear space between one card and the next, which the bend has to provide. */
const ROAD_GAP = 22

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
}) {
  const { themed, theme } = useAppTheme()

  const [width, setWidth] = useState(0)
  const [heights, setHeights] = useState<number[]>([])

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

  const onRowLayout = (index: number) => (event: LayoutChangeEvent) => {
    const h = event.nativeEvent.layout.height
    setHeights((prev) => {
      if (prev[index] !== undefined && Math.abs(prev[index] - h) < 0.5) return prev
      const next = [...prev]
      next[index] = h
      return next
    })
  }

  const colourFor = (state: Milestone["state"]) =>
    state === "done" ? theme.colors.done : state === "current" ? theme.colors.asked : "#B4ADA4"

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

  /* The marker hangs half outside the content column, so the road runs under it
     rather than stopping at it. */
  const edgeOffset = width ? PATH_INSET * width - MARKER / 2 : 0

  return (
    <View style={$root} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {milestones.map((m, index) => {
        const colour = colourFor(m.state)
        const onRight = sideOf(index) === "right"
        const open = openId === m.id
        const action = open ? actionFor?.(m) : undefined

        return (
          <View key={m.id}>
            {index > 0 && width > 0 ? (
              /* The run into this step takes **this** step's colour, so the
                 road is grey from the moment it leaves the last thing that
                 happened — the change of colour lands where progress stops
                 rather than one step past it. */
              <TimelinePath
                towards={sideOf(index)}
                width={width}
                height={bendHeight(index - 1, index)}
                stroke={colour}
                strokeWidth={13}
                dashed={m.state === "ahead"}
              />
            ) : null}

            <View
              style={[
                themed($row),
                onRight && $rowRight,
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
                  { borderColor: colour },
                  onRight ? { marginRight: edgeOffset } : { marginLeft: edgeOffset },
                ]}
              >
                <Text
                  preset="bold"
                  text={String(index + 1).padStart(2, "0")}
                  style={[themed($markerText), { color: colour }]}
                />
              </View>

              <Pressable
                style={[
                  themed($card),
                  { backgroundColor: colour },
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
                  <View style={$chevron}>
                    <Svg width={30} height={30}>
                      <Path
                        d={open ? "M 9 13 l 6 6 l 6 -6" : "M 12 9 l 6 6 l -6 6"}
                        stroke={colour}
                        strokeWidth={2.5}
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
                          style={[themed($actionText), { color: colour }]}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            </View>
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
  gap: spacing.xs,
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

const $markerText: ThemedStyle<TextStyle> = () => ({ fontSize: 17, lineHeight: 20 })

/* Stops half a marker short of the opposite column, so the outer swing of the
   next bend stays visible instead of being covered by the card that precedes
   it. Without this the road only shows where it happens to miss a card. */
const $card: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
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

const $cardTitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.background })

const $cardWhen: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.background,
  opacity: 0.85,
})

const $chevron: ViewStyle = {
  width: 30,
  height: 30,
  borderRadius: 30,
  backgroundColor: "#FFFFFF",
  alignItems: "center",
  justifyContent: "center",
}
