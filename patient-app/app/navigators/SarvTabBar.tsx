import { Animated, Image, ImageStyle, Pressable, TextStyle, View, ViewStyle } from "react-native"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Glyph, type GlyphName } from "@/components/Glyph"
import { Text } from "@/components/Text"
import { useScrollSignal } from "@/context/ScrollContext"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

const mark = require("@assets/images/sarvathra-mark.png")

/**
 * The whole tab bar, drawn by hand.
 *
 * **Why a custom bar rather than a `tabBarButton`.** Sarv has to rise above the
 * bar's top edge, and React Navigation's own bar clips its children — setting
 * `overflow: "visible"` on `tabBarStyle` does not lift anything out of it,
 * because the clipping happens in a container inside. The raised square kept
 * being cropped back into the row and reading as a fifth tab wearing a border,
 * which is what it looked like on the phone.
 *
 * Owning the bar makes it structural: the button is a sibling of the bar, not a
 * child, positioned over the top edge with nothing able to crop it.
 *
 * The four ordinary destinations lay out inside the bar; the centre slot is left
 * empty and the raised square sits in that gap. Today, Progress, Reports and
 * Team are places to look at. Sarv is someone to talk to, which is why it is not
 * shaped like its neighbours.
 */

/** How far the square rises above the bar — half its height, so it sits astride. */
const RAISE = 24

/**
 * How much room a scrolling screen must leave beneath its last card.
 *
 * The raised square hangs over the content by `RAISE`. Mid-scroll it will always
 * pass over something — that is true of every raised centre button and is the
 * price of the shape. What must not happen is the *last* card ending underneath
 * it with no way to scroll further, which is a card the patient can never
 * finish reading.
 */
export const TAB_OVERHANG = RAISE + 8
const SQUARE = 56

/** The icon for each ordinary destination, by route name. */
const TAB_GLYPH: Record<string, GlyphName> = {
  Today: "today",
  Progress: "progress",
  Reports: "reports",
  CareTeam: "careTeam",
}

const TAB_LABEL: Record<string, string> = {
  Today: "Today",
  Progress: "Progress",
  Reports: "Reports",
  CareTeam: "Team",
}

export function SarvTabBar({ state, navigation }: BottomTabBarProps) {
  const { themed, theme } = useAppTheme()
  const { bottom } = useSafeAreaInsets()
  const { scrollY } = useScrollSignal()

  /**
   * The top border, painted only once content is behind it.
   *
   * At rest the bar and the page are one white surface and a line across them
   * would be dividing nothing. The moment a list starts sliding underneath,
   * the line is telling the truth — there is content back there. Fading over a
   * few points rather than snapping, so it reads as the page arriving rather
   * than as a glitch.
   *
   * The header at the other edge is driven by the same value, so both edges
   * separate at once instead of arguing.
   */
  const borderOpacity = scrollY.interpolate({
    inputRange: [0, 12],
    outputRange: [0, 1],
    extrapolate: "clamp",
  })

  const sarvRoute = state.routes.find((r) => r.name === "Sarv")
  const sarvFocused = state.routes[state.index]?.name === "Sarv"
  const ordinary = state.routes.filter((r) => r.name !== "Sarv")

  function go(name: string, key: string, focused: boolean) {
    const event = navigation.emit({ type: "tabPress", target: key, canPreventDefault: true })
    if (!focused && !event.defaultPrevented) navigation.navigate(name)
  }

  /* Half the ordinary tabs on each side, so the gap lands dead centre. */
  const half = Math.ceil(ordinary.length / 2)

  const tab = (route: (typeof ordinary)[number]) => {
    const focused = state.routes[state.index]?.key === route.key
    return (
      <Pressable
        key={route.key}
        onPress={() => go(route.name, route.key, focused)}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={TAB_LABEL[route.name]}
        style={themed($tab)}
      >
        <Glyph
          name={TAB_GLYPH[route.name] ?? "today"}
          size={24}
          color={focused ? theme.colors.text : theme.colors.palette.neutral500}
        />
        <Text
          preset={focused ? "bold" : "default"}
          text={TAB_LABEL[route.name]}
          style={[themed($label), focused && themed($labelFocused)]}
          /* Tab labels do not grow with the system font scale. At 1.15 the five
             slots already crowd; at 1.3 they wrap and break the row. The icons
             carry the meaning, so the words can hold still. */
          allowFontScaling={false}
          numberOfLines={1}
        />
      </Pressable>
    )
  }

  return (
    <View style={[themed($frame), { paddingBottom: bottom }]}>
      <Animated.View style={[themed($topRule), { opacity: borderOpacity }]} pointerEvents="none" />
      <View style={themed($bar)}>
        {ordinary.slice(0, half).map(tab)}
        {/* The gap the raised square sits in. */}
        <View style={$gap} />
        {ordinary.slice(half).map(tab)}
      </View>

      {sarvRoute ? (
        <Pressable
          onPress={() => go("Sarv", sarvRoute.key, sarvFocused)}
          accessibilityRole="button"
          accessibilityLabel="Talk to Sarv"
          accessibilityState={{ selected: sarvFocused }}
          style={({ pressed }) => [
            themed($raisedSlot),
            /**
             * It settles all the way into the bar once you are on it.
             *
             * The raise is an invitation: it lifts Sarv out of the row of
             * destinations to say it is someone to talk to rather than a place
             * to look at. On the Sarv screen that invitation has been accepted,
             * so it stops asking.
             *
             * Dropping it by `RAISE` was not enough — the white square plus its
             * label is taller than the bar, so it still stood proud of it. Being
             * *in* the bar means occupying the bar's own height and being
             * centred in it, exactly like the four tabs beside it; the square
             * goes and the mark becomes an icon the size of theirs. It also
             * gives the composer back the space it was hanging over, which is
             * the screen that most needs it.
             */
            sarvFocused
              ? { bottom, height: BAR_HEIGHT, justifyContent: "center" }
              : { bottom: bottom + RAISE },
            pressed && { opacity: 0.85 },
          ]}
        >
          {/* The logo in its own blue. Every earlier attempt fixed contrast by
              taking the colour away — white on ink, then white on the accent —
              and each one traded the brand for prominence it did not need. The
              square already stands out by breaking the bar, and on the screen
              where it is not breaking anything it does not need to. */}
          {sarvFocused ? (
            <Image
              source={mark}
              style={themed($markSettled)}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={themed($raised)}>
              <Image
                source={mark}
                style={themed($mark)}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </View>
          )}
          {/* Named like its neighbours. The mark is distinctive, but four
              labelled tabs and one unlabelled square reads as an omission —
              and these are patients who should never have to infer. */}
          <Text
            preset={sarvFocused ? "bold" : "default"}
            text="Sarv"
            style={[themed($label), sarvFocused && themed($labelFocused)]}
            allowFontScaling={false}
          />
        </Pressable>
      ) : null}
    </View>
  )
}

/** The bar's own height, above the safe-area inset. */
const BAR_HEIGHT = 64

const $frame: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.palette.neutral200,
})

/* Drawn rather than set as a border, because a border cannot be faded
   independently of the view it belongs to. */
const $topRule: ThemedStyle<ViewStyle> = ({ colors }) => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 1,
  backgroundColor: colors.separator,
})

const $bar: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  alignItems: "center",
  height: BAR_HEIGHT,
})

const $tab: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  gap: 3,
})

const $gap: ViewStyle = { width: SQUARE + 16 }

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.palette.neutral500,
  fontSize: 11,
  lineHeight: 14,
})

const $labelFocused: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

/* The whole target — square and label — lifted so the square straddles the
   bar's top edge and the word sits inside the bar with the other four. */
const $raisedSlot: ThemedStyle<ViewStyle> = () => ({
  position: "absolute",
  alignSelf: "center",
  alignItems: "center",
  gap: 3,
})

const $raised: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: SQUARE,
  height: SQUARE,
  alignItems: "center",
  justifyContent: "center",
  /* White, like the bar it rises out of. What marks it is the plane it breaks,
     not a fill — and the logo can keep its own colour on white. */
  backgroundColor: colors.palette.neutral100,
  borderWidth: 1,
  borderColor: colors.border,
})


const $mark: ThemedStyle<ImageStyle> = () => ({ width: 28, height: 34 })

/* The size the four Glyphs beside it are drawn at, so the row reads as five
   tabs rather than four and a guest. */
const $markSettled: ThemedStyle<ImageStyle> = () => ({ width: 22, height: 26 })
