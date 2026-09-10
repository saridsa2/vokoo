/**
 * VoKoo's palette, in Ignite's shape.
 *
 * The five named colours come from `src/styles/vokoo-tokens.css` in the console
 * — the same five the whole web console resolves through. They are the one part
 * of that design system that crosses to React Native: Untitled UI is built on
 * Tailwind and React Aria and cannot come, but a colour decision is a colour
 * decision.
 *
 *   eggshell    #fdfcfc   the surface a card sits on
 *   warm-taupe  #f5f3f1   the ground behind it
 *   stone       #ebe8e4   tertiary surfaces, hover, dividers
 *   ink         #000000   filled actions
 *   graphite    #44403b   ink's hover, and secondary text
 *   smoke       #777169   tertiary text
 *   ash         #a59f97   placeholder, disabled
 *
 * The Sarvam palette was tried in the console on 5 September and reverted. The
 * note left beside it there is worth carrying: a palette is not a design
 * language, and warm colours borrowed from a system with different type and
 * geometry read as wrong rather than warm.
 *
 * `violet-spark` and `ember-orange` are the console's two saturated accents. On
 * a patient's phone they earn their place differently: this app has exactly two
 * things to say in colour — *something is asked of you* and *something went
 * wrong* — so they map to those and nothing else.
 */
const palette = {
  // The ink ramp. Warm grey to black, matching the console's `--color-brand-*`.
  neutral100: "#ffffff",
  neutral200: "#fdfcfc", // eggshell — surface
  neutral300: "#f5f3f1", // warm taupe — ground
  neutral400: "#ebe8e4", // stone — dividers, disabled fills
  neutral500: "#a59f97", // ash — placeholder
  neutral600: "#777169", // smoke — supporting text
  neutral700: "#44403b", // graphite — secondary text, pressed ink
  neutral800: "#2b2825",
  neutral900: "#000000", // ink — filled actions, headings

  /**
   * Blue, and it is not decoration.
   *
   * On the patient's home screen this marks the one thing being asked of them.
   * If two things are blue at once, the screen has stopped telling them what to
   * do — which is the whole job of it.
   */
  primary100: "#e6ecff",
  primary200: "#b8c9ff",
  primary300: "#6a8dff",
  primary400: "#2a5cff",
  primary500: "#0447ff", // violet-spark, from the console
  primary600: "#0339cc",

  /**
   * Green, for what is done.
   *
   * Deliberately quieter than the blue. A completed request should read as
   * settled, not as a second call to action.
   */
  secondary100: "#e7f3ec",
  secondary200: "#c3e2ce",
  secondary300: "#8ec7a4",
  secondary400: "#4f9d6d",
  secondary500: "#2f7d4f",

  /**
   * Amber, for a request about to expire.
   *
   * Every outreach carries `expires_days`, and running out is a real outcome —
   * `expired` sits beside `fulfilled` and `declined` in the catalogue. This is
   * the colour of the last day, and it appears on nothing else.
   */
  accent100: "#fff4e6",
  accent200: "#ffe0b8",
  accent300: "#ffc477",
  accent400: "#f5a03c",
  accent500: "#d97706",

  /** Ember orange, the console's own. Failure, and refusal. */
  angry100: "#ffe8e0",
  angry500: "#ff4704",

  overlay20: "rgba(43, 40, 37, 0.2)",
  overlay50: "rgba(43, 40, 37, 0.5)",
} as const

export const colors = {
  /**
   * Available, but prefer a semantic name below. A literal in a screen cannot
   * follow the theme — the same rule the console states in `vokoo-brand.css`.
   */
  palette,
  transparent: "rgba(0, 0, 0, 0)",
  /** Headings and anything a patient must read exactly. */
  text: palette.neutral900,
  /** Supporting text — instructions, timestamps, what happened next. */
  textDim: palette.neutral600,
  /** The ground. Cards sit on `neutral200` above it. */
  background: palette.neutral300,
  border: palette.neutral400,
  /** Filled actions. Ink, as in the console. */
  tint: palette.neutral900,
  tintInactive: palette.neutral400,
  separator: palette.neutral400,
  error: palette.angry500,
  errorBackground: palette.angry100,

  /** What is being asked of you. Used on one thing at a time. */
  asked: palette.primary500,
  askedBackground: palette.primary100,
  /** What you have already done. */
  done: palette.secondary500,
  doneBackground: palette.secondary100,
  /** What runs out today. */
  expiring: palette.accent500,
  expiringBackground: palette.accent100,
} as const
