import { FC, ReactNode, useState } from "react"
import {
  Animated,
  Image,
  ImageSourcePropType,
  ImageStyle,
  Pressable,
  TextStyle,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * A screen's head: a mint band, a title, and an illustration.
 *
 * One component for every tab, because the alternative is five bands that drift
 * apart — a different mint here, a different type scale there. What changes per
 * screen is the picture and the words; everything else is decided once.
 *
 * The pictures are one Storyset family (`bro`) in one accent, which is what
 * makes them read as a set rather than as five stock illustrations. Anything
 * added later has to come from the same family or the set stops being one.
 *
 * ## Where the picture came from
 *
 * It is Storyset's *Milestones of business projects* (bro) — the original of
 * the reference, with its figure removed. Two earlier attempts are worth
 * recording because both were the same mistake: hand-redrawing it in
 * `react-native-svg` from a 400px screenshot, and generating a lookalike. Each
 * produced something with the right shapes and none of the character, which on
 * the one decorative thing in the app is the whole of its value. Finding the
 * source cost one search.
 *
 * **`Character` and `background-simple` are stripped**, the first because the
 * reference has no figure and the second so the band's mint runs to all four
 * edges rather than sitting inside the illustration's own rounded blob.
 *
 * Rendered at 1500px from a 500pt viewBox — 3× for a phone, with headroom for
 * a tablet — with a transparent ground, so the colour underneath is this
 * component's and there is no seam where two greens disagree.
 *
 * **Licence: Freepik, which requires attribution.** "Illustrations by
 * Storyset", linking to storyset.com, has to appear somewhere the user can
 * reach. There is no licences screen yet; until there is, this is a debt and
 * not a decision.
 */
export interface ScreenHeroProps {
  title: string
  /**
   * Optional. Home has none: "Review your health progress" said nothing the
   * road under it does not, on the one screen with the least room to spare.
   */
  subtitle?: string
  /**
   * The picture, as a `require`d asset.
   *
   * Passed in rather than chosen here by a name, because that is what lets the
   * bundler see it: `require` has to be a literal, so a lookup table of strings
   * would resolve to nothing at build time and the screen would render an empty
   * band with no error.
   */
  /**
   * Replaces the title line, for a screen whose title is a brand lockup.
   *
   * Sign-in is the one: its title *is* the name, and a name set as text is not
   * the mark. `title` is still required and still used — the pinned bar takes
   * over from this band with the same words, and a bar cannot show a lockup at
   * 16pt.
   */
  titleNode?: ReactNode
  art: ImageSourcePropType
  /**
   * Drawn over the picture, in the picture's own coordinate space.
   *
   * The art is a 1:1 render of a `0 0 500 500` viewBox, so an SVG laid over it
   * at the same size shares the artwork's coordinates exactly — which is what
   * lets a caller animate elements *inside* the illustration rather than
   * putting a second progress display next to it.
   *
   * Wrapped in the same box as the image and given the same collapse fade, so
   * the two travel together when the band shrinks.
   */
  artOverlay?: ReactNode
  /**
   * Hides the bitmap and leaves only `artOverlay`.
   *
   * For the one hero drawn as live SVG rather than a flat render. `art` is
   * still required and still passed, because the box's size comes from the
   * image's aspect ratio and the overlay inherits it — removing the image
   * would collapse the container the SVG measures itself against.
   */
  artHidden?: boolean
  /**
   * Sits under the subtitle, inside the band.
   *
   * The band already has clear space beneath the words — the picture sets its
   * height, not the text — so anything put here is free. A card below the hero
   * costs its own padding, its own border and a gap on both sides to say the
   * same thing.
   */
  footer?: ReactNode
  /**
   * How far the band has collapsed: 0 full, 1 compact.
   *
   * The band shrinks by having its height animated, and **its contents have to
   * shrink with it** or they are simply clipped — a 26pt title over two lines
   * needs 112pt and the collapsed band is 92, so the greeting lost its second
   * line and then half its first. Passed in rather than derived here because
   * the scroll offset it comes from belongs to the screen.
   */
  collapse?: Animated.AnimatedInterpolation<number>
  /**
   * Shown as a close button when given.
   *
   * Absent by default on purpose: on a root tab there is nowhere to close to,
   * and a control that does nothing is worse than no control.
   */
  onClose?: () => void
}

/**
 * The band's own mint, matching the illustration's ground.
 *
 * Named here rather than taken from the theme because it belongs to the
 * picture: if the artwork is ever replaced, this moves with it, and a theme
 * token would quietly leave a seam where the two greens disagree.
 */
export const HERO_MINT = "#E4F4E8"
const INK = "#2B3A30"

/**
 * The page's own ground, which the fade has to reach exactly.
 *
 * Named here rather than read from the theme because the gradient's far stop
 * and the body behind it must be the same value — taking one from a token and
 * writing the other by hand is how a seam appears that nobody can find.
 */
const BODY = "#f5f3f1"

export const ScreenHero: FC<ScreenHeroProps> = function ScreenHero({
  title,
  titleNode,
  artOverlay,
  artHidden,
  subtitle,
  art,
  footer,
  collapse,
  onClose,
}) {
  /* One line and nothing under it. Both the size and the alignment below turn
     on this, so it is named once rather than tested twice. */
  /**
   * Two questions, and they are not the same one.
   *
   * Whether the words centre against the picture depends only on there being
   * one line; whether that line is *typeset* smaller depends on it being text.
   * Folding a lockup into the second test left the wordmark pinned to the top
   * of the band while every other hero's title sat against the art.
   */
  const alone = !subtitle && !footer
  const aloneText = alone && !titleNode

  const { themed } = useAppTheme()
  const { top } = useSafeAreaInsets()
  const [size, setSize] = useState({ width: 0, height: 0 })

  return (
    /* The inset is padding rather than a margin, so the mint runs behind the
       status bar and the words still clear it. */
    <View
      style={[themed($hero), { paddingTop: top + 12 }]}
      onLayout={(e) =>
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }
    >
      {/**
       * The band's ground, and it lands rather than stops.
       *
       * A flat mint rectangle against the page's off-white draws a hard rule
       * across every screen at the same height, which reads as two documents
       * stacked rather than as one page with a coloured head.
       *
       * **Behind everything, not over it.** The first attempt was a wash across
       * the bottom edge, and a wash does not know what is under it — it greyed
       * the illustration's feet, which is the shadow that appeared on the
       * picture. As the background it fades only the ground: the artwork keeps
       * its own colour and simply stands on a mint that is becoming the page.
       *
       * It holds mint through the top half and turns over the bottom 45%. A
       * shorter turn — the first try used the last fifth — still reads as an
       * edge, because the two colours are close enough that a fast transition
       * between them looks like a line rather than a fade. The distance is what
       * makes it disappear, not the colours.
       *
       * **Sized from a measurement, not from `"100%"`.** An `Svg` given a
       * percentage height has nothing to resolve it against here, so it drew
       * itself a few hundred points tall near the top of the band and left the
       * rest of the mint flat — which is why the edge survived two attempts at
       * softening it. Sampling the pixels down the band showed it plainly: one
       * value from top to bottom, then a step.
       */}
      <Svg
        style={StyleSheet.absoluteFill}
        width={size.width}
        height={size.height}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="heroGround" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={HERO_MINT} />
            <Stop offset="0.55" stopColor={HERO_MINT} />
            <Stop offset="1" stopColor={BODY} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#heroGround)" />
      </Svg>

      {onClose ? (
        <Pressable
          style={themed($close)}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Svg width={16} height={16}>
            <Path
              d="M 3 3 L 13 13 M 13 3 L 3 13"
              stroke={INK}
              strokeWidth={1.8}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
      ) : null}

      {/**
       * A row, not an overlay.
       *
       * The picture was absolutely positioned behind the words, which needs two
       * numbers to agree — how wide the text may be, and where the artwork's
       * empty half ends — and they did not: the greeting came to rest on the
       * hillside. A row cannot overlap. It also means a longer name pushes the
       * picture rather than running underneath it, which is the behaviour you
       * want in any language this is translated into.
       */}
      <View style={$row}>
        {/**
         * A lone title centres; a title with a caption stays at the top.
         *
         * `$row` pins the words to the picture's sky, which is right for a pair
         * of lines — they fill the clear half beside the art. One line there
         * clings to the very top of a 250pt band with the picture's whole mass
         * below it, and reads as both unaligned and larger than it is. Nothing
         * about the type changed when the subtitles came off; what changed is
         * that it had nothing to sit against.
         */}
        <View style={[themed($words), alone ? $wordsAlone : null]}>
          {/* Sized by the collapse, so the greeting arrives whole at the top
              of the bar rather than being cut off inside it. */}
          {titleNode ?? (
            <Animated.Text
              style={[
                themed($title),
                aloneText ? $titleAlone : null,
                collapse
                  ? {
                      fontSize: collapse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [aloneText ? 22 : 26, 18],
                      }),
                      lineHeight: collapse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [aloneText ? 27 : 31, 22],
                      }),
                    }
                  : null,
              ]}
            >
              {title}
            </Animated.Text>
          )}
          {subtitle ? <Text preset="default" text={subtitle} style={themed($subtitle)} /> : null}
          {footer}
        </View>

        {/* The picture goes first and fastest. It is the part the bar has no
            room for, and it is the part a reader scrolling past has finished
            with. */}
        {/**
         * The picture and anything drawn over it share one box.
         *
         * An overlay positioned as a sibling with the same margins does *not*
         * land on the image: `$art` sizes itself from a percentage width and an
         * aspect ratio, and an absolutely positioned view with the same offsets
         * gets neither. The first attempt put the animated indicator over the
         * figure's head and off the right edge.
         *
         * One container carries the sizing and the collapse; the image and the
         * overlay both fill it. The source is square and the overlay's viewBox
         * is square, so their coordinate spaces match exactly — which is what
         * lets a caller redraw elements *inside* the artwork.
         */}
        <Animated.View
          style={[
            $art,
            collapse
              ? {
                  opacity: collapse.interpolate({
                    inputRange: [0, 0.7],
                    outputRange: [1, 0],
                    extrapolate: "clamp",
                  }),
                }
              : null,
          ]}
        >
          {/* `width`/`height` rather than `absoluteFill`: an absolutely
              positioned Image with no dimensions does not letterbox reliably
              under `contain` on Android — it came out scaled up and cropped. */}
          <Image source={art} style={$fill} resizeMode="contain" accessible={false} />
          {artOverlay}
        </Animated.View>
      </View>
    </View>
  )
}

const $hero: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  backgroundColor: HERO_MINT,
  paddingBottom: spacing.xl,
  paddingHorizontal: spacing.lg,
  /**
   * Top, not bottom.
   *
   * The band collapses by having its height animated with `overflow: hidden`,
   * so whatever is at the bottom is what gets cut. With the content pushed to
   * the bottom, collapsing sliced through the greeting — "Namaste," ended
   * mid-word. Anchored to the top, the collapse eats the picture instead, which
   * is the part that can be spared.
   */
  justifyContent: "flex-start",
  minHeight: 250,
  overflow: "hidden",
})

/* The words sit at the **top** of the row, beside the picture's sky.
   Bottom-aligned they ended up level with the road, which is the busiest part
   of the illustration and the part with the least clear space next to it. */
/* The gap is a guard, not a decoration. `$words` is `flex: 1` beside a picture
   that is a fixed 58%, so anything in it that cannot shrink — a lockup, a long
   unbroken word — runs right up to the artwork. Clear space here means no hero
   can ever have its title touching the picture. */
const $row: ViewStyle = { flexDirection: "row", alignItems: "flex-start", gap: 12 }

const $fill: ImageStyle = { width: "100%", height: "100%" }

/* Still laid out, just not drawn — the overlay measures against its box. */
const $invisible: ImageStyle = { opacity: 0 }

const $art: ImageStyle = {
  /**
   * A fraction of the row, and allowed off the right edge.
   *
   * The width is a share rather than a number of points, so the composition is
   * the same on a phone and a tablet — the same reason the road below places
   * its markers at 10% and 90%. The negative margin lets the scene run off the
   * screen the way the reference does; a picture that stops short of the edge
   * reads as a sticker on the panel rather than as the panel's own view.
   */
  width: "58%",
  aspectRatio: 1,
  marginRight: -34,
  /* Bleeds further off the bottom than it used to. The band's height is set by
     this picture, and moving the words to the top left a stretch of empty mint
     under them; cropping the road where it runs off the edge shortens the band
     without shrinking the artwork. */
  marginBottom: -40,
}

const $close: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  width: 34,
  height: 34,
  borderRadius: 34,
  backgroundColor: "#FFFFFF",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: spacing.lg,
  alignSelf: "flex-start",
})

/* Held to the empty half of the picture. The caller writes its own line breaks,
   so this is a guard against a long name running into the road rather than the
   thing deciding where the lines fall. */
const $words: ThemedStyle<ViewStyle> = ({ spacing }) => ({ flex: 1, gap: spacing.sm })

const $title: ThemedStyle<TextStyle> = () => ({
  color: "#16261C",
  fontSize: 26,
  lineHeight: 31,
})

/* Applied when there is no caption under it. Used on its own by a hero with no
   `collapse`; the animated branch reads the same two numbers. */
const $titleAlone: TextStyle = { fontSize: 22, lineHeight: 27 }

/* Centres against the picture instead of against the top of the band. The band
   still collapses from the bottom, so the words are still the last thing cut. */
const $wordsAlone: ViewStyle = { alignSelf: "center" }

/* A step down from body copy. It is a caption under the greeting, not a
   sentence to be read — at body size it competed with the name above it. */
const $subtitle: ThemedStyle<TextStyle> = () => ({
  color: "#3C4A40",
  fontSize: 14,
  lineHeight: 19,
})
