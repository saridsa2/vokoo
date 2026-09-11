import { FC, useState } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { JourneyTimeline } from "@/components/JourneyTimeline"
import { HeadroomRibbon } from "@/components/HeadroomRibbon"
import { SymptomProfile } from "@/components/SymptomProfile"
import { HomeChart } from "@/components/HomeChart"
import { MedicineLevel } from "@/components/MedicineLevel"
import { WearableTrends } from "@/components/WearableTrends"
import { WearableGate } from "@/components/WearableGate"
import { HERO_MINT, ScreenHero } from "@/components/ScreenHero"
import { Chip, Panel } from "@/components/Panel"
import { LargeTitle, PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { MainTabScreenProps } from "@/navigators/navigationTypes"
import { TAB_OVERHANG } from "@/navigators/SarvTabBar"
import { COHORT, PASSIVE, SPIROMETRY, TACROLIMUS } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * How far along you are.
 *
 * **Deliberately not a score.** GoodRx has streaks and rewards, and they work
 * there because the user chose to track something. A transplant follow-up is not
 * a habit somebody opted into, and a broken streak on a week when a patient was
 * unwell is a punishment for being ill. So this screen counts *the programme*,
 * not the person: weeks elapsed, what has happened, what is next.
 *
 * The one number is weeks, because it is the number the clinic uses too — "six
 * weeks post-transplant" is how the recommendation behind the current request is
 * actually written.
 *
 * The timeline is the care path with its clinical vocabulary removed. Every row
 * is a real node; none of them says "node".
 */
interface ProgressScreenProps extends MainTabScreenProps<"Progress"> {}

export const ProgressScreen: FC<ProgressScreenProps> = function ProgressScreen({ navigation }) {
  const { themed, theme } = useAppTheme()

  /**
   * Each card's rail takes that card's own verdict.
   *
   * It was `theme.colors.done` on both, hardcoded — so a reading headed "Ring
   * the unit" in amber still had a green edge down its side, which is the card
   * making two claims and the quieter one being true. The components compute
   * the verdict, so they report it up rather than this screen guessing.
   */
  const [settled, setSettled] = useState<Record<string, boolean>>({})
  const railFor = (key: string) =>
    settled[key] === false ? theme.colors.expiring : theme.colors.done

  const { scrollY, scrollProps } = usePinnedHeader()

  /* Fixed in the mock. Derived from `cohort_members.joined_at` for real, which
     is why nothing here computes it from the device clock — a phone with the
     wrong date should not move a patient through their programme. */
  const weeksIn = 6

  return (
    <View style={$root}>
      <Screen
        preset="scroll"
        contentContainerStyle={themed($container)}
        ScrollViewProps={scrollProps}
      >
        {/**
         * The road is not here any more.
         *
         * Progress carried a second copy of the care path, under its own
         * heading — the same six milestones the whole of Today is built around,
         * two taps apart. A patient who has just scrolled past the road does
         * not need to be shown it again; what this screen is for is the
         * readings, which Today does not carry at all.
         */}
        <View style={themed($bleed)}>
          <ScreenHero
            title="Your readings"
            subtitle={`Week ${weeksIn} · ${COHORT.name}`}
            art={require("../../assets/images/hero-progress.png")}
          />
        </View>

        {/**
         * The charts come before the timeline, and that ordering is the argument
         * of the screen.
         *
         * A milestone list is a plan — it is the same for everybody on this
         * programme and it does not change from one week to the next. The morning
         * blow is *this patient's* week, it changes daily, and it is the thing a
         * transplant recipient is actually watching. Putting the plan first would
         * make them scroll past everyone's schedule to reach their own numbers.
         */}
        {/* Opens the long view: Month / 6 months / Year in percent of baseline.
            The card is the fortnight; the screen behind it is the drift, which
            is the question a fortnight cannot be asked. */}
        <Panel
          accent={railFor(SPIROMETRY.key)}
          onPress={() => navigation.navigate("MetricDetail", { metricKey: SPIROMETRY.key })}
        >
          <HeadroomRibbon
            series={SPIROMETRY}
            onVerdict={(ok) => setSettled((p) => (p[SPIROMETRY.key] === ok ? p : { ...p, [SPIROMETRY.key]: ok }))}
          />
        </Panel>

        <Panel
          accent={railFor(TACROLIMUS.key)}
          onPress={() => navigation.navigate("MetricDetail", { metricKey: TACROLIMUS.key })}
        >
          <MedicineLevel
            series={TACROLIMUS}
            onVerdict={(ok) => setSettled((p) => (p[TACROLIMUS.key] === ok ? p : { ...p, [TACROLIMUS.key]: ok }))}
          />
        </Panel>

        {/**
         * What arrives without being asked for, kept apart from what is.
         *
         * Under its own heading and below the two the patient sends, because
         * mixing them would blur the one distinction that matters here: the
         * charts above are things they did, and these are things that happened.
         * A patient who reads a sleep chart as a task has been given a job by a
         * clinic that never set one.
         */}
        {/**
         * One row each, not one chart each, and no heading over them.
         *
         * These are the numbers nobody asked the patient for — a wearable
         * reported them. Given the same treatment as the morning blow they read
         * as three more things to keep up with; as compact metrics they read as
         * what they are, which is context.
         *
         * "From your wearable" sat above the card and earned nothing: a moon, a
         * heart and a pair of footprints already say where these came from, and
         * a heading that only restates its own contents is a line of furniture.
         *
         * Rings rather than rows, because a ring answers "how much of today is
         * done" without a number — which is the weight a reading nobody asked
         * for deserves.
         */}
        {/* The rings only exist once a wearable does. Everything about *not*
            having one — never asked, refused, no health store at all — is five
            different screens, and the gate is where they live. */}
        {/* The six domains the weekly request asks about. Not a measurement
            over time, so it does not belong with the two cards above it — six
            things at one moment is a different question and gets a different
            shape. */}
        <SymptomProfile />

        <WearableGate>
          <WearableTrends
            series={PASSIVE}
            onOpen={(metricKey) => navigation.navigate("MetricDetail", { metricKey })}
          />
        </WearableGate>
      </Screen>

      {/* The weeks figure follows the title up: on a screen of charts it is the
          one number that says which patient's week this is. */}
      <PinnedHeader
        title="Your readings"
        scrollY={scrollY}
        background={HERO_MINT}
        right={<Chip tone="done" text={`Week ${weeksIn}`} />}
      />
    </View>
  )
}

const $bleed: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginHorizontal: -spacing.lg,
  marginTop: -spacing.lg,
  marginBottom: spacing.xs,
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

const $root: ViewStyle = { flex: 1 }

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  letterSpacing: 0.8,
})

const $figureRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.md,
})

/* Tabular figures, so a two-digit week does not shift the sentence beside it. */
const $figure: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.asked,
  fontVariant: ["tabular-nums"],
})

const $figureBody: ViewStyle = { flex: 1, gap: 2 }

const $track: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  height: 6,
  backgroundColor: colors.palette.neutral400,
  marginTop: spacing.xs,
})

const $trackFill: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 6,
  backgroundColor: colors.asked,
})
