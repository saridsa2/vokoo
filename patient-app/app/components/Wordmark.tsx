import { FC, useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  InteractionManager,
  ImageStyle,
  TextStyle,
  View,
  ViewStyle,
} from "react-native"

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
 *
 * ## Three sizes, and `md` exists because two were not enough
 *
 * `lg` sets the name at 36pt, which overflows the space a `ScreenHero` leaves
 * beside its picture — by about a tenth, so it collided with the artwork.
 * Dropping to `sm` fixed the collision by making the logo smaller than the
 * question under it. `md` is the size that actually fits: large enough to be
 * the screen's title, narrow enough to clear the art.
 */
export interface WordmarkProps {
  size?: "sm" | "md" | "lg"
  /**
   * Draws itself in on mount, from the bottom up.
   *
   * ## Why a wipe and not a stroke
   *
   * The mark is a raster — `sarvathra-mark.png`, no SVG anywhere in the repo —
   * so there are no paths to dash and no line to draw along. What a clip *can*
   * do is uncover the artwork from its bottom edge upward, and on a mark made
   * of concentric arcs that reads as the lines arriving in turn from the foot
   * of the glyph. A true stroke needs the original vector.
   *
   * ## It was built once, hidden, and deleted
   *
   * The first version ran entirely behind the native splash: a screen
   * recording showed the mark already complete in the first visible frame.
   * The response was to remove it, which is fixing a symptom by deleting the
   * feature. `app.tsx` now holds the splash and releases it after React's
   * first paint, so this happens where it can be seen.
   *
   * The name follows a beat behind rather than fading alongside — the mark
   * finishing and the name arriving is a sequence; two things fading in
   * together is one thing fading in twice.
   */
  animate?: boolean
}

/* Long enough to read as a movement rather than a flicker, short enough to be
   over before somebody reaches for the field under it. */
const DRAW_MS = 1000
const NAME_MS = 320

export const Wordmark: FC<WordmarkProps> = function Wordmark({ size = "lg", animate = false }) {
  const { themed } = useAppTheme()
  const large = size === "lg"
  const medium = size === "md"

  const height = large ? 44 : medium ? 35 : 28

  /* Starts drawn when there is nothing to animate, so the static case renders
     the finished logo on its first frame rather than an empty box. */
  const draw = useRef(new Animated.Value(animate ? 0 : 1)).current
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    if (!animate) return
    let live = true

    /**
     * After the navigation transition, not on mount.
     *
     * Mounting and being visible are different moments here, and the gap is
     * most of a second: the screen is built while the loader is still up and
     * the navigator is still animating it in. Started on mount, the draw ran
     * 0.65s–1.5s and the screen was first legible at about 1.4s — measured
     * twice on screen recordings, both times finding the mark already whole in
     * the first frame anybody could see.
     *
     * `runAfterInteractions` is the signal for exactly this: it fires once
     * animations and touches have settled, so it tracks the transition rather
     * than guessing a delay that would be wrong on a slower phone.
     */
    const handle = InteractionManager.runAfterInteractions(() => {
      if (!live) return
      begin()
    })

    /* Asked, not assumed. Somebody who has turned motion down has said
       something about how they want to be shown things, and a brand animation
       is the kind of thing they turned it off for. The logo still appears — it
       simply appears, rather than drawing itself. */
    function begin() {
      AccessibilityInfo.isReduceMotionEnabled().then((off) => {
        if (!live) return
        setReduceMotion(off)
        if (off) {
          draw.setValue(1)
          return
        }
        Animated.timing(draw, {
          toValue: 1,
          duration: DRAW_MS,
          easing: Easing.out(Easing.cubic),
          /* Height cannot be driven natively, and the whole effect is a
             height. One small view for a second is a handful of JS frames,
             not a scroll. */
          useNativeDriver: false,
        }).start()
      })
    }

    return () => {
      live = false
      handle.cancel()
    }
  }, [animate, draw])

  const nameOpacity = draw.interpolate({
    /* Holds at nothing until the mark is most of the way up, then arrives over
       the last stretch — the beat behind, on the same clock, so there is no
       second timer to fall out of step with. */
    inputRange: [0, 1 - NAME_MS / DRAW_MS, 1],
    outputRange: [0, 0, 1],
  })

  return (
    <View style={themed($row)}>
      {/* The outer box holds the mark's full footprint however far the reveal
          has got. Without it the row's width would jump as the clip grew and
          the name beside it would slide. */}
      <View style={[$clipOuter, { height }]}>
        <Animated.View
          style={[
            $clip,
            { height: draw.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) },
          ]}
        >
          <Image
            source={mark}
            style={[themed($mark), large ? $markLarge : medium ? $markMedium : $markSmall]}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
      </View>

      <Animated.View style={animate && !reduceMotion ? { opacity: nameOpacity } : null}>
        <Text
          preset={large ? "heading" : "subheading"}
          text="Sarvathra"
          style={[themed($name), medium ? $nameMedium : null]}
          numberOfLines={1}
        />
      </Animated.View>
    </View>
  )
}

/* `flex-end` on both: the clip grows from the bottom of the box and the mark
   sits at the bottom of the clip, so what is on screen is always the foot of
   the glyph and the reveal travels up it. */
const $clipOuter: ViewStyle = { justifyContent: "flex-end" }
const $clip: ViewStyle = { overflow: "hidden", justifyContent: "flex-end" }

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
})

const $mark: ThemedStyle<ImageStyle> = () => ({})

/* The mark is 74×96, so every size keeps that ratio. A logo stretched by a
   pixel is the kind of wrong that nobody can name and everybody sees. */
const $markLarge: ImageStyle = { width: 34, height: 44 }
const $markMedium: ImageStyle = { width: 27, height: 35 }
const $markSmall: ImageStyle = { width: 22, height: 28 }

/* Overrides the `subheading` preset it is layered on. 28 rather than 20, which
   is a title; 20 was smaller than the question printed under it. */
const $nameMedium: TextStyle = { fontSize: 28, lineHeight: 36 }

/* Light, at display size — the weight `vokoo-brand.css` sets for the console's
   own display sizes, which is why the Light cut is loaded. */
const $name: ThemedStyle<TextStyle> = ({ colors, typography }) => ({
  color: colors.text,
  fontFamily: typography.primary.light,
  letterSpacing: -0.5,
})
