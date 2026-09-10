import { FC } from "react"
import { Linking, TextStyle, View, ViewStyle } from "react-native"

import { Glyph, Pip } from "@/components/Glyph"
import { Chip, NavRow, Panel, SectionHeading } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { LargeTitle, PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { MainTabScreenProps } from "@/navigators/navigationTypes"
import { TAB_OVERHANG } from "@/navigators/SarvTabBar"
import { CARE_TEAM, PROVIDER, RING_IF, THREAD, UNIT_PHONE } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * Reaching a person.
 *
 * **The emergency line comes first and is never a form.** A patient with a fever
 * at eleven at night must not be composing a message. So the top of this screen
 * is one phone number, said plainly, with the three symptoms that mean *ring,
 * do not type* printed beside it. Messaging is below that, deliberately second.
 *
 * The number opens the dialler rather than dialling. Placing a call from under
 * somebody's thumb is not a decision an app gets to make.
 *
 * **Online means a SIP registration, not employment.** The console already
 * learned this distinction the hard way — an agent's `status` is active or
 * suspended, which is a contract; availability is whether their handset is
 * registered right now. Only the second one is any use to a patient, so only
 * the second one is shown, and it is worded as *at the desk today* rather than
 * as a green "online" dot that implies an instant reply.
 */
interface CareTeamScreenProps extends MainTabScreenProps<"CareTeam"> {}

export const CareTeamScreen: FC<CareTeamScreenProps> = function CareTeamScreen({ navigation }) {
  const { themed, theme } = useAppTheme()
  const { scrollY, scrollProps } = usePinnedHeader()
  const unread = 0
  const onDuty = CARE_TEAM.filter((m) => m.available).length

  return (
    <View style={$root}>
      <Screen
        preset="scroll"
        contentContainerStyle={themed($container)}
        safeAreaEdges={["top"]}
        ScrollViewProps={scrollProps}
      >
        <LargeTitle title="Your care team" subtitle={`${PROVIDER.from}, ${PROVIDER.city}`} />

        <Panel accent={theme.colors.error}>
          <Text preset="formHelper" text="IF SOMETHING IS WRONG NOW" style={themed($label)} />
          <Text
            preset="default"
            text="Ring the unit — do not send a message — if:"
            style={themed($body)}
          />
          {/* A list rather than a sentence, because somebody frightened at
            eleven at night reads down a list and does not read a paragraph.
            The items come from the same file the charts do, so the threshold
            in the last one and the dashed line on the chart cannot drift. */}
          {RING_IF.map((sign) => (
            <View key={sign} style={themed($signRow)}>
              <Text preset="bold" text="·" style={themed($body)} />
              <Text preset="default" text={sign} style={[themed($body), $signText]} />
            </View>
          ))}
          <PillButton
            text={UNIT_PHONE}
            onPress={() => Linking.openURL(`tel:${UNIT_PHONE.replace(/\s/g, "")}`)}
            icon={<Glyph name="phone" size={18} color={theme.colors.palette.neutral100} />}
          />
          <Text
            preset="formHelper"
            text={`Answered 24 hours. Say you are a transplant patient at ${PROVIDER.name.split(" ")[0]}.`}
            style={themed($subtitle)}
          />
        </Panel>

        <SectionHeading text="Messages" />
        <Panel onPress={() => navigation.navigate("MessageThread")}>
          <NavRow
            title={PROVIDER.from}
            subtitle={
              unread > 0
                ? `${unread} new`
                : THREAD.length > 0
                  ? `${THREAD[THREAD.length - 1].author}: ${THREAD[THREAD.length - 1].body.slice(0, 44)}…`
                  : "No messages yet"
            }
            left={<Glyph name="message" size={22} color={theme.colors.textDim} />}
            onPress={() => navigation.navigate("MessageThread")}
            last
          />
        </Panel>
        <Text
          preset="formHelper"
          text="Messages are read during clinic hours, Monday to Saturday. They are not the way to reach anyone urgently."
          style={themed($subtitle)}
        />

        <SectionHeading text="Who is looking after you" />
        <Panel>
          {CARE_TEAM.map((member, i) => (
            <NavRow
              key={member.id}
              title={member.name}
              subtitle={member.role}
              last={i === CARE_TEAM.length - 1}
              right={
                <View style={themed($presence)}>
                  <Pip
                    color={member.available ? theme.colors.done : theme.colors.palette.neutral400}
                  />
                  <Text
                    preset="formHelper"
                    text={member.available ? "At the desk today" : "Away"}
                    style={themed($subtitle)}
                  />
                </View>
              }
            />
          ))}
        </Panel>
      </Screen>

      {/* Who is reachable, not who is employed — the distinction this screen is
          built on, carried into the bar. */}
      <PinnedHeader
        title="Your care team"
        scrollY={scrollY}
        right={<Chip tone={onDuty ? "done" : "neutral"} text={`${onDuty} at the desk`} />}
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

const $signRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.xs,
  paddingLeft: spacing.xxs,
})

const $signText: TextStyle = { flex: 1 }

const $presence: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
})
