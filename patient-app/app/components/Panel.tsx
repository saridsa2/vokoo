import { FC, ReactNode } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Glyph } from "@/components/Glyph"
import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * A card, a section heading, a status chip, and a row that goes somewhere.
 *
 * Four things live in one file because they are one decision: every surface in
 * this app is a bordered rectangle on the eggshell ground, and a screen that
 * invents its own is a screen that will drift. GoodRx's home is a stack of
 * cards for the same reason — the card is the unit a patient scans.
 */

/** The surface. `onPress` makes it a target and adds the chevron. */
export const Panel: FC<{
  children: ReactNode
  onPress?: () => void
  /** Tints the left edge — the node-card rule from the console: an element that
   *  belongs to something takes its colour. */
  accent?: string
}> = function Panel({ children, onPress, accent }) {
  const { themed } = useAppTheme()
  const style = [themed($panel), accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null]

  if (!onPress) return <View style={style}>{children}</View>

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [style, pressed && { opacity: 0.9 }]}
    >
      {children}
    </Pressable>
  )
}

/** A heading over a group of panels. Small, upper, and spaced — never a title. */
export const SectionHeading: FC<{ text: string; action?: { text: string; onPress: () => void } }> =
  function SectionHeading({ text, action }) {
    const { themed } = useAppTheme()
    return (
      <View style={themed($sectionHeading)}>
        <Text preset="formHelper" text={text.toUpperCase()} style={themed($sectionHeadingText)} />
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button">
            <Text preset="formHelper" text={action.text} style={themed($sectionAction)} />
          </Pressable>
        ) : null}
      </View>
    )
  }

/**
 * A state, in a word and a colour.
 *
 * The three tones are the three things this app has to say about a request:
 * it is being asked of you, you have done it, or it runs out today. Anything
 * else takes `neutral`, and most things should.
 */
export const Chip: FC<{
  text: string
  tone?: "neutral" | "asked" | "done" | "expiring" | "error"
}> = function Chip({ text, tone = "neutral" }) {
  const { themed, theme } = useAppTheme()
  const { colors } = theme
  const tones = {
    neutral: { bg: colors.palette.neutral400, fg: colors.textDim },
    asked: { bg: colors.askedBackground, fg: colors.asked },
    done: { bg: colors.doneBackground, fg: colors.done },
    expiring: { bg: colors.expiringBackground, fg: colors.expiring },
    error: { bg: colors.errorBackground, fg: colors.error },
  }[tone]

  return (
    <View style={[themed($chip), { backgroundColor: tones.bg }]}>
      <Text preset="formHelper" text={text} style={[themed($chipText), { color: tones.fg }]} />
    </View>
  )
}

/** A row inside a panel that leads somewhere. The chevron is the promise. */
export const NavRow: FC<{
  title: string
  subtitle?: string
  left?: ReactNode
  right?: ReactNode
  onPress?: () => void
  /** Omits the hairline. Pass on the last row of a group. */
  last?: boolean
}> = function NavRow({ title, subtitle, left, right, onPress, last }) {
  const { themed, theme } = useAppTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [
        themed($navRow),
        !last && themed($navRowRule),
        pressed && { opacity: 0.9 },
      ]}
    >
      {left ? <View style={themed($navRowLeft)}>{left}</View> : null}
      <View style={$navRowBody}>
        <Text preset="default" text={title} style={themed($navRowTitle)} />
        {subtitle ? (
          <Text preset="formHelper" text={subtitle} style={themed($navRowSubtitle)} />
        ) : null}
      </View>
      {right ??
        (onPress ? <Glyph name="chevronRight" size={18} color={theme.colors.textDim} /> : null)}
    </Pressable>
  )
}

const $panel: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.palette.neutral200,
  borderWidth: 1,
  borderColor: colors.separator,
  padding: spacing.lg,
  gap: spacing.sm,
})

const $sectionHeading: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: spacing.md,
})

const $sectionHeadingText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  letterSpacing: 0.8,
})

const $sectionAction: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.asked })

const $chip: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xxs,
  alignSelf: "flex-start",
})

const $chipText: ThemedStyle<TextStyle> = () => ({ letterSpacing: 0.2 })

const $navRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingVertical: spacing.sm,
})

const $navRowRule: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $navRowLeft: ThemedStyle<ViewStyle> = () => ({ width: 28, alignItems: "center" })

const $navRowBody: ViewStyle = { flex: 1, gap: 2 }

const $navRowTitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $navRowSubtitle: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })
