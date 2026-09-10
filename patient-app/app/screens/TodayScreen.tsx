import { FC } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { JourneySnake } from "@/components/JourneySnake"
import { Chip, NavRow, Panel, SectionHeading } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { LargeTitle, PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
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
  const { themed } = useAppTheme()
  const { scrollY, scrollProps } = usePinnedHeader()

  const todo =
    OPEN_REQUESTS.length === 0
      ? "Nothing needed right now."
      : OPEN_REQUESTS.length === 1
        ? "One thing to do."
        : `${OPEN_REQUESTS.length} things to do.`

  return (
    <View style={$root}>
      <Screen
        preset="scroll"
        contentContainerStyle={themed($container)}
        safeAreaEdges={["top"]}
        ScrollViewProps={scrollProps}
      >
        {/* Their name, not "Dashboard". The first line should sound like it came
            from the clinic, because it did. */}
        <LargeTitle title={`Namaste, ${PATIENT.firstName}`} subtitle={todo} />

        {OPEN_REQUESTS.length === 0 ? (
          <Settled />
        ) : (
          OPEN_REQUESTS.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onOpen={() => navigation.navigate("RequestDetail", { requestId: request.id })}
            />
          ))
        )}

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
         */}
        <SectionHeading text="Your journey" />
        <JourneySnake
          milestones={MILESTONES}
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

        {/* The cohort, one row, under the road it belongs to. */}
        <Panel onPress={() => navigation.navigate("Cohort")}>
          <NavRow
            title={COHORT.name}
            subtitle={COHORT.provider}
            onPress={() => navigation.navigate("Cohort")}
            last
          />
        </Panel>
      </Screen>

      {/* Last, so it paints over the scroll. The compact bar carries the count
          the large subtitle was carrying, so nothing is lost when it goes. */}
      <PinnedHeader
        title={`Namaste, ${PATIENT.firstName}`}
        scrollY={scrollY}
        right={<Chip tone={OPEN_REQUESTS.length ? "asked" : "done"} text={todo} />}
      />
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
          text="We will message you when something is due. You do not need to check."
          style={themed($settledBody)}
        />
      </View>
    </Panel>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
  /* Clears the raised Sarv square, so the last card is never trapped under it. */
  paddingBottom: spacing.xxl + TAB_OVERHANG,
  gap: spacing.md,
})

/* The pinned bar is absolute, so it needs a positioned parent that fills the
   screen — the Screen component owns its own layout and cannot be that. */
const $root: ViewStyle = { flex: 1 }

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
