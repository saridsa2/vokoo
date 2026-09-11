import { FC } from "react"
import { Linking, TextStyle, View, ViewStyle } from "react-native"

import { Glyph, Pip } from "@/components/Glyph"
import { Chip, NavRow, Panel, SectionHeading } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { LargeTitle, PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
import { HERO_MINT, ScreenHero } from "@/components/ScreenHero"
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
        ScrollViewProps={scrollProps}
      >
        <View style={themed($bleed)}>
          <ScreenHero
            title="Your care team"
            subtitle={`${PROVIDER.from}, ${PROVIDER.city}`}
            art={require("../../assets/images/hero-team.png")}
          />
        </View>

        <Panel accent={theme.colors.error}>
          {/**
           * One line, not two.
           *
           * It had a heading — "IF SOMETHING IS WRONG NOW" — and then a
           * sentence restating it. The only part of the sentence doing work was
           * *do not send a message*, which is the whole reason this panel sits
           * above messaging, so that survives and the rest goes. Below it is a
           * list and a phone number; nothing needs to say "ring".
           */}
          <Text
            preset="formHelper"
            text="RING — DO NOT MESSAGE — IF"
            style={themed($label)}
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

        <SectionHeading text="Who is looking after you" />
        <Panel>
          {CARE_TEAM.map((member, i) => (
            <NavRow
              key={member.id}
              title={member.name}
              subtitle={member.role}
              last={i === CARE_TEAM.length - 1}
              /* A chip, and a short one. "At the desk today" beside a pip took
                 half the row, which is what pushed every role onto a second
                 line — and the pip said the same thing the chip's colour says. */
              right={
                <Chip
                  tone={member.available ? "done" : "neutral"}
                  text={member.available ? "At the desk" : "Away"}
                />
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
        background={HERO_MINT}
        right={<Chip tone={onDuty ? "done" : "neutral"} text={`${onDuty} at the desk`} />}
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
