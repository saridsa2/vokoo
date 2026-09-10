import { FC, useState } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { Checkbox } from "@/components/Toggle/Checkbox"
import { Wordmark } from "@/components/Wordmark"
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

  const [hospital, setHospital] = useState(PROVIDER.full)
  const [name, setName] = useState("")
  const [dob, setDob] = useState("")
  const [uhid, setUhid] = useState("")
  const [consented, setConsented] = useState(false)
  const [sent, setSent] = useState(false)

  const ready = name.trim().length > 2 && dob.trim().length >= 8 && consented

  if (sent) return <Waiting onBack={() => navigation.navigate("SignIn")} />

  return (
    <Screen
      preset="scroll"
      contentContainerStyle={themed($container)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($top)}>
        <Wordmark size="sm" />
        <Text preset="heading" text="Let us find you" style={themed($title)} />
        <Text
          preset="default"
          text="We will match these against your hospital record. Your care team confirms it before anything is shared."
          style={themed($subtitle)}
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
          helper="The hospital that gave you this app."
          placeholder={PROVIDER.full}
        />
        <TextField
          value={name}
          onChangeText={setName}
          label="Your full name"
          helper="As it appears on your hospital paperwork."
          placeholder="Sunita Reddy"
          autoCapitalize="words"
          autoComplete="name"
        />
        <TextField
          value={dob}
          onChangeText={setDob}
          label="Date of birth"
          placeholder="DD / MM / YYYY"
          keyboardType="number-pad"
        />
        <TextField
          value={uhid}
          onChangeText={setUhid}
          label="Hospital number (if you have it)"
          helper="On your card or the top of a discharge summary. It makes the match quicker; you can leave it out."
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
          <Glyph name="shield" size={18} color={theme.colors.asked} />
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

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
  paddingBottom: spacing.lg,
  gap: spacing.xl,
})

const $top: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xs })

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $form: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })

const $consent: ThemedStyle<ViewStyle> = ({ spacing }) => ({ marginTop: spacing.xs })

const $bottom: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.sm, marginTop: "auto" })

const $assurance: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  backgroundColor: colors.askedBackground,
  padding: spacing.sm,
})

const $assuranceText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

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
