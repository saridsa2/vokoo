import { FC, useEffect } from "react"
import { BackHandler, TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { SetupIllustration } from "@/components/SetupIllustration"
import { Text } from "@/components/Text"
import { ONBOARDED_KEY } from "@/navigators/AppNavigator"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useModel } from "@/services/intelligence/provider"
import { useAppTheme } from "@/theme/context"
import { save } from "@/utils/storage"
import type { ThemedStyle } from "@/theme/types"

/**
 * The last step of onboarding, and everybody sees it.
 *
 * ## It is a setup step, not an offer
 *
 * Earlier drafts asked the patient to opt into on-device intelligence and sold
 * them on it — privacy, offline, no cost. Every one of those was written from
 * the product's side. **Their data is already with the hospital**; they handed
 * this hospital their lungs. Privacy from their own clinic is not something
 * they want, and being offered it either reads as noise or as a hint that
 * somebody else was going to see their cough.
 *
 * The real reasons this runs on the device — cost per patient across a
 * year-long programme, and not sending symptoms to a third-party model vendor —
 * are the hospital's, not the patient's. So the screen stops arguing and just
 * finishes setting the app up.
 *
 * ## Shown to every phone, capable or not
 *
 * On a phone that can run a model this fetches one and takes a few minutes; on
 * one that cannot there is nothing to fetch and it completes at once. Same
 * screen, same words, different duration. A step that appears for some people
 * and not others is a step that makes somebody wonder what they were denied.
 *
 * ## What it never says
 *
 * - **That a model is being downloaded**, or how large it is. The patient is
 *   waiting for an app to be ready; megabytes are the app's problem.
 * - **That the app works offline.** It does not — ringing the unit, messaging
 *   the team and sending a report all need a connection, and the care team
 *   screen tells this patient to *ring* for a temperature over 38°C. A draft of
 *   this screen claimed it, which would have misled somebody in an emergency.
 */
interface IntelligenceScreenProps extends AppStackScreenProps<"Intelligence"> {}

export const IntelligenceScreen: FC<IntelligenceScreenProps> = function IntelligenceScreen({
  navigation,
}) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme
  const model = useModel()

  /**
   * Setting up begins on arrival, for everybody.
   *
   * On a phone that cannot run a model there is nothing to fetch and this
   * finishes at once; on one that can, it takes a few minutes. Same screen,
   * same words, different duration — which is the only difference the patient
   * ever sees, and the right one. A step that appears for some people and not
   * others is a step that makes somebody wonder what they are missing.
   */
  useEffect(() => {
    if (model.state === "off") model.enable()
  }, [model])

  /**
   * Back is refused while this is working.
   *
   * Not a preference — there is nowhere for it to go. Onboarding replaced its
   * own screens, so the stack behind this is the permissions step, and leaving
   * mid-setup abandons a part-finished install that no screen in the app offers
   * to resume. Returning `true` tells Android the press was handled.
   *
   * Released the moment it is ready, so the finished screen behaves like any
   * other. The listener is removed on unmount either way — a back handler that
   * outlives its screen swallows presses on whatever comes next, which is a
   * far worse bug than the one it was added to fix.
   */
  useEffect(() => {
    if (ready) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true)
    return () => sub.remove()
  })

  /* Nothing to fetch on a phone that cannot run one, so it is ready the moment
     the gate has answered. */
  const ready = model.state === "ready" || model.state === "unavailable"
  const percent = Math.round(model.progress * 100)

  /* The same three phases the artwork's three circles now stand for: the gate
     answering, the fetch completing, and the session reporting ready. */
  const stepsDone =
    (model.state !== "checking" ? 1 : 0) +
    (percent >= 100 || model.state === "ready" ? 1 : 0) +
    (model.state === "ready" ? 1 : 0)

  /* `top` as well as `bottom`. The other onboarding steps open on a mint band
     that bleeds under the status bar on purpose; this one starts with a bare
     heading, which without the inset sits in the notch. */
  return (
    <Screen
      preset="scroll"
      contentContainerStyle={themed($container)}
      safeAreaEdges={["top", "bottom"]}
    >
      {/**
       * The illustration is the body of this screen, not an ornament in a band.
       *
       * It lived in the hero: a small figure in the corner beside the title,
       * with two thirds of the page below it blank for the whole two-minute
       * wait. That is the wrong way round — on a screen whose only job is *this
       * is happening, please wait*, the thing that is happening should be the
       * thing you are looking at.
       *
       * So: the title above it, the picture at full width in the middle of the
       * page, the progress under it. Square, because the source viewBox is, and
       * an illustration stretched to fill a rectangle is a different picture.
       */}
      <Text
        preset="heading"
        text={ready ? "You are all set" : "Getting things ready"}
        style={themed($title)}
      />

      <View style={$stage}>
        <View style={$picture}>
          <SetupIllustration progress={ready ? 1 : model.progress} stepsDone={stepsDone} />
        </View>
      </View>

      {ready ? (
        <View style={$readyRow}>
          <Glyph name="check" size={20} color={colors.done} />
          <Text preset="default" text="Everything is set up on this phone." style={themed($line)} />
        </View>
      ) : (
        <>
          {/**
           * Progress, without saying what is moving.
           *
           * The patient is not managing a transfer — they are waiting for an app
           * to be ready, and megabytes are the app's problem. The percentage
           * stays because it answers the only question somebody waiting has;
           * the unit it counts is not theirs to know.
           */}
          {/* The sentence that was here — "this takes a minute or two, it is
              quicker on wifi" — went. The illustration shows work happening and
              the bar says how far, so the duration was already answered; and
              telling somebody wifi is quicker *after* the download has started
              is advice they can do nothing with. */}

          <View style={themed($progress)}>
            <Text
              preset="formLabel"
              text={percent > 0 ? `${percent}%` : "Starting"}
              style={themed($percent)}
            />
            <View style={themed($track)}>
              <View style={[themed($fill), { width: `${Math.max(2, percent)}%` }]} />
            </View>
          </View>

          {/**
           * Said plainly, because the failure it prevents is not recoverable in
           * one press.
           *
           * Going back from here lands on the permissions screen with setup
           * abandoned part-way, and there is no screen anywhere that offers to
           * resume it. The hardware button is intercepted below; this sentence
           * is for the gesture, the habit, and the person who has already
           * started swiping.
           */}
          <View style={$warnRow}>
            <Glyph name="shield" size={16} color={colors.expiring} />
            <Text
              preset="formHelper"
              text="Please stay on this screen — do not go back until it finishes."
              style={[themed($line), { color: colors.expiring }]}
            />
          </View>
        </>
      )}

      {/* One place, on every onboarding screen: the bottom. Wrapped, because
          `PillButton`'s block style grows and the auto margin has to be what
          takes the free space rather than the button. */}
      <View style={$actions}>
        {/**
         * One label, and disabled until it is finished.
         *
         * It read "Finish later" while setting up — left over from when this
         * was an opt-in — and then became a pressable "Continue", on the
         * reasoning that the fetch carries on in the background. True, and it
         * contradicted the warning directly above it telling the patient not to
         * leave. Two controls on one screen saying opposite things, and the one
         * they can press wins.
         *
         * There is no way back in either: onboarding replaces its own steps, so
         * leaving here means a part-finished install that nothing offers to
         * resume.
         */}
        <PillButton
          text="Continue"
          disabled={!ready}
          onPress={() => {
            save(ONBOARDED_KEY, true)
            navigation.replace("Main", { screen: "Today" })
          }}
        />
      </View>
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
  paddingBottom: spacing.lg,
  gap: spacing.sm,
})

const $line: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $note: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  marginTop: spacing.xxs,
})

const $progress: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xxs })

const $percent: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})

const $track: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 10,
  backgroundColor: colors.palette.neutral400,
})

const $fill: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 10,
  backgroundColor: colors.done,
})

const $readyRow: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 10 }

const $warnRow: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8 }

/* One place, on every onboarding screen: the bottom. */
const $actions: ViewStyle = { marginTop: "auto" }

/**
 * Centred in whatever the title and the controls leave.
 *
 * `flex: 1` takes the space between them and `justifyContent: "center"` puts
 * the picture in the middle of it, so the scene sits at the eye's resting point
 * rather than pinned under the heading with the gap all below it.
 *
 * Square, because the source viewBox is — a stretched illustration is a
 * different picture.
 */
const $stage: ViewStyle = { flex: 1, justifyContent: "center" }

const $picture: ViewStyle = { width: "100%", aspectRatio: 1 }
