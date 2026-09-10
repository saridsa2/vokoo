/**
 * There is no dark theme, deliberately.
 *
 * Ignite expects a dark palette with the same keys as the light one, and the
 * theme type is the union of both. This file satisfies that by re-exporting the
 * light palette unchanged, so a device in dark mode renders the app exactly as
 * a device in light mode does.
 *
 * **Why, rather than tinting it.** The owner of this product has said plainly
 * that dark surfaces are not wanted, and the console shipped a dark panel once
 * and had it reverted the same day. A patient app inherits that: a clinic's
 * follow-up screen has one appearance, and a photograph of a lab report is
 * judged against a light ground in every other context a patient will see it.
 *
 * If a dark theme is ever wanted, this is the one file to write, and every
 * screen follows — no component names a colour directly.
 */
export { colors } from "./colors"
