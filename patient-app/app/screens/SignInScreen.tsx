import { FC, useState } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { OtpField } from "@/components/OtpField"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { Wordmark } from "@/components/Wordmark"
import { useAuth } from "@/context/AuthContext"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * Signing in, by phone.
 *
 * **A password is the wrong instrument here.** The people using this are on a
 * transplant follow-up, often older, often on a phone somebody in the family set
 * up. A number they already know beats a password they will have to reset the
 * first time they need this app in a hurry. The clinic also already holds the
 * number — it is what the care path rings — so the phone is the identity that
 * both sides already agree on.
 *
 * Two steps in one screen, and the step is the whole screen: a phone field, then
 * a code field. GoodRx does the same and it is the right shape — one question at
 * a time, no scrolling, the action pinned under the field.
 *
 * The code is not checked here. This is a mock screen; six digits and Continue
 * signs you in, so the rest of the app can be seen. The real exchange belongs to
 * Supabase auth and nothing on this screen would change.
 */
interface SignInScreenProps extends AppStackScreenProps<"SignIn"> {}

export const SignInScreen: FC<SignInScreenProps> = function SignInScreen({ navigation }) {
  const { themed, theme } = useAppTheme()
  const { setAuthToken } = useAuth()

  const [step, setStep] = useState<"phone" | "code">("phone")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")

  /* Ten digits, ignoring how they were typed. A patient reading a number off a
     card types the spaces that are printed on it. */
  const digits = phone.replace(/\D/g, "").slice(-10)
  const phoneReady = digits.length === 10
  const codeReady = code.length === 6

  function sendCode() {
    if (!phoneReady) return
    /* OtpField autofocuses, so the keyboard follows the step without a
       timeout chasing a ref that has only just mounted. */
    setStep("code")
  }

  return (
    <Screen
      preset="auto"
      contentContainerStyle={themed($container)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($top)}>
        <Wordmark />
        {/**
         * The site's own line, turned to face the person reading it.
         *
         * `components/sarvathra/hero.tsx` says *Your care, wherever your patient
         * is* — addressed to a hospital, because that is who buys. The patient
         * is the other half of the same sentence, and सर्वत्र is where the name
         * comes from: everywhere. Writing a second tagline for this app would
         * give one product two claims.
         *
         * Product-level and not the hospital's, because which hospital this
         * person belongs to is not known until they are signed in. From the
         * screen after this one, the hospital's name is on everything it asks
         * for.
         */}
        <Text preset="default" text="Your care, wherever you are." style={themed($tagline)} />
      </View>

      <View style={themed($form)}>
        {step === "phone" ? (
          <>
            <Text
              preset="subheading"
              text="What is your mobile number?"
              style={themed($question)}
            />
            <Text
              preset="formHelper"
              text="Use the number the hospital has for you. We will send a six-digit code to it."
              style={themed($helper)}
            />
            <TextField
              value={phone}
              onChangeText={setPhone}
              label="Mobile number"
              placeholder="98765 43210"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoFocus
              LeftAccessory={() => <Text preset="default" text="+91" style={themed($dialCode)} />}
            />
            <PillButton text="Send code" onPress={sendCode} disabled={!phoneReady} />
          </>
        ) : (
          <>
            <Text preset="subheading" text="Enter the code" style={themed($question)} />
            <Text
              preset="formHelper"
              text={`Sent to +91 ${digits.slice(0, 5)} ${digits.slice(5)}.`}
              style={themed($helper)}
            />
            <OtpField value={code} onChangeText={setCode} label="Six-digit code" autoFocus />
            <PillButton
              text="Continue"
              onPress={() => setAuthToken("mock-session")}
              disabled={!codeReady}
            />
            {/* Both ways out of a wrong number, and neither is a dead end. */}
            <View style={themed($codeFooter)}>
              <PillButton
                text="Send it again"
                variant="quiet"
                onPress={() => setCode("")}
                block={false}
              />
              <PillButton
                text="Change number"
                variant="quiet"
                onPress={() => {
                  setStep("phone")
                  setCode("")
                }}
                block={false}
              />
            </View>
          </>
        )}
      </View>

      <View style={themed($bottom)}>
        {/* The privacy line sits with the action, not in a footer nobody reads.
            A patient about to send a lab report is entitled to it here. */}
        <View style={themed($assurance)}>
          <Glyph name="shield" size={18} color={theme.colors.asked} />
          <Text
            preset="formHelper"
            text="Only your care team can see what you send."
            style={themed($assuranceText)}
          />
        </View>
        <PillButton
          text="I am new here"
          variant="secondary"
          onPress={() => navigation.navigate("Register")}
        />
      </View>
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xxl,
  paddingBottom: spacing.lg,
  justifyContent: "space-between",
  gap: spacing.xl,
})

const $top: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xxs })

const $tagline: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $form: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.sm })

const $question: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $helper: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  marginBottom: spacing.xs,
})

const $dialCode: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  alignSelf: "center",
  marginStart: spacing.sm,
})

const $codeFooter: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  marginTop: spacing.xxs,
})

const $bottom: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })

const $assurance: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  backgroundColor: colors.askedBackground,
  padding: spacing.sm,
})

const $assuranceText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })
