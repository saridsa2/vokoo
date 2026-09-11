import { FC, useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  ScrollView,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native"

import { Glyph } from "@/components/Glyph"
import { HERO_MINT, ScreenHero } from "@/components/ScreenHero"
import { JourneySnake } from "@/components/JourneySnake"
import { Chip, NavRow, Panel, SectionHeading } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { MainTabScreenProps } from "@/navigators/navigationTypes"
import { TAB_OVERHANG } from "@/navigators/SarvTabBar"
import {
  COHORT,
  MILESTONES,
  OPEN_REQUESTS,
  PATIENT,
  type OutreachRequest,
} from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * What the clinic has asked of you.
 *
 * **The inversion that matters.** GoodRx opens on a search box and a medicine
 * cabinet the patient curates — they decide what to track. This opens on a list
 * the care path decided. So there is no search, nothing to add, and no way to
 * dismiss an item: the list is `care_path_outreach`, and the buttons resolve a
 * row rather than hiding it.
 *
 * `outreach.request` leaves by exactly four outcomes —
 *
 *     fulfilled · declined · expired · failed
 *
 * — and the card offers the first two. `expired` is what happens when nobody
 * presses either, which is why the days left are on the card and not buried.
 * `failed` is ours, not the patient's, and never appears here.
 *
 * **The empty state is the good state.** Most patients on most days have nothing
 * to do, and the screen should say so rather than look broken.
 */
interface TodayScreenProps extends MainTabScreenProps<"Today"> {}

export const TodayScreen: FC<TodayScreenProps> = function TodayScreen({ navigation }) {
  const { themed, theme } = useAppTheme()
  const scrollRef = useRef<ScrollView>(null)
  const [scrollY] = useState(() => new Animated.Value(0))
  const { height: windowHeight } = useWindowDimensions()

  /* Measured, not assumed: the band's height comes from the picture inside it. */
  const [heroMax, setHeroMax] = useState(0)

  /**
   * Where the scroll stops, which the road needs.
   *
   * A card's arrival is measured by how far it has risen, and the last few can
   * never rise far enough — the content ends first — so they would sit
   * permanently part-faded. The road finishes their fade here instead.
   */
  const [contentHeight, setContentHeight] = useState(0)
  const [viewHeight, setViewHeight] = useState(0)
  const maxScroll = Math.max(0, contentHeight - viewHeight)
  /* Where the road begins in the scrolled content, and where each of its rows
     begins within the road. Two measurements, because the road reports positions
     relative to itself. */
  const [roadTop, setRoadTop] = useState(0)
  const [rowTops, setRowTops] = useState<number[]>([])

  /**
   * Where the road opens: the last step already behind them.
   *
   * Not the current step — starting there would put the thing just finished off
   * screen, and the first question on opening an app six weeks after a
   * transplant is *where am I*, which needs one step of context behind it to
   * answer.
   */
  const openAt = useMemo(() => {
    if (!roadTop || rowTops.length === 0) return undefined
    const current = MILESTONES.findIndex((m) => m.state === "current")
    const lastDone = Math.max(0, (current === -1 ? MILESTONES.length : current) - 1)
    const top = rowTops[lastDone]
    if (top === undefined) return undefined
    return Math.max(0, roadTop + top - HERO_MIN - 12)
  }, [roadTop, rowTops])

  /* Once, and without animation — a screen that visibly scrolls itself on open
     reads as a bug rather than as a starting position. */
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || openAt === undefined) return
    opened.current = true
    scrollRef.current?.scrollTo({ y: openAt, animated: false })
  }, [openAt])

  /**
   * The band's height, and what fades inside it.
   *
   * Measured from `openAt`, so the hero is full height at the position the
   * screen opens in and collapses only as the reader goes further.
   */
  const from = openAt ?? 0
  const heroHeight =
    heroMax === 0
      ? undefined
      : scrollY.interpolate({
          inputRange: [from, from + COLLAPSE_OVER],
          outputRange: [heroMax, HERO_MIN],
          extrapolate: "clamp",
        })
  const detailOpacity = scrollY.interpolate({
    inputRange: [from, from + COLLAPSE_OVER * 0.6],
    outputRange: [1, 0],
    extrapolate: "clamp",
  })

  /* One progress value the band sizes everything from, so the height and its
     contents cannot disagree about how far along the collapse is. */
  const collapse = scrollY.interpolate({
    inputRange: [from, from + COLLAPSE_OVER],
    outputRange: [0, 1],
    extrapolate: "clamp",
  })

  /**
   * Fixed in the mock, and derived from `cohort_members.joined_at` for real —
   * which is why nothing here computes it from the device clock. A phone with
   * the wrong date should not move a patient through their programme.
   */
  const weeksIn = 6

  /* Not a count. It sat directly above the list it was counting, so the number
     was the one thing the reader could already see. The empty case still says
     something, because an absent list says nothing on its own. */
  const todo = OPEN_REQUESTS.length === 0 ? "Nothing needed right now" : "To do"

  return (
    <View style={$root}>
      {/**
       * Not the `Screen` component, and that is the whole reason this screen is
       * shaped differently from the other four.
       *
       * `Screen` owns its own scroll ref — it needs one for keyboard avoidance
       * and for tab-press-to-top — and a ref cannot be handed through props. To
       * open the road at *today* rather than at the beginning, this screen has
       * to scroll itself on mount, so it owns the ScrollView. Today has no text
       * inputs, so nothing of `Screen`'s is missed.
       */}
      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={[themed($container), { paddingTop: heroMax }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
        onLayout={(e) => setViewHeight(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setContentHeight(h)}
      >
        {/**
         * The road, and it is the body of the screen rather than a link to one.
         *
         * What a patient six weeks out of a transplant wants first is *where am
         * I* — the answer to which is a shape, not a sentence. The requests
         * above it are what is being asked of them today; this is why. A row
         * saying "Your programme" made the second question a navigation.
         *
         * Steps open in place rather than pushing a screen. Opening a step is
         * reading, not going somewhere: sending the reader to a new screen to
         * learn one sentence loses the road they were reading it on.
         *
         * **It runs straight on from the picture, above today's requests.**
         * The picture draws a road and the road continues it — putting a list
         * of tasks between the two breaks the one thing the illustration is
         * there to say. What is being asked of the patient today follows, which
         * is also the right order to read them in: where am I, then what now.
         */}
        <View onLayout={(e) => setRoadTop(e.nativeEvent.layout.y)}>
          <JourneySnake
            milestones={MILESTONES}
            scrollY={scrollY}
            /**
             * `roadTop`, and **not** `heroMax + roadTop`.
             *
             * The hero's height is the content container's `paddingTop`, and a
             * child's measured `y` is taken from the container's origin *with
             * the padding included* — so `roadTop` already carries it. Adding
             * it again put every row's notional position about 300pt too far
             * down, which pushed all six past the "below the fold" threshold at
             * once: the cards faded out and left the bare road behind them.
             */
            offsetTop={roadTop}
            /* Cards resolve below the collapsed hero and dissolve above the tab
               bar — the two edges of what is actually readable. */
            focusWindow={{ top: HERO_MIN, bottom: windowHeight - TAB_OVERHANG - 64 }}
            maxScroll={maxScroll || undefined}
            onRowsMeasured={setRowTops}
          actionFor={(m) => {
            /* Only the step the clinic is currently waiting on has something to
               press, and only while a request is actually open — an action on a
               finished step would be a button that does nothing. */
            if (m.state !== "current") return undefined
            const request = OPEN_REQUESTS[0]
            if (!request) return undefined
            return {
              label: "Open what is needed",
              onPress: () => navigation.navigate("RequestDetail", { requestId: request.id }),
            }
          }}
          />
        </View>


        {/**
         * Three things to do, as three rows — not three essays.
         *
         * Each was a full card: a source line, a heading, a paragraph of
         * instructions and two buttons. Three of those stacked is roughly a
         * screen and a half of prose on the one screen a patient opens to find
         * out what is being asked of them, and the answer to "what do I have to
         * do today" should be readable without scrolling or reading.
         *
         * **Nothing is lost by compacting.** `RequestDetailScreen` already
         * carries the instructions, why it was asked, who asked, and both
         * outcomes — the card was a second copy of it. The row is the index;
         * the screen is the thing.
         *
         * Grouped in one card with hairlines rather than three separate cards,
         * because they are one list of one kind of thing. Three cards read as
         * three unrelated announcements.
         */}
        <SectionHeading text={todo} />

        {OPEN_REQUESTS.length === 0 ? (
          <Settled />
        ) : (
          <Panel style={themed($taskGroup)}>
            {OPEN_REQUESTS.map((request, index) => (
              <NavRow
                key={request.id}
                left={<TaskIcon request={request} />}
                title={request.what}
                /**
                 * The deadline is a pill, not a line of prose.
                 *
                 * It is the fact that decides whether a row is read now or
                 * later, and as a subtitle it read at the same weight as the
                 * clinic's name beside it — three rows all starting with the
                 * same six words. A pill is scanned rather than read, which is
                 * what a deadline down a list of three wants to be.
                 *
                 * It takes the chevron's place. The rows are visibly a list and
                 * the whole row is pressable; a pill *and* a chevron is two
                 * pieces of chrome for one row, and the pill is the one
                 * carrying information.
                 */
                right={
                  <Chip
                    tone={request.daysLeft <= 1 ? "expiring" : "neutral"}
                    text={dueText(request)}
                  />
                }
                onPress={() => navigation.navigate("RequestDetail", { requestId: request.id })}
                last={index === OPEN_REQUESTS.length - 1}
              />
            ))}
          </Panel>
        )}

        {/* The cohort, one row, under the road it belongs to. */}
        <Panel onPress={() => navigation.navigate("Cohort")}>
          <NavRow
            title={COHORT.name}
            subtitle={COHORT.provider}
            onPress={() => navigation.navigate("Cohort")}
            last
          />
        </Panel>
      </Animated.ScrollView>

      {/**
       * The hero, out of the scroll and over it.
       *
       * This is what "behind the hero" has to mean physically: the completed
       * steps are laid out where they always were, and the hero occludes them.
       * Inside the scroll it would simply move away and reveal them.
       *
       * It collapses to a bar as you go — a 300pt band that never moved would
       * hold 40% of the phone against a screen whose job is the road — and the
       * collapse is measured from `openAt` rather than from zero, because the
       * screen *opens* mid-scroll. Tied to raw offset it would render already
       * collapsed on the first frame.
       *
       * `PinnedHeader` is gone from this screen: the collapsed hero is the
       * pinned header. Two things doing that job would have fought over the
       * same forty points.
       */}
      <Animated.View
        style={[$heroSlot, { height: heroHeight }]}
        /* The height is read here and not inside the updater: React Native
           recycles a layout event as soon as the handler returns, so a
           functional `setState` that reaches for `e.nativeEvent` runs after it
           has been nulled. That is what "Cannot read property 'layout' of null"
           was. */
        onLayout={(e) => {
          const measured = e.nativeEvent.layout.height
          setHeroMax((current) => current || measured)
        }}
      >
        <ScreenHero
          title={`Namaste, ${PATIENT.firstName}`}
          art={require("../../assets/images/journey-hero.png")}
          collapse={collapse}
          footer={
            <Animated.View style={[themed($weeks), { opacity: detailOpacity }]}>
              <Text
                preset="formHelper"
                text={`Week ${weeksIn} of ${COHORT.weeks ?? 52}`}
                style={themed($weeksText)}
              />
              {/* A bar, not a ring. A ring implies completion is the goal;
                  this is elapsed time in a year of follow-up. */}
              <View style={themed($track)}>
                <View
                  style={[
                    themed($trackFill),
                    { width: `${Math.min(100, (weeksIn / (COHORT.weeks ?? 52)) * 100)}%` },
                  ]}
                />
              </View>
            </Animated.View>
          }
        />
      </Animated.View>
    </View>
  )
}

const RequestCard: FC<{ request: OutreachRequest; onOpen: () => void }> = function RequestCard({
  request,
  onOpen,
}) {
  const { themed, theme } = useAppTheme()
  /* The accent appears on the last day and nowhere else. A card that is always
     coloured has stopped signalling — the console spends ink on exactly one bar
     per chart for the same reason. */
  const urgent = request.daysLeft <= 1

  return (
    <Panel accent={urgent ? theme.colors.expiring : theme.colors.asked}>
      <View style={themed($cardHead)}>
        <Text preset="formHelper" text={request.from} style={themed($from)} />
        <Chip
          tone={urgent ? "expiring" : "neutral"}
          text={
            request.daysLeft === 0
              ? "Today"
              : request.daysLeft === 1
                ? "Tomorrow"
                : `${request.daysLeft} days left`
          }
        />
      </View>

      <Text preset="subheading" text={request.what} style={themed($what)} />
      <Text preset="default" text={request.instructions} style={themed($instructions)} />

      {/* Two answers, thumb-sized, and nothing else: GoodRx's Missed / Taken
          pair, which maps onto `declined` / `fulfilled`. The affirmative is on
          the right, where the thumb rests. */}
      <View style={themed($actions)}>
        <PillButton text="Not yet" variant="secondary" onPress={onOpen} />
        {/* The label says the action, not the abstraction. "Answer" on a
            spirometry reading would leave a patient wondering what the question
            was — there isn't one, there is a number on a device in their hand. */}
        <PillButton
          text={
            request.kind === "document"
              ? "Send photo"
              : request.kind === "measurement"
                ? "Enter it"
                : "Answer"
          }
          onPress={onOpen}
          icon={
            request.kind === "document" ? (
              <Glyph name="camera" size={18} color={theme.colors.palette.neutral100} />
            ) : undefined
          }
        />
      </View>
    </Panel>
  )
}

/** Nothing due. Said as reassurance, because that is what it is. */
const Settled: FC = function Settled() {
  const { themed, theme } = useAppTheme()
  return (
    <Panel>
      <View style={themed($settled)}>
        <Glyph name="check" size={32} color={theme.colors.done} />
        <Text preset="subheading" text="Nothing needed right now" style={themed($what)} />
        <Text
          preset="default"
          /* "You do not need to check" was the app talking about itself. The
           first half is the fact; the second was reassurance about the
           first. */
        text="We will message you when something is due."
          style={themed($settledBody)}
        />
      </View>
    </Panel>
  )
}

const $weeks: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.xxs,
  marginTop: spacing.xs,
})

const $weeksText: ThemedStyle<TextStyle> = () => ({ color: "#3C4A40" })

const $bleed: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginHorizontal: -spacing.lg,
  marginTop: -spacing.lg,
  marginBottom: spacing.xs,
})

/** How long is left, in the words the detail screen already uses. */
function dueText(request: OutreachRequest) {
  if (request.daysLeft <= 0) return "Today"
  if (request.daysLeft === 1) return "Last day"
  return `${request.daysLeft} days left`
}

/**
 * The mark on a task row.
 *
 * Keyed on `kind`, which is what actually decides how the patient answers —
 * so the picture and the screen it opens can never disagree. It turns amber on
 * the last day: on a row that is otherwise all one colour, the thing running
 * out should be the thing that changes.
 */
const TaskIcon: FC<{ request: OutreachRequest }> = function TaskIcon({ request }) {
  const { themed, theme } = useAppTheme()
  const urgent = request.daysLeft <= 1
  const name = request.kind === "measurement" ? "breath" : request.kind === "questions" ? "message" : "camera"
  const tint = urgent ? theme.colors.expiring : theme.colors.done
  return (
    <View
      style={[
        themed($taskIcon),
        { backgroundColor: urgent ? theme.colors.expiringBackground : theme.colors.doneBackground },
      ]}
    >
      <Glyph name={name} size={17} color={tint} />
    </View>
  )
}

/**
 * Only the *vertical* padding goes.
 *
 * Zeroing both put the icons hard against the card's edge — the rows carry no
 * side padding of their own, so the card's was the only thing holding them off
 * it. Keeping it insets the hairlines from both edges too, which is what a
 * grouped list is supposed to look like.
 */
const $taskGroup: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: 0,
  /* Tighter than a normal panel. A row is an icon, two short lines and a
     chevron; at the panel's usual 24 each side the title column was narrow
     enough to wrap every one of them. */
  paddingHorizontal: spacing.md,
  gap: 0,
})

const $taskIcon: ThemedStyle<ViewStyle> = () => ({
  width: 34,
  height: 34,
  borderRadius: 34,
  alignItems: "center",
  justifyContent: "center",
})

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
  /**
   * Clears the raised Sarv square, and nothing more.
   *
   * It was `spacing.xxl + TAB_OVERHANG` — 80pt — on a scene that is not
   * overlaid by the bar at all: React Navigation lays the bar below it, so the
   * only thing reaching into the scene is the square, by `TAB_OVERHANG`. The
   * extra 48 was a second clearance for a bar that was never in the way, and it
   * left a dead band under the last card on every tab.
   */
  paddingBottom: TAB_OVERHANG + 5,
  gap: spacing.md,
})

/* The pinned bar is absolute, so it needs a positioned parent that fills the
   screen — the Screen component owns its own layout and cannot be that. */
/** The collapsed band: a safe-area inset and one line of greeting. */
const HERO_MIN = 92

/** How far the reader travels for the band to give up its picture. */
const COLLAPSE_OVER = 180

const $root: ViewStyle = { flex: 1 }

/* Over the scroll, not in it. Everything the road does depends on this. */
const $heroSlot: ViewStyle = {
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  overflow: "hidden",
  zIndex: 2,
}

const $cardHead: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
})

const $from: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $what: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $instructions: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $actions: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.sm,
  marginTop: spacing.xs,
})

const $settled: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  gap: spacing.xs,
  paddingVertical: spacing.md,
})

const $settledBody: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
})

const $figureRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.md,
})

/* Tabular figures, so a two-digit week does not shift the sentence beside it. */
const $figure: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.done,
  fontVariant: ["tabular-nums"],
})

const $figureBody: ViewStyle = { flex: 1, gap: 2 }

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $track: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  height: 6,
  backgroundColor: colors.palette.neutral400,
  marginTop: spacing.xs,
})

const $trackFill: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 6,
  backgroundColor: colors.done,
})
