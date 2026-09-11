/* eslint-disable import/first */
/**
 * Welcome to the main entry point of the app. In this file, we'll
 * be kicking off our app.
 *
 * Most of this file is boilerplate and you shouldn't need to modify
 * it very often. But take some time to look through and understand
 * what is going on here.
 *
 * The app navigation resides in ./app/navigators, so head over there
 * if you're interested in adding screens and navigators.
 */
if (__DEV__) {
  // Load Reactotron in development only.
  // Note that you must be using metro's `inlineRequires` for this to work.
  // If you turn it off in metro.config.js, you'll have to manually import it.
  require("./devtools/ReactotronConfig.ts")
}
import "./utils/gestureHandler"

import { useEffect, useState } from "react"
import { useFonts } from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { initExecutorch } from "react-native-executorch"
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher"
import * as Linking from "expo-linking"
import { type LinkingOptions } from "@react-navigation/native"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { ChartKitProvider } from "react-native-chart-kit/v2"

import { SarvathraLoader } from "@/components/SarvathraLoader"

import { IntelligenceProvider } from "@/services/intelligence/provider"

import { AuthProvider } from "./context/AuthContext"
import { initI18n } from "./i18n"
import { AppNavigator } from "./navigators/AppNavigator"
import type { AppStackParamList } from "./navigators/navigationTypes"
import { useNavigationPersistence } from "./navigators/navigationUtilities"
import { ThemeProvider } from "./theme/context"
import { customFontsToLoad } from "./theme/typography"
import { loadDateFnsLocale } from "./utils/formatDate"
import * as storage from "./utils/storage"

/**
 * The native splash is dismissed by us, not by Expo.
 *
 * Left on auto, it hides itself the moment React renders its first frame and
 * then fades — which covers the whole of `SarvathraLoader` and the first
 * second of whatever screen follows. Two animations that exist to be seen at
 * launch were running underneath it: the loader's own sweep, and the wordmark
 * drawing itself in on the sign-in screen. The second was measured on a screen
 * recording, found to be finished before the first visible frame, and deleted
 * — which fixed the symptom by removing the feature.
 *
 * Held here and released on the root's first effect: React has drawn by then,
 * so there is no white flash, and everything after it happens in the open.
 */
SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * The on-device model runtime needs somewhere to put a model before it can
 * fetch one.
 *
 * ExecuTorch ships no downloader of its own — it takes an adapter, and Expo
 * apps use `ExpoResourceFetcher`, which writes into the document directory.
 * Without this call `useLLM` fails at load with "ResourceFetcher adapter is not
 * initialized", which is what the bench screen reported on its first run.
 *
 * At module scope rather than in an effect: the hook can mount before any
 * effect has run, and an adapter registered after the first load attempt is an
 * adapter registered too late.
 */
initExecutorch({ resourceFetcher: ExpoResourceFetcher })

/**
 * The loader is held for one full pass of its own animation.
 *
 * Fonts, i18n and the restored navigation state land in a few hundred
 * milliseconds on a warm start, so the loader appeared and vanished inside
 * half a sweep — a flash of a logo, which reads as a glitch rather than as the
 * app opening. A loader too brief to be understood is worse than none.
 *
 * 1800ms is one turn of `SarvathraLoader`'s 1600ms light plus a beat to
 * settle, so the band always completes its climb rather than being cut
 * part-way up. This is deliberately time the app does not need: the floor
 * exists for the person watching, not for the work.
 */
const LOADER_FLOOR_MS = 1800

export const NAVIGATION_PERSISTENCE_KEY = "NAVIGATION_STATE"

// Web linking configuration
const prefix = Linking.createURL("/")
const config: LinkingOptions<AppStackParamList>["config"] = {
  screens: {
    SignIn: { path: "" },
    Register: "register",
    Main: {
      screens: {
        Today: "today",
        Progress: "progress",
        Reports: "reports",
        CareTeam: "care-team",
      },
    },
    /**
     * A link to one request is the one deep link that earns its keep: it is what
     * the text message announcing an outreach should open. The rest are here so
     * that a link into the app lands somewhere sensible rather than nowhere.
     */
    RequestDetail: "request/:requestId",
    /* Deep link only, deliberately: a prompt box is not a patient screen. */
    LocalModel: "local-model",
    Cohort: "programme",
    MessageThread: "messages",
    Call: "call",
  },
}

/**
 * This is the root component of our app.
 * @param {AppProps} props - The props for the `App` component.
 * @returns {JSX.Element} The rendered `App` component.
 */
/**
 * The chart palette, named where the provider reads it.
 *
 * Literals rather than theme tokens on purpose: this provider sits above the
 * consumers of `ThemeProvider`, so it cannot call the theme hook — and the
 * charts are light-only regardless of what the theme might later offer.
 *
 * The greys are the app's own `neutral600` and `neutral400`, so a chart's axis
 * is the same grey as the hairline under a list row rather than a second grey
 * that only appears in charts.
 */
const CHART_ACCENT = "#2f7d4f"
const CHART_TEXT = "#000000"
const CHART_MUTED = "#777169"
const CHART_AXIS = "#ebe8e4"

export function App() {
  const {
    initialNavigationState,
    onNavigationStateChange,
    isRestored: isNavigationStateRestored,
  } = useNavigationPersistence(storage, NAVIGATION_PERSISTENCE_KEY)

  const [areFontsLoaded, fontLoadError] = useFonts(customFontsToLoad)
  const [isI18nInitialized, setIsI18nInitialized] = useState(false)
  const [heldLongEnough, setHeldLongEnough] = useState(false)

  useEffect(() => {
    /* After the first render, so the loader is already on screen behind it.
       Failure is ignored on purpose: a splash that will not hide must not be
       the thing that stops the app from starting. */
    SplashScreen.hideAsync().catch(() => {})

    const held = setTimeout(() => setHeldLongEnough(true), LOADER_FLOOR_MS)
    return () => clearTimeout(held)
  }, [])

  useEffect(() => {
    initI18n()
      .then(() => setIsI18nInitialized(true))
      .then(() => loadDateFnsLocale())
  }, [])

  /**
   * The wait, and it is the mark rather than nothing.
   *
   * The scaffold returned `null` here, which leaves the native background
   * colour showing — a blank screen of unknown length. Fonts, i18n and the
   * restored navigation state all have to land first, and on a cold start that
   * is long enough for a patient to wonder whether the app opened.
   */
  if (
    !heldLongEnough ||
    !isNavigationStateRestored ||
    !isI18nInitialized ||
    (!areFontsLoaded && !fontLoadError)
  ) {
    return <SarvathraLoader />
  }

  const linking = {
    prefixes: [prefix],
    config,
  }

  // otherwise, we're ready to render the app
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        {/* One model session for the whole app. Mounted above the navigator
            because a gigabyte of weights is not a thing to hold two of — and
            per-screen hooks meant chat loaded its own copy and reported itself
            unavailable while setup had already finished. */}
        <IntelligenceProvider>
          <AuthProvider>
            <ThemeProvider>
              {/**
               * One chart configuration for the whole app.
               *
               * Set here rather than per chart because five charts that each
               * carry their own colours are five chances to disagree — and the
               * first symptom of that is a chart whose axis is a different grey
               * from the one beside it.
               *
               * **`mode` is pinned to light on purpose.** The default is
               * `"system"`, which would turn the charts dark on a patient whose
               * phone is in dark mode while every surface around them stayed
               * pale — white text on a white card. This app is light-only, so the
               * charts are told so rather than left to infer it.
               */}
              <ChartKitProvider
                mode="light"
                theme={{
                  series: [CHART_ACCENT],
                  text: CHART_TEXT,
                  mutedText: CHART_MUTED,
                  axis: CHART_AXIS,
                  grid: CHART_AXIS,
                  background: "transparent",
                  plotBackground: "transparent",
                  typography: { axisLabelSize: 11 },
                }}
              >
                <AppNavigator
                  linking={linking}
                  initialState={initialNavigationState}
                  onStateChange={onNavigationStateChange}
                />
              </ChartKitProvider>
            </ThemeProvider>
          </AuthProvider>
        </IntelligenceProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  )
}
