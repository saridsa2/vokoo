/**
 * Keep letters out of the fields that cannot hold them.
 *
 * A phone number, a day count and a concurrency cap were all plain text inputs.
 * Every one of them is checked — by `platform-supply`'s E.164 regex before the
 * button, and by `operator_set_tenant_settings` in the database whatever sends
 * the request — so nothing invalid was ever stored. What was missing is the
 * part that happens while somebody is typing.
 *
 * The difference matters. A field that accepts `+91 80 40 80 25 29` and then
 * refuses it has told the reader nothing about *which* character was wrong, and
 * the one that reports at save time reports it after the dialog has been filled
 * in. A field that never takes the character says it at the moment it is typed,
 * without a message.
 *
 * **This is not validation and does not replace it.** Filtering keystrokes
 * cannot express "seven to fifteen digits" or "must start with a country code",
 * and it does nothing at all about a value that arrives by paste-and-submit from
 * a script. The rule still lives in the database; this only stops the reader
 * being able to type something it will refuse.
 */

/** Digits, nothing else. A count of days, calls or minutes. */
export function keepDigits(value: string): string {
    return value.replace(/[^0-9]/g, "");
}

/**
 * A phone number as it is stored: an optional leading `+`, then digits.
 *
 * Spaces, brackets and dashes are how people write a number down and not how
 * this system holds one — `graph::spellings` exists in the bridge because the
 * console stores `+918040802529` and the carrier sends `918040802529`, and a
 * third spelling with spaces in it would be a fourth thing to reconcile. So
 * they are dropped rather than accepted and stripped later.
 *
 * The `+` is kept only in first position: `+91+80` is not a number, and a
 * second one is more likely a slip than an intention.
 */
export function keepPhone(value: string): string {
    const plus = value.startsWith("+") ? "+" : "";
    return plus + keepDigits(value);
}

/**
 * A price: digits and at most one decimal point.
 *
 * A second point is dropped rather than the field being refused, so `1..5`
 * becomes `1.5` — a slip on the same key, not a different number. No sign and
 * no thousands separator: nothing here is ever negative, and a comma in a price
 * is a display decision the reader should not be making in the field.
 *
 * Blank stays blank, and means blank. An unpriced rate and a rate of zero are
 * different facts everywhere in this system — `call_costs.unpriced_items`
 * exists to keep them apart — so an empty field must never become `0`.
 */
export function keepDecimal(value: string): string {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    return rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
}

/**
 * What a numeric field should tell the browser it holds.
 *
 * Not `type="number"`: a spinner on a phone number is meaningless, the scroll
 * wheel silently changes a focused field, and it refuses a leading `+`.
 * `inputMode` asks a phone keyboard for the numeric pad and leaves the desktop
 * field alone, which is the whole of what is wanted here.
 */
export const NUMERIC_INPUT = { inputMode: "numeric" } as const;
export const PHONE_INPUT = { inputMode: "tel" } as const;
export const DECIMAL_INPUT = { inputMode: "decimal" } as const;
