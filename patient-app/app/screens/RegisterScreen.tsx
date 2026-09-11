import { FC, useState } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { PillButton } from "@/components/PillButton"
import { PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
import { HERO_MINT, ScreenHero } from "@/components/ScreenHero"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { DateField } from "@/components/DateField"
import { Checkbox } from "@/components/Toggle/Checkbox"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { PROVIDER } from "@/services/mock/careData"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * Registering, which here means *claiming a record that already exists*.
 *
 * **Nobody signs up into a cohort.** A cohort is a clinical list — a consultant
 * decided who is on it — so an open sign-up form would let anyone put themselves
 * on a transplant follow-up and start receiving somebody's care path. What this
 * screen does instead is match a person to a patient the hospital already has:
 * name, date of birth, and the number printed on their card. The hospital
 * confirms; only then does the app have anything to show.
 *
 * That is why the button asks the hospital to connect you and the screen after
 * it is a wait. An enrolment that completes instantly would be a lie about who
 * decided.
 *
 * The hospital is a field rather than a fixed name because Sarvathra is the
 * product and the hospital is a tenant of it. Which one a person is treated at
 * is the first thing this form has to establish, and the last thing to hard-code.
 *
 * The consent tick is the second half of the same idea. It is not a terms box:
 * it is the patient agreeing that documents they send can be read by their care
 * team. It is unticked, always — a pre-ticked consent is not consent.
 */
interface RegisterScreenProps extends AppStackScreenProps<"Register"> {}

export const RegisterScreen: FC<RegisterScreenProps> = function RegisterScreen({ navigation }) {
  const { themed, theme } = useAppTheme()
  const { scrollY, scrollProps } = usePinnedHeader()

  /**
   * Empty, not pre-filled.
   *
   * It defaulted to the one hospital in the mock, so the screen asked a
   * question it had already answered — and on a real build with more than one
   * unit it would quietly submit the wrong one for anybody who did not notice.
   */
  const [hospital, setHospital] = useState("")
  const [name, setName] = useState("")
  const [dob, setDob] = useState<Date | undefined>(undefined)
  const [uhid, setUhid] = useState("")
  const [consented, setConsented] = useState(false)
  const [sent, setSent] = useState(false)

  const ready = name.trim().length > 2 && dob !== undefined && consented

  if (sent) return <Waiting onBack={() => navigation.navigate("SignIn")} />

  return (
    <View style={$root}>
      <Screen
        preset="scroll"
        contentContainerStyle={themed($container)}
        ScrollViewProps={scrollProps}
        safeAreaEdges={["bottom"]}
      >
        {/* The same head every other screen wears: a full-bleed band that
            shrinks into the pinned bar as the form scrolls under it. This
            screen had a wordmark, a loose picture and a title that all left
            the screen together on the first swipe. */}
        <View style={themed($bleed)}>
          <ScreenHero
            title="Let us find you"
            art={require("../../assets/images/hero-register.png")}
          />
        </View>

        <View style={themed($form)}>
          {/* The hospital comes first because it decides everything after it:
            whose record is searched, who confirms, and whose care team the
            consent below is about. A patient is treated somewhere before they
            are treated by anyone. */}
          <TextField
            value={hospital}
            onChangeText={setHospital}
            label="Where are you treated?"
            placeholder={PROVIDER.full}
          />
          {/* The placeholder is not a name. "Sunita Reddy" was both the hint and
            the patient the mock signs in as, so the field looked pre-filled
            with the right answer — the one thing a placeholder must never look
            like. */}
          <TextField
            value={name}
            onChangeText={setName}
            label="Your full name"
            placeholder="As written on your hospital record"
            autoCapitalize="words"
            autoComplete="name"
          />
          <DateField value={dob} onChange={setDob} label="Date of birth" />
          <TextField
            value={uhid}
            onChangeText={setUhid}
            label="Hospital number (if you have it)"
            helper="On your card, or the top of a discharge summary."
            placeholder="0000000"
            autoCapitalize="characters"
          />

          <View style={themed($consent)}>
            <Checkbox
              value={consented}
              onValueChange={setConsented}
              label={`My care team at ${hospital.split(",")[0] || "the hospital"} may see the reports and answers I send here.`}
            />
          </View>
        </View>

        <View style={themed($bottom)}>
          <View style={themed($assurance)}>
            <Glyph name="shield" size={18} color={theme.colors.textDim} />
            <Text
              preset="formHelper"
              text="Nothing is shared with anyone outside your care team, and nothing is sold."
              style={themed($assuranceText)}
            />
          </View>
          <PillButton
            text="Ask your hospital to connect you"
            onPress={() => setSent(true)}
            disabled={!ready}
          />
          <PillButton
            text="I already have an account"
            variant="quiet"
            onPress={() => navigation.navigate("SignIn")}
          />
        </View>
      </Screen>

      <PinnedHeader title="Let us find you" scrollY={scrollY} background={HERO_MINT} />
    </View>
  )
}

/**
 * The wait.
 *
 * Its whole job is to stop a person pressing the button again — so it says what
 * is happening, who is doing it, roughly how long, and what happens when it is
 * done. A spinner would say none of that.
 */
const Waiting: FC<{ onBack: () => void }> = function Waiting({ onBack }) {
  const { themed, theme } = useAppTheme()
  return (
    <Screen
      preset="fixed"
      contentContainerStyle={themed($waiting)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($waitingBody)}>
        <Glyph name="check" size={36} color={theme.colors.done} />
        <Text preset="heading" text={`Sent to ${PROVIDER.name}`} style={themed($title)} />
        <Text
          preset="default"
          text="The transplant unit checks these by hand, usually within a working day. We will text you when your account is ready — you do not need to keep this open."
          style={themed($waitingText)}
        />
      </View>
      <PillButton text="Back to sign in" variant="secondary" onPress={onBack} />
    </Screen>
  )
}

const $root: ViewStyle = { flex: 1 }

const $bleed: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginHorizontal: -spacing.lg,
  marginTop: -spacing.lg,
  marginBottom: spacing.xs,
})

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
  paddingBottom: spacing.lg,
  gap: spacing.md,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $form: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })

const $consent: ThemedStyle<ViewStyle> = ({ spacing }) => ({ marginTop: spacing.xs })

/* `flexShrink: 0` and no grow: the buttons inside are `flexGrow: 1` blocks, and
   in a flexGrow container they would take the page's free space instead of the
   auto margin that is meant to pin this group to the bottom. */
const $bottom: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.sm,
  marginTop: "auto",
  flexGrow: 0,
  flexShrink: 0,
})

/**
 * Neutral, not blue.
 *
 * It was `askedBackground` with an `asked` shield — the accent this palette
 * reserves for *the one thing being asked of you*. A privacy line asks nothing;
 * it reassures. Wearing the accent it competed with the button directly above
 * it, so the screen made two claims on the eye and neither of them was the
 * action.
 */
const $assurance: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  backgroundColor: colors.palette.neutral300,
  padding: spacing.sm,
})

const $assuranceText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, flex: 1 })

const $waiting: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingBottom: spacing.lg,
  justifyContent: "space-between",
})

const $waitingBody: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  justifyContent: "center",
  gap: spacing.sm,
})

const $waitingText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })
