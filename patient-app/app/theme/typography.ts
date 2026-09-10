import { Platform } from "react-native"
import {
  Geist_300Light as geistLight,
  Geist_400Regular as geistRegular,
  Geist_500Medium as geistMedium,
  Geist_600SemiBold as geistSemiBold,
  Geist_700Bold as geistBold,
} from "@expo-google-fonts/geist"
import { GeistMono_400Regular as geistMonoRegular } from "@expo-google-fonts/geist-mono"

/**
 * Geist, because the console is Geist.
 *
 * `src/app/layout.tsx` in the console loads it for display and body, and
 * `vokoo-brand.css` points `--font-body` and `--font-display` at it. Ignite's
 * scaffold arrives on Space Grotesk, which is a fine face and belongs to
 * somebody else's product — a patient who sees the clinic's console and this app
 * should be looking at one company.
 *
 * **The Light is loaded on purpose.** The console's display sizes are weight
 * 300 (`--text-display-*--font-weight: 300` in `vokoo-brand.css`), and a face
 * without a real Light gets a synthesised one — thinner strokes and wrong
 * spacing, which reads as a different font at heading size.
 *
 * Geist Mono is here for the one thing that needs it: a hospital number, a
 * reference code, anything a person reads out digit by digit.
 */
export const customFontsToLoad = {
  geistLight,
  geistRegular,
  geistMedium,
  geistSemiBold,
  geistBold,
  geistMonoRegular,
}

const fonts = {
  geist: {
    light: "geistLight",
    normal: "geistRegular",
    medium: "geistMedium",
    semiBold: "geistSemiBold",
    bold: "geistBold",
  },
  geistMono: {
    normal: "geistMonoRegular",
  },
  helveticaNeue: {
    // iOS only font.
    thin: "HelveticaNeue-Thin",
    light: "HelveticaNeue-Light",
    normal: "Helvetica Neue",
    medium: "HelveticaNeue-Medium",
  },
  sansSerif: {
    // Android only font.
    thin: "sans-serif-thin",
    light: "sans-serif-light",
    normal: "sans-serif",
    medium: "sans-serif-medium",
  },
}

export const typography = {
  /**
   * Available, but prefer a semantic name below.
   */
  fonts,
  /** Everything. The console sets display and body in one face too. */
  primary: fonts.geist,
  /** The platform's own, for anything that should look like the OS. */
  secondary: Platform.select({ ios: fonts.helveticaNeue, android: fonts.sansSerif }),
  /** Reference codes and hospital numbers, where digits must not vary. */
  code: fonts.geistMono,
}
