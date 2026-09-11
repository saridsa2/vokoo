import { FC, useEffect, useRef } from "react"
import {
  AccessibilityInfo,
  Animated,
  Easing,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native"
import Svg, { Defs, G, Image as SvgImage, LinearGradient, Mask, Rect, Stop } from "react-native-svg"

const mark = require("../../assets/images/sarvathra-mark.png")

/**
 * The mark, with light running along it.
 *
 * ## Why a sweep and not stroked lines
 *
 * The obvious reading of "the lines glowing as a flowing animation" is a
 * stroke-dashoffset chase around the logo's paths — and that is not available:
 * the mark ships as a **PNG**, so there are no paths to run along. Animating a
 * raster's strokes is not a thing.
 *
 * What produces the same impression from a raster is a band of light passing
 * across it. Two copies of the mark are stacked — one dim, one at full strength
 * — and the bright one is revealed only where a soft gradient band currently
 * sits. Because the mark is concentric lines, a band crossing them lights each
 * line in turn, which is what "flowing" looks like.
 *
 * ## It travels upward
 *
 * The band ran left to right, which lights the arcs from their outer edge
 * inward — across the glyph rather than along it. Bottom to top lights the foot
 * of every ring first and climbs through them, so the lines read as arriving in
 * order from the bottom of the mark. Same mechanism, one axis turned.
 *
 * If the logo is ever delivered as SVG, this should be replaced by a real
 * dash-offset chase: it would follow the actual curve of each line rather than
 * crossing them, which is better. This is the honest approximation available
 * from the asset we have.
 *
 * ## The band moves, not the gradient
 *
 * Animating a gradient's stops means re-rendering the `Defs` on every frame.
 * Instead the gradient is fixed inside a narrow rectangle and the *rectangle*
 * translates — one animated number, and the mask does the rest.
 *
 * `react-native-svg` props cannot use the native driver, so this runs on the JS
 * thread. It is one interpolation on one element and it only exists while the
 * app is starting, which is the moment with the least else to do.
 */
export interface SarvathraLoaderProps {
  /**
   * Overrides the measured size. Left out, the mark is a share of the screen.
   *
   * It was a flat 96 points — a thumbnail in the middle of a 6.8-inch phone,
   * and the same thumbnail on a tablet. This is the one screen with nothing
   * else on it, so the mark is the whole composition and a fixed number makes
   * it small everywhere rather than right anywhere.
   */
  size?: number
  /** The ground behind it, so the loader can sit on any surface. */
  background?: string
}

const AnimatedRect = Animated.createAnimatedComponent(Rect)

/** How deep the travelling light is, as a share of the mark. */
const BAND = 0.55

export const SarvathraLoader: FC<SarvathraLoaderProps> = function SarvathraLoader({
  size: fixedSize,
  background = "#f5f3f1",
}) {
  const { width, height } = useWindowDimensions()

  /**
   * Two fifths of the shorter edge, held between 140 and 300.
   *
   * The shorter edge rather than the width so a rotated tablet does not get a
   * mark taller than its own screen. The floor keeps it legible on a small
   * phone; the ceiling stops it becoming a poster on a large tablet, where the
   * same fraction would put a 12-inch logo on screen.
   */
  const size = fixedSize ?? Math.max(140, Math.min(300, Math.min(width, height) * 0.4))

  const travel = useRef(new Animated.Value(0)).current

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined

    /**
     * Still for anybody who has asked for less motion.
     *
     * A looping shine is exactly the kind of thing that setting exists for, and
     * a start-up screen is not a place to argue with it — the mark alone says
     * the app is opening.
     */
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) {
        travel.setValue(0.5)
        return
      }
      loop = Animated.loop(
        Animated.timing(travel, {
          toValue: 1,
          duration: 1600,
          /* Eased at both ends, so the light arrives and leaves rather than
             scrolling past at a constant speed. */
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      )
      loop.start()
    })

    return () => loop?.stop()
  }, [travel])

  const bandHeight = size * BAND
  const y = travel.interpolate({
    inputRange: [0, 1],
    /* Below the mark to above it: SVG's y grows downward, so travelling upward
       means counting down. Both ends sit clear of the artwork, so the loop has
       a dark beat rather than snapping from one edge to the other. */
    outputRange: [size, -bandHeight],
  })

  return (
    <View style={[$root, { backgroundColor: background }]}>
      <Svg width={size} height={size} accessibilityLabel="Sarvathra">
        <Defs>
          {/* Vertical, so the soft edges of the band are its top and bottom
              — a horizontal gradient inside a band that moves vertically would
              have a hard edge leading the way. */}
          <LinearGradient id="sarvSweep" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity={1} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
          <Mask id="sarvBand">
            <AnimatedRect x={0} y={y} width={size} height={bandHeight} fill="url(#sarvSweep)" />
          </Mask>
        </Defs>

        {/* The mark at rest. Visible throughout, so the logo never disappears
            between passes — a loader that blinks out reads as a failure. */}
        <SvgImage
          href={mark}
          x={0}
          y={0}
          width={size}
          height={size}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.22}
        />

        {/* The same mark at full strength, shown only where the band is. */}
        <G mask="url(#sarvBand)">
          <SvgImage
            href={mark}
            x={0}
            y={0}
            width={size}
            height={size}
            preserveAspectRatio="xMidYMid meet"
          />
        </G>
      </Svg>
    </View>
  )
}

const $root: ViewStyle = { flex: 1, alignItems: "center", justifyContent: "center" }
