import { FC, useRef, useState } from "react"
/* eslint-disable no-restricted-imports -- this component is the wrapper the
   rule points at; it has to reach the platform input to build one. */
import { Pressable, TextInput, TextStyle, View, ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * A six-digit code, as six boxes.
 *
 * **One input behind six boxes, not six inputs.** Six real fields is the
 * obvious build and it is the wrong one: SMS autofill delivers the whole code
 * at once and has nowhere to put it, pasting a code from a message fills only
 * the first box, and backspace at an empty box has to be wired by hand across
 * six refs. One hidden `TextInput` holds the string, the boxes are `Text`, and
 * every one of those problems stops existing.
 *
 * That is also what keeps `autoComplete="sms-otp"` working — on Android the
 * code arrives from the messages app and fills the field without the patient
 * reading a digit, which for somebody unwell and one-handed is the difference
 * between signing in and giving up.
 *
 * The caret is a box that borders itself rather than a blinking bar: at this
 * size a real caret is invisible, and what a person needs to know is *which
 * box the next digit lands in*.
 */
export interface OtpFieldProps {
  value: string
  onChangeText: (value: string) => void
  length?: number
  label?: string
  autoFocus?: boolean
}

export const OtpField: FC<OtpFieldProps> = function OtpField({
  value,
  onChangeText,
  length = 6,
  label,
  autoFocus,
}) {
  const { themed, theme } = useAppTheme()
  const input = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)

  const digits = value.split("")
  /* The box that will receive the next digit — the last one once full, so a
     complete code does not leave the cursor pointing past the end. */
  const active = Math.min(value.length, length - 1)

  return (
    <View style={themed($wrap)}>
      {label ? <Text preset="formLabel" text={label} style={themed($label)} /> : null}

      <Pressable
        onPress={() => input.current?.focus()}
        accessibilityRole="none"
        style={themed($boxes)}
      >
        {Array.from({ length }).map((_, i) => {
          const filled = digits[i] !== undefined
          const isActive = focused && i === active
          return (
            <View
              key={i}
              style={[
                themed($box),
                filled && themed($boxFilled),
                isActive && [$boxActive, { borderColor: theme.colors.asked }],
              ]}
            >
              <Text preset="heading" text={digits[i] ?? ""} style={themed($digit)} />
            </View>
          )
        })}
      </Pressable>

      {/**
       * The real field, invisible and behind the boxes.
       *
       * `opacity: 0` rather than `display: none` — a hidden input cannot take
       * focus, and this one has to: the boxes are only a picture of it. It is
       * stretched over the boxes so a tap anywhere in the row lands on it even
       * where the Pressable does not.
       */}
      <TextInput
        ref={input}
        value={value}
        onChangeText={(text) => onChangeText(text.replace(/\D/g, "").slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus={autoFocus}
        /* Android shows a suggestion bar over a password-ish field; this is a
           one-time code and there is nothing to remember. */
        importantForAutofill="yes"
        caretHidden
        style={themed($hidden)}
      />
    </View>
  )
}

const $wrap: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.xs })

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $boxes: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.xs,
})

const $box: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  height: 60,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.palette.neutral100,
})

/* A filled box takes the ink border, so the row reads as progress even before
   anyone counts the digits. */
const $boxFilled: ThemedStyle<ViewStyle> = ({ colors }) => ({ borderColor: colors.text })

/* The colour is the theme's and the weight is not, so the two are separate:
   only the border width has to survive a theme change unchanged. */
const $boxActive: ViewStyle = { borderWidth: 2 }

const $digit: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontVariant: ["tabular-nums"],
})

const $hidden: ThemedStyle<TextStyle> = () => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  opacity: 0,
})
