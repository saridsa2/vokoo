import { FC } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { Chip, Panel } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { LargeTitle, PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
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
        safeAreaEdges={["top"]}
        ScrollViewProps={scrollProps}
      >
        <LargeTitle
          title="What you have sent"
          subtitle={`Your care team at ${PROVIDER.name.split(" ")[0]} can see all of these. Nobody else can.`}
        />

        <PillButton
          text="Send something now"
          variant="secondary"
          icon={<Glyph name="camera" size={18} color={theme.colors.text} />}
        />

        {REPORTS.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}

        <Text
          preset="formHelper"
          text="Reports stay here for as long as your hospital keeps them. Ask the unit if you want a copy removed."
          style={themed($footnote)}
        />
      </Screen>

      {/* What is still with the unit — the one thing a patient checks this
          screen for after sending something. */}
      <PinnedHeader
        title="What you have sent"
        scrollY={scrollY}
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
          <Text preset="default" text={report.title} style={themed($body)} />
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
