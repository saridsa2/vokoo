import { FC, ReactNode } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * The one button in this app.
 *
 * Ignite ships a `Button` with `default | filled | reversed`, which are named
 * after how they look. These four are named after what pressing them does,
 * because that is the decision a screen makes:
 *
 *   `primary`     the thing we are asking you to do. One per screen.
 *   `secondary`   the other real answer. Same size, quieter.
 *   `quiet`       navigation, and anything with no consequence.
 *   `destructive` red text and no chrome, so it cannot be pressed by accident
 *                 while reaching for the primary.
 *
 * **Square, not a pill, despite the name.** The console squared every control
 * on 2 September and wrote down why: radius as decoration goes, radius as
 * geometry stays. A button is never a shape. The name is kept because "pill" is
 * what a full-width bottom action is called everywhere else.
 *
 * 52pt tall. Apple's floor is 44; a patient may be older, unwell, or holding the
 * phone one-handed outside a lab.
 */
export interface PillButtonProps {
  text: string
  onPress?: () => void
  variant?: "primary" | "secondary" | "quiet" | "destructive"
  /** Sits left of the label. A glyph, never a decoration. */
  icon?: ReactNode
  disabled?: boolean
  /** Fills its row. The default; pass false to size it to its label. */
  block?: boolean
}

export const PillButton: FC<PillButtonProps> = function PillButton({
  text,
  onPress,
  variant = "primary",
  icon,
  disabled = false,
  block = true,
}) {
  const { themed } = useAppTheme()

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        themed($base),
        themed(VARIANT_CONTAINER[variant]),
        block && $block,
        pressed && $pressed,
        disabled && $disabled,
      ]}
    >
      {icon ? <View style={$icon}>{icon}</View> : null}
      <Text preset="bold" text={text} style={themed(VARIANT_LABEL[variant])} />
    </Pressable>
  )
}

const $base: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  minHeight: 52,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.xs,
  /* Small, because the label is centred: horizontal padding buys nothing on a
     full-width button and wraps a two-word label when two buttons share a row. */
  paddingHorizontal: spacing.sm,
})

/* `flexBasis: 0` with `flexGrow`, so two buttons side by side are equal halves
   rather than each the width of its own label — "Not yet" and "Send a photo"
   are one decision and should be one pair of targets. In a column there is no
   free space to grow into, so the same style is correct there too. */
const $block: ViewStyle = { alignSelf: "stretch", flexGrow: 1, flexBasis: 0 }
/* Opacity rather than a second fill, so one press state serves all four. */
const $pressed: ViewStyle = { opacity: 0.85 }
const $disabled: ViewStyle = { opacity: 0.4 }
const $icon: ViewStyle = { marginRight: 2 }

const VARIANT_CONTAINER: Record<string, ThemedStyle<ViewStyle>> = {
  primary: ({ colors }) => ({ backgroundColor: colors.tint }),
  secondary: ({ colors }) => ({ borderWidth: 1, borderColor: colors.border }),
  quiet: () => ({}),
  destructive: () => ({}),
}

const VARIANT_LABEL: Record<string, ThemedStyle<TextStyle>> = {
  primary: ({ colors }) => ({ color: colors.palette.neutral100 }),
  secondary: ({ colors }) => ({ color: colors.text }),
  quiet: ({ colors }) => ({ color: colors.asked }),
  destructive: ({ colors }) => ({ color: colors.error }),
}
