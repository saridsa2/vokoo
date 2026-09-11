import { FC } from "react"
import { Linking, Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { NavRow, Panel, SectionHeading } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { CARE_TEAM, COHORT, PATIENT } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * The cohort, from the inside.
 *
 * **A cohort is two different objects depending on who is looking.** To a
 * clinician it is a list of patients with clinicians assigned to it, and that
 * view belongs to the practitioner portal — a roster, alerts, who is overdue.
 * To the patient on this screen it is singular and personal: *the programme I am
 * on, who is looking after me, and what it is going to ask of me.* Same row in
 * `cohorts`, two screens that share almost nothing.
 *
 * The list of other patients is not here and never will be. Membership of a
 * transplant cohort is a diagnosis; showing a patient who else is in it would
 * disclose one person's condition to another.
 *
 * **What the programme will ask for is stated in advance.** A patient who knows
 * bloods are due at six weeks, three months and six months can plan a working
 * year around it. Surprise requests are how a care path becomes a nuisance.
 */
interface CohortScreenProps extends AppStackScreenProps<"Cohort"> {}

export const CohortScreen: FC<CohortScreenProps> = function CohortScreen({ navigation }) {
  const { themed, theme } = useAppTheme()

  return (
    <Screen
      preset="scroll"
      contentContainerStyle={themed($container)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($sheetHead)}>
        <Text preset="formHelper" text="YOUR PROGRAMME" style={themed($label)} />
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Glyph name="close" size={22} color={theme.colors.textDim} />
        </Pressable>
      </View>

      <View style={themed($intro)}>
        <Text preset="heading" text={COHORT.name} style={themed($title)} />
        <Text preset="default" text={COHORT.provider} style={themed($subtitle)} />
      </View>

      <Panel accent={theme.colors.asked}>
        <Text preset="formHelper" text="WHAT IT INVOLVES" style={themed($label)} />
        <Text preset="default" text={COHORT.programme} style={themed($body)} />
        <Text
          preset="formHelper"
          text={`You joined on ${COHORT.startedOn}.`}
          style={themed($subtitle)}
        />
      </Panel>

      <SectionHeading text="Your unit" />
      <Panel>
        {CARE_TEAM.map((member, i) => (
          <NavRow
            key={member.id}
            title={member.name}
            subtitle={member.role}
            last={i === CARE_TEAM.length - 1}
            left={
              <View style={themed($initials)}>
                <Text
                  preset="formHelper"
                  text={member.name
                    .replace(/^(Dr|Sister)\s+/, "")
                    .split(" ")
                    .map((w) => w[0])
                    .join("")}
                  style={themed($initialsText)}
                />
              </View>
            }
          />
        ))}
      </Panel>

      <SectionHeading text="Your record" />
      <Panel>
        <NavRow
          title="Name"
          right={<Text preset="default" text={PATIENT.fullName} style={themed($subtitle)} />}
        />
        <NavRow
          title="Hospital number"
          right={<Text preset="default" text={PATIENT.uhid} style={themed($subtitle)} />}
          last
        />
      </Panel>

      {/* Leaving is a conversation with a person, not a switch. Somebody who
          taps this is often frightened rather than finished, and a coordinator
          can tell the difference where a confirmation dialog cannot. */}
      <PillButton
        text="I want to leave this programme"
        variant="destructive"
        onPress={() => navigation.navigate("MessageThread")}
      />

      {/**
       * The credit the artwork's licence requires.
       *
       * Storyset is free for commercial use *with* attribution, so this is an
       * obligation rather than a courtesy — and an obligation that is only met
       * if a user can actually reach it. It sits at the foot of the programme
       * screen because that is the app's one "about this" page; the day there
       * is a proper licences screen it moves there whole.
       */}
      <Text
        preset="formHelper"
        text="Illustrations by Storyset — storyset.com"
        style={themed($credit)}
        onPress={() => Linking.openURL("https://storyset.com")}
      />
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.md,
  paddingBottom: spacing.lg,
  gap: spacing.md,
})

const $sheetHead: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
})

const $intro: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xxs })

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  letterSpacing: 0.8,
})

const $initials: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 28,
  height: 28,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.palette.neutral400,
})

const $initialsText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $credit: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.md,
})
