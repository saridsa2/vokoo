import { FC } from "react"
import { Image, ImageStyle, TextStyle, View, ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

const mark = require("@assets/images/sarvathra-mark.png")

/**
 * Sarvathra's mark and name.
 *
 * **Whose name goes where.** Sarvathra is the product; the hospital is a tenant
 * of it. So the app is branded Sarvathra — mark, name, icon, splash — and the
 * hospital appears in the sentences that name *who is asking*: the transplant
 * unit’s own name. Putting the hospital in the wordmark would
 * make every deployment a different app, and the patient's actual question —
 * who wants this from me — is answered better on the card that asks.
 *
 * The mark carries its own colour and is not tinted. It is the one place in the
 * app where a hue is not drawn from the theme.
 */
export const Wordmark: FC<{ size?: "sm" | "lg" }> = function Wordmark({ size = "lg" }) {
  const { themed } = useAppTheme()
  const large = size === "lg"

  return (
    <View style={themed($row)}>
      <Image
        source={mark}
        style={[themed($mark), large ? $markLarge : $markSmall]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
      <Text preset={large ? "heading" : "subheading"} text="Sarvathra" style={themed($name)} />
    </View>
  )
}

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
})

const $mark: ThemedStyle<ImageStyle> = () => ({})

/* The mark is 74×96, so both sizes keep that ratio. A logo stretched by a
   pixel is the kind of wrong that nobody can name and everybody sees. */
const $markLarge: ImageStyle = { width: 34, height: 44 }
const $markSmall: ImageStyle = { width: 22, height: 28 }

/* Light, at display size — the weight `vokoo-brand.css` sets for the console's
   own display sizes, which is why the Light cut is loaded. */
const $name: ThemedStyle<TextStyle> = ({ colors, typography }) => ({
  color: colors.text,
  fontFamily: typography.primary.light,
  letterSpacing: -0.5,
})
