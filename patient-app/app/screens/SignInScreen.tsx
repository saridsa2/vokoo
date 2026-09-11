import { FC, useState } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { OtpField } from "@/components/OtpField"
import { PillButton } from "@/components/PillButton"
import { PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
import { HERO_MINT, ScreenHero } from "@/components/ScreenHero"
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
 * a code field. One question at a time, no scrolling, the action pinned under
 * the field.
 *
 * ## It wears the same head as every other screen
 *
 * A full-bleed `ScreenHero` that shrinks into a `PinnedHeader` — the pattern the
 * four tabs share. It had its own arrangement instead: a wordmark, a loose
 * picture and a tagline, all of which scrolled away and left a patient looking
 * at an unlabelled form. Three surfaces with three head treatments is not three
 * designs, it is none.
 *
 * The name is the hero's title here because on the first screen the name *is*
 * the title, and pinned it is the one thing that no longer leaves.
 *
 * The code is not checked here. This is a mock screen; six digits and Continue
 * signs you in, so the rest of the app can be seen. The real exchange belongs to
 * Supabase auth and nothing on this screen would change.
 */
interface SignInScreenProps extends AppStackScreenProps<"SignIn"> {}

export const SignInScreen: FC<SignInScreenProps> = function SignInScreen({ navigation }) {
  const { themed, theme } = useAppTheme()
  const { setAuthToken } = useAuth()
  const { scrollY, scrollProps } = usePinnedHeader()

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
    <View style={$root}>
      <Screen
        preset="scroll"
        contentContainerStyle={themed($container)}
        ScrollViewProps={scrollProps}
        safeAreaEdges={["bottom"]}
      >
        <View style={themed($bleed)}>
          {/* No subtitle. "Your care, wherever you are." is the marketing
              line from the hospital-facing site; under the product's own name,
              above a field asking for a phone number, it is a sentence the
              patient reads and acts on in no way. */}
          {/* The mark, not the name set as text. Moving this screen onto the
              shared hero dropped the wordmark and left "Sarvathra" as a plain
              title — on the one screen where the logo is the point. */}
          <ScreenHero
            title="Sarvathra"
            /* `md`. The default `lg` sets the name at 36pt, which is wider
               than the 42% of the row left beside the picture — and
               "Sarvathra" is one word, so it cannot wrap out of the way. `sm`
               cleared the art by making the logo smaller than the question
               under it, which is the wrong screen for that. */
            titleNode={<Wordmark size="md" animate />}
            art={require("../../assets/images/hero-signin.png")}
          />
        </View>

        <View style={themed($form)}>
          {step === "phone" ? (
            <>
              {/* One question, asked once. It had a heading, a helper, a field
                  label and a placeholder all saying "mobile number" — four
                  lines of screen to ask for one thing. */}
              <Text
                preset="subheading"
                text="What is your mobile number?"
                style={themed($question)}
              />
              <TextField
                value={phone}
                onChangeText={setPhone}
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
              <OtpField value={code} onChangeText={setCode} label="Code" autoFocus />
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

        {/* The privacy line sits with the action, not in a footer nobody reads.
            A patient about to send a lab report is entitled to it here. */}
        <View style={themed($assurance)}>
          <Glyph name="shield" size={18} color={theme.colors.textDim} />
          <Text
            preset="formHelper"
            text="Only your care team sees what you send."
            style={themed($assuranceText)}
          />
        </View>

        {/**
         * Wrapped, and the wrapper is the fix.
         *
         * `PillButton`'s block style is `flexGrow: 1` on the reasoning that a
         * column has no free space to grow into. A `flexGrow: 1` content
         * container gives it plenty, and in flexbox a growing item takes the
         * free space *before* an auto margin can — so this button stretched to
         * 450pt and the screen ended in a huge empty outline. A plain wrapper
         * has its own natural height, so the growth stops here and the space
         * goes back to the margin above the privacy line, which is what pins
         * the pair to the bottom.
         */}
        {/* The auto margin lives here, not on the privacy line above.
            Pinning the pair left a hand's width of empty screen between "Send
            code" and a sentence that belongs directly under it. The gap is
            below the privacy line now, where it separates the thing the
            patient came to do from the other thing they might. */}
        <View style={$newHere}>
          <PillButton
            text="I am new here"
            variant="secondary"
            onPress={() => navigation.navigate("Register")}
          />
        </View>
      </Screen>

      <PinnedHeader title="Sarvathra" scrollY={scrollY} background={HERO_MINT} />
    </View>
  )
}

const $root: ViewStyle = { flex: 1 }

const $newHere: ViewStyle = { marginTop: "auto" }

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

/**
 * Neutral, not blue.
 *
 * It was `askedBackground` with an `asked` shield — the accent this palette
 * reserves for *the one thing being asked of you*. A privacy line asks nothing;
 * it reassures. Wearing the accent it competed with the button directly above
 * it, so the screen made two claims on the eye and neither was the action.
 */
const $assurance: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  backgroundColor: colors.palette.neutral300,
  padding: spacing.sm,
})

const $assuranceText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, flex: 1 })
