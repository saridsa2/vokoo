import { FC } from "react"
import { View } from "react-native"
import {
  faArrowRight,
  faCalendarDays,
  faCamera,
  faChartSimple,
  faCheck,
  faChevronRight,
  faFileLines,
  faHouse,
  faLungs,
  faHeartPulse,
  faMessage,
  faMoon,
  faPaperclip,
  faPaperPlaneTop,
  faPhone,
  faShieldCheck,
  faShoePrints,
  faUserDoctor,
  faVial,
  faXmark,
} from "@awesome.me/kit-9a13e121e5/icons/duotone/solid"
import { config, type IconDefinition } from "@fortawesome/fontawesome-svg-core"
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome"

/**
 * Font Awesome duotone, the same kit the console uses.
 *
 * The rule from `CLAUDE.md` holds here: **icons come from the kit through one
 * shim, never from a component reaching for a definition itself.** That is what
 * keeps the style, the weight and the duotone opacities decided in one file
 * rather than negotiated per screen.
 *
 * This file replaced a set of hand-drawn SVG paths. Those were written on the
 * belief that the kit needed `FA_PACKAGE_TOKEN` in the environment — it does
 * not, because the token is in `~/.npmrc`, where npm reads it for any project
 * on this machine. Checking the environment variable and concluding the kit was
 * unavailable was the wrong check, and it cost the app its icon set for a day.
 *
 * `@fortawesome/react-native-fontawesome` renders through `react-native-svg`,
 * which is already here for the charts.
 */

/**
 * Duotone's defaults assume dark icons on a light page and a designer choosing
 * both layers. The console raises the secondary to 0.55 for the same reason it
 * does there: at 0.4 the second layer disappears and every icon reads as a flat
 * silhouette.
 *
 * The console also eases the *primary* to 0.95. That prop is web-only —
 * `react-native-fontawesome` takes `secondaryColor` and `secondaryOpacity` and
 * nothing for the first layer — so this is one place the two renderers cannot
 * be made identical, and the difference is 5% opacity on one layer.
 */
config.autoAddCss = false

const SECONDARY_OPACITY = 0.55

/**
 * The names are the app's, not Font Awesome's.
 *
 * A screen asks for `careTeam`, not `faUserDoctor` — so swapping which glyph
 * means "your care team" is one line here and no change anywhere else, and no
 * screen can quietly introduce a seventeenth icon.
 */
const GLYPHS = {
  /** Bottom tabs. */
  today: faHouse,
  progress: faChartSimple,
  reports: faFileLines,
  careTeam: faUserDoctor,

  /** Actions. */
  camera: faCamera,
  check: faCheck,
  close: faXmark,
  chevronRight: faChevronRight,
  send: faPaperPlaneTop,
  /** Attaching a document to a message. */
  attach: faPaperclip,
  next: faArrowRight,

  /** Things the app talks about. */
  phone: faPhone,
  message: faMessage,
  /** Only ever beside a sentence about who can see a document. */
  shield: faShieldCheck,
  /** A blood test — the thing a lab report comes from. */
  test: faVial,
  /** The morning blow. */
  breath: faLungs,
  /** A date on the programme rather than a task. */
  calendar: faCalendarDays,

  /** What a wearable reports, and nobody was asked for. */
  sleep: faMoon,
  heart: faHeartPulse,
  steps: faShoePrints,
} satisfies Record<string, IconDefinition>

export type GlyphName = keyof typeof GLYPHS

export interface GlyphProps {
  name: GlyphName
  size?: number
  color?: string
  /** The second layer. Defaults to the same hue at a lower opacity. */
  secondaryColor?: string
}

export const Glyph: FC<GlyphProps> = function Glyph({ name, size = 24, color, secondaryColor }) {
  return (
    <FontAwesomeIcon
      icon={GLYPHS[name]}
      size={size}
      color={color}
      secondaryColor={secondaryColor ?? color}
      secondaryOpacity={SECONDARY_OPACITY}
    />
  )
}

/**
 * A square status pip.
 *
 * A View and not an icon: it is a shape, not a symbol, and the one radius rule
 * this project keeps is that geometry stays and decoration goes. Squared,
 * like every other control.
 */
export const Pip: FC<{ color: string; size?: number }> = function Pip({ color, size = 8 }) {
  return <View style={{ width: size, height: size, backgroundColor: color }} />
}
