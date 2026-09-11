import { FC } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { Chip, Panel } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { LargeTitle, PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
import { HERO_MINT, ScreenHero } from "@/components/ScreenHero"
import { Text } from "@/components/Text"
import type { MainTabScreenProps } from "@/navigators/navigationTypes"
import { TAB_OVERHANG } from "@/navigators/SarvTabBar"
import { PROVIDER, REPORTS, type Report } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * Everything you have sent, and what happened to it.
 *
 * **The second column is the point.** A list of uploads is a filing cabinet; a
 * patient does not want a filing cabinet, they want to know whether anyone read
 * it. So every row carries a state — waiting, read, or came back — and a read
 * one carries what the clinician actually said. That is the difference between
 * an app that stores documents and one that closes a loop.
 *
 * `pending` is worded as *waiting to be read* rather than "pending", because
 * pending sounds like something the patient must do and it is not: the ball is
 * with the unit.
 *
 * Uploading from here is allowed even with nothing asked — a patient who has a
 * report in their hand should never be told to wait for a request. It arrives as
 * an unsolicited document and the coordinator sees it the same way.
 */
interface ReportsScreenProps extends MainTabScreenProps<"Reports"> {}

export const ReportsScreen: FC<ReportsScreenProps> = function ReportsScreen(_props) {
  const { themed, theme } = useAppTheme()
  const { scrollY, scrollProps } = usePinnedHeader()
  const waiting = REPORTS.filter((r) => r.state === "pending").length

  return (
    <View style={$root}>
      <Screen
        preset="scroll"
        contentContainerStyle={themed($container)}
        ScrollViewProps={scrollProps}
      >
        <View style={themed($bleed)}>
          <ScreenHero
            title="Reports"
            art={require("../../assets/images/hero-reports.png")}
          />
        </View>

        <PillButton
          text="Send something now"
          variant="secondary"
          icon={<Glyph name="camera" size={18} color={theme.colors.text} />}
        />

        {REPORTS.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </Screen>

      {/* What is still with the unit — the one thing a patient checks this
          screen for after sending something. */}
      <PinnedHeader
        title="Reports"
        scrollY={scrollY}
        background={HERO_MINT}
        right={
          waiting > 0 ? <Chip text={`${waiting} waiting`} /> : <Chip tone="done" text="All read" />
        }
      />
    </View>
  )
}

const ReportCard: FC<{ report: Report }> = function ReportCard({ report }) {
  const { themed, theme } = useAppTheme()

  const state = {
    pending: { tone: "neutral" as const, text: "Waiting to be read" },
    reviewed: { tone: "done" as const, text: "Read by your team" },
    rejected: { tone: "error" as const, text: "Needs another look" },
  }[report.state]

  return (
    <Panel accent={report.state === "reviewed" ? theme.colors.done : undefined}>
      <View style={themed($row)}>
        <Glyph name="reports" size={22} color={theme.colors.textDim} />
        <View style={$rowBody}>
          <Text preset="bold" text={report.title} style={themed($cardTitle)} />
          <Text
            preset="formHelper"
            text={`Sent ${report.sentOn} · ${report.pages} page${report.pages === 1 ? "" : "s"}`}
            style={themed($subtitle)}
          />
        </View>
      </View>

      <Chip tone={state.tone} text={state.text} />

      {/* The reply, when there is one. Quoted as the clinician wrote it and
          attributed — a patient should be able to tell a sentence from a person
          apart from a sentence from software. */}
      {report.note ? (
        <View style={themed($note)}>
          <Text preset="default" text={report.note} style={themed($noteText)} />
        </View>
      ) : null}
    </Panel>
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

/**
 * 15 over 12, matching every other list in the app.
 *
 * A report's name and the line under it saying when it was sent were both at
 * body scale, so a card read as two equal sentences with a chip beneath. The
 * name is the thing being looked for; the date is how you tell two of them
 * apart once you have found it.
 */
const $cardTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontSize: 15,
  lineHeight: 19,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 12,
  lineHeight: 16,
})

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
})

const $rowBody: ViewStyle = { flex: 1, gap: 2 }

const $note: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.doneBackground,
  padding: spacing.sm,
})

const $noteText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $footnote: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  marginTop: spacing.sm,
})
