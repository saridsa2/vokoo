import { FC, useState } from "react"
import { Platform, Pressable, TextStyle, View, ViewStyle } from "react-native"
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker"

import { Glyph } from "@/components/Glyph"
import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * A date, taken from the platform's own picker.
 *
 * ## Why not a text field
 *
 * A date of birth typed as text is four separate failures waiting: a patient
 * types `12/3/58` and means March, or means December; they type a year with two
 * digits; they type it in a format the parser was not written for; or they get
 * it right and a keyboard covered the button while they did. None of those
 * produce an error the person can act on — they produce a record that does not
 * match, on a screen whose whole job is matching.
 *
 * The platform picker cannot express a date that does not exist, and it is the
 * one date control every person on this phone has already used.
 *
 * ## Spinner, not a calendar
 *
 * Android's default for `mode="date"` is a month grid, which is right for
 * choosing an appointment and wrong for a birthday — a patient born in 1958
 * would page back eight hundred months. The spinner puts the year under a
 * thumb.
 *
 * The range is bounded at both ends for the same reason: today is the latest a
 * living patient can have been born, and 120 years is the earliest, so the
 * wheel does not spin into dates nobody has.
 */
export interface DateFieldProps {
  /** Undefined until they pick one — an empty field, not today's date. */
  value?: Date
  onChange: (value: Date) => void
  label: string
  helper?: string
  /** Shown in place of a value. Says what is wanted, not an example date. */
  placeholder?: string
}

const OLDEST_YEARS = 120

export function formatDate(date: Date) {
  /* Spelled month, because 03/04 is two different dates either side of an
     ocean and this is read back to confirm a match. */
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
}

export const DateField: FC<DateFieldProps> = function DateField({
  value,
  onChange,
  label,
  helper,
  placeholder = "Choose a date",
}) {
  const { themed, theme } = useAppTheme()
  const [open, setOpen] = useState(false)

  const today = new Date()
  const oldest = new Date(today.getFullYear() - OLDEST_YEARS, today.getMonth(), today.getDate())

  const handle = (event: DateTimePickerEvent, picked?: Date) => {
    /* Android's dialog is its own window: it reports dismissal and closes
       itself, so the state has to follow it rather than lead it. */
    if (Platform.OS === "android") setOpen(false)
    if (event.type === "dismissed" || !picked) return
    onChange(picked)
    if (Platform.OS === "ios") setOpen(false)
  }

  return (
    <View>
      <Text preset="formLabel" text={label} style={themed($label)} />

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        /* Announced as what it holds, not as an empty control: a screen reader
           on an unfilled date field should say what it is for. */
        accessibilityLabel={value ? `${label}, ${formatDate(value)}` : `${label}, not set`}
        accessibilityHint="Opens a date picker"
        style={themed($wrapper)}
      >
        <Text
          preset="default"
          text={value ? formatDate(value) : placeholder}
          style={themed(value ? $value : $placeholder)}
        />
        <Glyph name="calendar" size={18} color={theme.colors.textDim} />
      </Pressable>

      {helper ? <Text preset="formHelper" text={helper} style={themed($helper)} /> : null}

      {open ? (
        <DateTimePicker
          value={value ?? new Date(today.getFullYear() - 40, 0, 1)}
          mode="date"
          display="spinner"
          maximumDate={today}
          minimumDate={oldest}
          onChange={handle}
        />
      ) : null}
    </View>
  )
}

const $label: ThemedStyle<TextStyle> = ({ spacing }) => ({ marginBottom: spacing.xs })

/* Matches TextField's own wrapper, because a control that opens a picker and a
   control that opens a keyboard are the same kind of thing to the person
   filling in the form. */
const $wrapper: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  borderWidth: 1,
  borderRadius: 4,
  backgroundColor: colors.palette.neutral200,
  borderColor: colors.palette.neutral400,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
})

const $value: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

const $placeholder: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $helper: ThemedStyle<TextStyle> = ({ spacing }) => ({ marginTop: spacing.xs })
