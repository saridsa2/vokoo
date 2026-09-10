import { FC } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { JourneyTimeline } from "@/components/JourneyTimeline"
import { HomeChart } from "@/components/HomeChart"
import { Chip, Panel, SectionHeading } from "@/components/Panel"
import { LargeTitle, PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { MainTabScreenProps } from "@/navigators/navigationTypes"
import { TAB_OVERHANG } from "@/navigators/SarvTabBar"
import { COHORT, MILESTONES, PASSIVE, SPIROMETRY, TACROLIMUS } from "@/services/mock/careData"
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

  const { scrollY, scrollProps } = usePinnedHeader()

  /* Fixed in the mock. Derived from `cohort_members.joined_at` for real, which
     is why nothing here computes it from the device clock — a phone with the
     wrong date should not move a patient through their programme. */
  const weeksIn = 6
  const current = MILESTONES.find((m) => m.state === "current")

  return (
    <View style={$root}>
      <Screen
        preset="scroll"
        contentContainerStyle={themed($container)}
        safeAreaEdges={["top"]}
        ScrollViewProps={scrollProps}
      >
        <LargeTitle title="Where you are" subtitle={COHORT.name} />

        <Panel accent={theme.colors.asked}>
          <View style={themed($figureRow)}>
            <Text preset="heading" text={String(weeksIn)} style={themed($figure)} />
            <View style={$figureBody}>
              <Text preset="subheading" text="weeks since your transplant" style={themed($body)} />
              <Text
                preset="formHelper"
                text={`Started ${COHORT.startedOn}${COHORT.weeks ? ` · ${COHORT.weeks} weeks in the programme` : ""}`}
                style={themed($subtitle)}
              />
            </View>
          </View>
          {/* A bar, not a ring. A ring implies completion is the goal; this is
            elapsed time in a year of follow-up, and that is all it claims. */}
          <View style={themed($track)}>
            <View
              style={[
                themed($trackFill),
                { width: `${Math.min(100, (weeksIn / (COHORT.weeks ?? 52)) * 100)}%` },
              ]}
            />
          </View>
        </Panel>

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
        <Panel accent={theme.colors.asked}>
          <HomeChart series={SPIROMETRY} />
        </Panel>

        <Panel accent={theme.colors.done}>
          <HomeChart series={TACROLIMUS} />
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
        <SectionHeading text="From your watch" />
        {PASSIVE.map((series) => (
          <Panel key={series.key}>
            <HomeChart series={series} height={104} />
          </Panel>
        ))}

        {current && (
          <Panel>
            <Text preset="formHelper" text="NEXT" style={themed($label)} />
            <Text preset="subheading" text={current.title} style={themed($body)} />
            <Text preset="default" text={current.when} style={themed($subtitle)} />
            {current.detail ? (
              <Text preset="formHelper" text={current.detail} style={themed($subtitle)} />
            ) : null}
          </Panel>
        )}

        <SectionHeading
          text="Your journey"
          action={{ text: "Details", onPress: () => navigation.navigate("Cohort") }}
        />
        <Panel>
          <JourneyTimeline milestones={MILESTONES} />
        </Panel>
      </Screen>

      {/* The weeks figure follows the title up: on a screen of charts it is the
          one number that says which patient's week this is. */}
      <PinnedHeader
        title="Where you are"
        scrollY={scrollY}
        right={<Chip tone="asked" text={`Week ${weeksIn}`} />}
      />
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
  /* Clears the raised Sarv square, so the last card is never trapped under it. */
  paddingBottom: spacing.xxl + TAB_OVERHANG,
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
