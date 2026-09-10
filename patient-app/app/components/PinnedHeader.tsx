import { FC, ReactNode } from "react"
import { Animated, TextStyle, View, ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/Text"
import { useScrollSignal } from "@/context/ScrollContext"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * The title, pinned.
 *
 * It scrolled away before, and on a screen whose whole job is *what is being
 * asked of you* that is the wrong thing to lose first: a patient two cards down
 * a list has nothing on screen saying which list it is, and the four tabs at
 * the bottom name destinations rather than the one they are standing in.
 *
 * **It shrinks rather than staying put.** A large title that never moves eats a
 * fifth of a phone screen for the whole scroll. iOS settled this pattern years
 * ago and it is right: the big title lives in the flow and belongs to the top of
 * the list; once it leaves, a compact bar takes over with the same words. So the
 * title is always present and only sometimes large.
 *
 * The swap is driven by scroll offset from the screen's own `onScroll`, which is
 * why this takes `scrollY` rather than owning a ScrollView. Screens differ —
 * one has charts, one has a list, one has a form — and a header that owned the
 * scroll would force them into one shape.
 */
export interface PinnedHeaderProps {
  title: string
  /** Driven by the screen's `onScroll`. */
  scrollY: Animated.Value
  /** Sits at the right of the compact bar — a count, a state, an action. */
  right?: ReactNode
}

/** Where the large title has travelled far enough for the bar to take over. */
const SWAP_AT = 36

export const PinnedHeader: FC<PinnedHeaderProps> = function PinnedHeader({
  title,
  scrollY,
  right,
}) {
  const { themed } = useAppTheme()
  const { top } = useSafeAreaInsets()

  /* Fades in over 20 points rather than snapping. A bar that appears between
     one frame and the next reads as a glitch; the same change over a short
     distance reads as the title arriving. */
  const opacity = scrollY.interpolate({
    inputRange: [SWAP_AT, SWAP_AT + 20],
    outputRange: [0, 1],
    extrapolate: "clamp",
  })

  return (
    /* Never takes a touch. It carries a title and a chip, neither of which is
       pressable, and it sits over the top of a scrolling list — so anything it
       captured would be a tap the patient aimed at the first card. */
    <Animated.View style={[themed($bar), { paddingTop: top, opacity }]} pointerEvents="none">
      <View style={themed($barRow)}>
        <Text preset="bold" text={title} style={themed($barTitle)} numberOfLines={1} />
        {right}
      </View>
    </Animated.View>
  )
}

/**
 * The large title, which lives in the scroll and is the first thing to go.
 *
 * Kept beside the bar rather than in each screen so that the two can never
 * disagree about the words — the bar showing one title while the list is headed
 * by another is the failure this pattern invites.
 */
export const LargeTitle: FC<{ title: string; subtitle?: string }> = function LargeTitle({
  title,
  subtitle,
}) {
  const { themed } = useAppTheme()
  return (
    <View style={themed($large)}>
      <Text preset="heading" text={title} style={themed($largeTitle)} />
      {subtitle ? <Text preset="default" text={subtitle} style={themed($subtitle)} /> : null}
    </View>
  )
}

/**
 * The wiring a screen needs.
 *
 * Now a thin alias over the shared scroll signal, because the tab bar reads the
 * same value — see `context/ScrollContext`. Kept under this name so the four
 * screens did not all have to change when the bar started needing it too.
 */
export const usePinnedHeader = useScrollSignal

const $bar: ThemedStyle<ViewStyle> = ({ colors }) => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10,
  backgroundColor: colors.background,
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $barRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: spacing.sm,
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.sm,
  minHeight: 48,
})

const $barTitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

const $large: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xxs })

const $largeTitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })
