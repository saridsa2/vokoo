import { FC } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Glyph, type GlyphName } from "@/components/Glyph"
import { NavRow, Panel, SectionHeading } from "@/components/Panel"
import { PillButton } from "@/components/PillButton"
import { PinnedHeader, usePinnedHeader } from "@/components/PinnedHeader"
import { Screen } from "@/components/Screen"
import { HERO_MINT, ScreenHero } from "@/components/ScreenHero"
import { Text } from "@/components/Text"
import { ONBOARDED_KEY } from "@/navigators/AppNavigator"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { health, WANTED } from "@/services/health"
import { openSettings, useCapability, type Capability } from "@/services/permissions"
import { useAppTheme } from "@/theme/context"
import { save } from "@/utils/storage"
import type { ThemedStyle } from "@/theme/types"

/**
 * What the app needs from the phone, asked once and explained first.
 *
 * ## Why a screen rather than four prompts
 *
 * A system permission dialog gives you one sentence and two buttons, and it
 * arrives with no warning. Fired at launch, all four in a row, a patient
 * refuses them to make it stop — and on both platforms a refusal cannot be
 * asked again from inside the app. One careless sequence permanently costs the
 * thing the app is for.
 *
 * So the reason comes first, in the patient's own terms, on a screen they can
 * read at their own pace. The system prompt only appears after they have
 * pressed the row — which is the well-worn "priming" pattern, and it exists
 * because the cost of a no is permanent.
 *
 * ## Every one of them is skippable, and says so
 *
 * None of these gates the app. A patient who grants nothing still sees their
 * road, their readings and their requests; they lose the reminders and have to
 * type rather than talk. Making that plain is what makes it safe to say yes —
 * a screen that looks like a wall gets answered like one.
 *
 * ## Ordered by what the patient already understands
 *
 * Notifications first, because the app has already promised to tell them when
 * something is due and this is that promise. The camera second, because their
 * first real task is photographing a blood result. The microphone and the
 * health app after, since both are conveniences rather than the path.
 */
interface PermissionsScreenProps extends AppStackScreenProps<"Permissions"> {}

interface Ask {
  capability: Capability
  glyph: GlyphName
  title: string
}

const ASKS: Ask[] = [
  {
    capability: "notifications",
    glyph: "message",
    title: "Reminders",
  },
  {
    capability: "camera",
    glyph: "camera",
    title: "Camera",
  },
  {
    capability: "microphone",
    glyph: "phone",
    title: "Microphone",
  },
  {
    capability: "health",
    glyph: "heart",
    title: "Health app",
  },
]

export const PermissionsScreen: FC<PermissionsScreenProps> = function PermissionsScreen({
  navigation,
}) {
  const { themed } = useAppTheme()
  const { scrollY, scrollProps } = usePinnedHeader()

  return (
    <View style={$root}>
      <Screen
        preset="scroll"
        contentContainerStyle={themed($container)}
        ScrollViewProps={scrollProps}
      >
        <View style={themed($bleed)}>
          <ScreenHero
            title="What the app would like"
            /**
             * Its own picture, and the previous one was not a placeholder
             * problem — it was wrong.
             *
             * This screen borrowed register's art, which is a clipboard reading
             * INFORMED CONSENT. In a transplant programme that names a specific
             * legal document about treatment. Over four phone permissions it
             * says the patient is agreeing to their care pathway.
             *
             * Storyset's *Preferences* (bro), same family as the rest, ground
             * hidden so the band's mint runs behind it: a person setting
             * toggles on a phone, which is what this screen is.
             */
            art={require("../../assets/images/hero-permissions.png")}
          />
        </View>

        {/* Names the group without repeating the title above it, and without
            telling anybody what they do or do not have to give. These are
            phone-level permissions, which is what separates them from anything
            the app asks for later. */}
        <SectionHeading text="On this phone" />

        <Panel style={themed($group)}>
          {ASKS.map((ask, index) => (
            <AskRow key={ask.capability} ask={ask} last={index === ASKS.length - 1} />
          ))}
        </Panel>

        {/* At the bottom, like every other onboarding step. Wrapped so the
            auto margin takes the free space rather than the button, which is a
            `flexGrow` block.

            Named "Continue", not "Skip". Every row above is already optional, so
            a skip button would imply the screen was a gate — and a patient who
            granted three of four has not skipped anything. */}
        <View style={$actions}>
          <PillButton
            text="Continue"
            onPress={() => {
              /**
               * On to the last step, whatever this phone is.
               *
               * It was gated on capability, so a phone that could not run a
               * model skipped it. That made the step's presence itself a
               * statement about the patient's phone. It finishes quickly where
               * there is nothing to fetch and takes a few minutes where there
               * is — same screen, same words, and nobody is left wondering what
               * they were denied.
               *
               * `ONBOARDED_KEY` is written there rather than here, because that
               * screen is now the end of onboarding.
               */
              navigation.replace("Intelligence")
            }}
          />
        </View>
      </Screen>

      <PinnedHeader title="What the app would like" scrollY={scrollY} background={HERO_MINT} />
    </View>
  )
}

/**
 * One ask, in whichever of its three states it is in.
 *
 * The row *is* the button. A separate "Allow" beside each would put eight
 * targets on a screen with four decisions.
 */
const AskRow: FC<{ ask: Ask; last: boolean }> = function AskRow({ ask, last }) {
  const { themed, theme } = useAppTheme()
  const { state, loading, ask: request, refresh } = useCapability(ask.capability)

  /* Health is not an OS permission — it is a separate store with its own
     install and availability states — so it goes through its own service. */
  const grant = async () => {
    if (ask.capability === "health") {
      await health.request(WANTED)
      await refresh()
      return
    }
    const next = await request()
    if (next.state === "blocked") openSettings()
  }

  if (loading) return null

  const granted = state === "granted"
  const blocked = state === "blocked"

  return (
    <NavRow
      title={ask.title}
      /* State only. Each row carried a sentence explaining what it was for —
         a camera, a microphone and a set of reminders on a screen titled
         "What the app would like" explain themselves, and four explanations
         turned four decisions into a page of reading. What is left is the one
         thing a title cannot say: this one is off and where to change it. */
      subtitle={blocked ? "Turned off — change it in Settings" : undefined}
      last={last}
      left={
        <View
          style={[
            themed($mark),
            {
              backgroundColor: granted
                ? theme.colors.doneBackground
                : theme.colors.palette.neutral300,
            },
          ]}
        >
          <Glyph
            name={granted ? "check" : ask.glyph}
            size={16}
            color={granted ? theme.colors.done : theme.colors.textDim}
          />
        </View>
      }
      /* Nothing on the right once it is granted. A tick in the row's own mark
         says it, and a second confirmation is a control that cannot be used. */
      right={
        granted ? undefined : (
          /**
           * A button, not a word.
           *
           * It was bold text in the row's right slot. The whole row is
           * pressable, so it worked — and nothing about it said so, which on
           * the one screen where a patient has to decide four times is the
           * difference between a choice and a list. Bordered and padded, it
           * reads as the thing you press even though the target is the row
           * around it.
           */
          <View style={themed($allowChip)}>
            <Text preset="bold" text={blocked ? "Settings" : "Allow"} style={themed($allow)} />
          </View>
        )
      }
      onPress={granted ? undefined : blocked ? openSettings : grant}
    />
  )
}

const $root: ViewStyle = { flex: 1 }

const $actions: ViewStyle = { marginTop: "auto" }

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
  paddingBottom: spacing.xl,
  gap: spacing.md,
})

const $bleed: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginHorizontal: -spacing.lg,
  marginTop: -spacing.lg,
  marginBottom: spacing.xs,
})

const $group: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: 0,
  paddingHorizontal: spacing.md,
  gap: 0,
})

const $mark: ThemedStyle<ViewStyle> = () => ({
  width: 32,
  height: 32,
  borderRadius: 32,
  alignItems: "center",
  justifyContent: "center",
})

const $allow: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.asked, fontSize: 14 })

/* Borrows the row's own accent for its edge. `asked` is the palette's "one
   thing is being asked of you", and on this screen four things are. */
const $allowChip: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  borderWidth: 1,
  borderColor: colors.asked,
  paddingVertical: 6,
  paddingHorizontal: spacing.sm,
})
