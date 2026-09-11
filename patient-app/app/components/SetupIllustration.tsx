import { FC, useEffect, useRef, useState } from "react"
import { Animated, Easing, LayoutChangeEvent, StyleSheet, View } from "react-native"
import Svg, { Circle, G, Line, Path, Polygon, Polyline, Rect } from "react-native-svg"

const AG = Animated.createAnimatedComponent(G)
const ARect = Animated.createAnimatedComponent(Rect)
const ACircle = Animated.createAnimatedComponent(Circle)

/**
 * The setup illustration, inline and alive.
 *
 * ## Why it is not a PNG
 *
 * Every other hero in this app is a flat render, which is right for a picture
 * that never changes. This one *is* the progress display — the artwork already
 * contains a 1–2–3 step indicator, and a bitmap freezes it at whatever state
 * Storyset drew. An earlier attempt kept the PNG and drew a live indicator over
 * the top of it; that works, and it is a patch over a picture rather than a
 * picture that moves.
 *
 * So `completed-steps.svg` is compiled to real `react-native-svg` elements —
 * 288 of them, by `scripts/svg-to-tsx.py` rather than by hand, because a stray
 * fill in 286 inline styles is the kind of mistake nobody sees until it ships.
 *
 * ## The scene builds, the way a Lottie would
 *
 * The file keeps its own top-level groups — Picture, Floor, Window, Screen,
 * Character, Table, Plant — and they are the animation. Each rises and fades in
 * on a stagger, back of the room first and the figure last, so the scene
 * assembles rather than appearing. It runs once on mount; a room that keeps
 * rebuilding itself is a distraction on a screen somebody is waiting at.
 *
 * ## And the indicator is driven by the real thing
 *
 * The bar between the circles and the circles themselves come from the
 * download, not from a timer. The numbers are the file's own:
 *
 * | element | source |
 * |---|---|
 * | track | `rect x=159.53 y=87 w=160 h=6` |
 * | steps | `circle cy=91 r=14.67/12.47` at cx `150.87`, `239.53`, `328.2` |
 *
 * A bar that fills on a clock while a download stalls is a lie told smoothly,
 * which is worse than no bar at all.
 */
export interface SetupIllustrationProps {
  /** 0 to 1, from the real fetch. */
  progress: number
  /** How many of the three steps have finished. */
  stepsDone: number
}

const INK = "#263238"
const GREEN = "#92E3A9"
const GREY_FILL = "#dbdbdb"
const GREY_LINE = "#a8a8a8"

const TRACK = { x: 159.53, y: 87, width: 160, height: 6 }
const STEPS = [150.87, 239.53, 328.2]

/* The four form fields on the monitor, at the file's own coordinates. */
const ROWS = [
  { x: 139.46, y: 140.64, width: 74.49 },
  { x: 230.41, y: 140.64, width: 74.49 },
  { x: 139.46, y: 163.28, width: 125.52 },
  { x: 139.46, y: 185.09, width: 125.52 },
]

/* Back of the room first, the person last. */
const ORDER = ["Picture", "Window", "Floor", "Table", "Screen", "Plant", "Character"] as const

export const SetupIllustration: FC<SetupIllustrationProps> = function SetupIllustration({
  progress,
  stepsDone,
}) {
  /**
   * Measured, not `"100%"`.
   *
   * `ScreenHero` carries this same lesson for its gradient: an `Svg` given a
   * percentage size has nothing here to resolve it against and draws itself at
   * some other size entirely.
   */
  const [box, setBox] = useState({ width: 0, height: 0 })
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setBox((prev) => (Math.abs(prev.width - width) < 0.5 ? prev : { width, height }))
  }

  /**
   * Starts **visible**, and the entrance animates from zero.
   *
   * Initialised at 1 on purpose: if the animation never runs, the picture is
   * simply there. That is not defensive coding for its own sake — the first
   * version started at 0 and gated the entrance on
   * `InteractionManager.runAfterInteractions`, then a looping pulse was added
   * beside it. A running animation *is* an interaction, so the callback never
   * fired, every group stayed at opacity 0, and the hero was a white rectangle.
   *
   * An animation that fails should cost the motion, never the content.
   */
  const enter = useRef(ORDER.map(() => new Animated.Value(1))).current
  const bar = useRef(new Animated.Value(0)).current
  const pulse = useRef(new Animated.Value(0)).current
  const fill = useRef(ROWS.map(() => new Animated.Value(1))).current
  const sway = useRef(new Animated.Value(0)).current

  useEffect(() => {
    /**
     * A plain delay, not `runAfterInteractions`.
     *
     * Mounting and being visible are most of a second apart — the screen is
     * built while the navigator is still animating it in — so the build-up has
     * to start after that or nobody sees it. `runAfterInteractions` is the
     * usual signal for exactly this and cannot be used here: the pulse loop
     * below never ends, so the queue never drains.
     */
    enter.forEach((v) => v.setValue(0))
    const timer = setTimeout(() => {
      Animated.stagger(
        110,
        enter.map((v) =>
          Animated.timing(v, {
            toValue: 1,
            duration: 520,
            easing: Easing.out(Easing.cubic),
            /* These are SVG element props rather than view styles, so the native
             driver cannot carry them. Seven values for four-tenths of a second,
             once, on mount — not a scroll. */
            useNativeDriver: false,
          }),
        ),
      ).start()
    }, 380)
    return () => clearTimeout(timer)
  }, [enter])

  useEffect(() => {
    Animated.timing(bar, {
      toValue: Math.max(0, Math.min(1, progress)) * TRACK.width,
      /* Longer than the gap between progress reports, so it glides between them
         rather than stepping. */
      duration: 500,
      easing: Easing.out(Easing.quad),
      /* A geometry attribute cannot be driven natively. */
      useNativeDriver: false,
    }).start()
  }, [progress, bar])

  /**
   * Props, not a `style`.
   *
   * `G` is an SVG element: it takes `opacity` and `translateY` directly and has
   * no `style` prop at all. Passing a React Native style object to it type-errors
   * and, untyped, would silently animate nothing.
   */
  /**
   * A breath on the step that is currently working.
   *
   * The build-up lasts a second; the download lasts minutes. Without this the
   * illustration is a still picture for the whole of the wait, which is the
   * thing an animated hero was supposed to fix — and a static screen during a
   * long wait is what makes somebody think the app has hung.
   *
   * It is on the active circle only, so the motion is also information: it
   * marks *where* the work is. Loops until the step completes, then stops,
   * because a finished thing should sit still.
   */
  useEffect(() => {
    pulse.setValue(0.08)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.05,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [stepsDone, pulse])

  /**
   * The form filling in, and the plant moving.
   *
   * Two loops rather than one, because one moving element on a two-minute
   * screen reads as a stuck indicator rather than as a scene. Both animate
   * properties that `react-native-svg` genuinely updates — a group's `opacity`
   * and a group's `translateX` — which is the lesson from animating a circle's
   * `r` and watching nothing happen.
   */
  useEffect(() => {
    const rows = Animated.loop(
      Animated.sequence([
        Animated.stagger(
          220,
          fill.map((v) =>
            Animated.timing(v, {
              toValue: 1,
              duration: 320,
              easing: Easing.out(Easing.quad),
              useNativeDriver: false,
            }),
          ),
        ),
        Animated.delay(700),
        /* All four clear together, so the refill reads as one pass beginning
           rather than four things flickering out of step. */
        Animated.parallel(
          fill.map((v) =>
            Animated.timing(v, {
              toValue: 0.12,
              duration: 260,
              easing: Easing.in(Easing.quad),
              useNativeDriver: false,
            }),
          ),
        ),
      ]),
    )
    rows.start()

    const breeze = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, {
          toValue: 2,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(sway, {
          toValue: -2,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    )
    breeze.start()

    return () => {
      rows.stop()
      breeze.stop()
    }
  }, [fill, sway])

  const rise = (i: number) => ({
    opacity: enter[i],
    translateY: enter[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
  })

  if (box.width === 0) return <View style={StyleSheet.absoluteFill} onLayout={onLayout} />

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
      <Svg viewBox="0 0 500 500" width={box.width} height={box.height}>
        <AG {...rise(0)}>
          <G opacity={0.30000000000000004}>
            <Rect
              x={384}
              y={79}
              width={83}
              height={109}
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Rect
              x={399.23}
              y={99}
              width={52.54}
              height={69}
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
          </G>
        </AG>
        <AG {...rise(1)}>
          <G opacity={0.30000000000000004}>
            <Rect
              x={41.54}
              y={44.47}
              width={94.91}
              height={267.06}
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 52.59 136.27 52.59 134.05 45.25"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 61.48 136.27 61.48 134.05 54.14"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 70.37 136.27 70.37 134.05 63.03"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 79.26 136.27 79.26 134.05 71.92"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 88.15 136.27 88.15 134.05 80.81"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 97.05 136.27 97.05 134.05 89.7"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 105.94 136.27 105.94 134.05 98.59"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 114.83 136.27 114.83 134.05 107.49"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 123.72 136.27 123.72 134.05 116.38"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 132.61 136.27 132.61 134.05 125.27"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 141.5 136.27 141.5 134.05 134.16"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 150.39 136.27 150.39 134.05 143.05"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 159.28 136.27 159.28 134.05 151.94"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 168.18 136.27 168.18 134.05 160.83"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 177.07 136.27 177.07 134.05 169.72"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 185.96 136.27 185.96 134.05 178.62"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 194.85 136.27 194.85 134.05 187.51"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 203.74 136.27 203.74 134.05 196.4"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 212.63 136.27 212.63 134.05 205.29"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 221.52 136.27 221.52 134.05 214.18"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 230.41 136.27 230.41 134.05 223.07"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 239.31 136.27 239.31 134.05 231.97"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 248.2 136.27 248.2 134.05 240.86"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 257.09 136.27 257.09 134.05 249.75"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 265.98 136.27 265.98 134.05 258.64"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 274.87 136.27 274.87 134.05 267.53"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 283.76 136.27 283.76 134.05 276.42"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 292.65 136.27 292.65 134.05 285.31"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="42.05 301.55 136.27 301.55 134.05 294.2"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Rect
              x={143.61}
              y={44.47}
              width={94.91}
              height={267.06}
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 52.59 238.33 52.59 236.12 45.25"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 61.48 238.33 61.48 236.12 54.14"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 70.37 238.33 70.37 236.12 63.03"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 79.26 238.33 79.26 236.12 71.92"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 88.15 238.33 88.15 236.12 80.81"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 97.05 238.33 97.05 236.12 89.7"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 105.94 238.33 105.94 236.12 98.59"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 114.83 238.33 114.83 236.12 107.49"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 123.72 238.33 123.72 236.12 116.38"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 132.61 238.33 132.61 236.12 125.27"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 141.5 238.33 141.5 236.12 134.16"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 150.39 238.33 150.39 236.12 143.05"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 159.28 238.33 159.28 236.12 151.94"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 168.18 238.33 168.18 236.12 160.83"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 177.07 238.33 177.07 236.12 169.72"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 185.96 238.33 185.96 236.12 178.62"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 194.85 238.33 194.85 236.12 187.51"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 203.74 238.33 203.74 236.12 196.4"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 212.63 238.33 212.63 236.12 205.29"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 221.52 238.33 221.52 236.12 214.18"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 230.41 238.33 230.41 236.12 223.07"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 239.31 238.33 239.31 236.12 231.97"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 248.2 238.33 248.2 236.12 240.86"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 257.09 238.33 257.09 236.12 249.75"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 265.98 238.33 265.98 236.12 258.64"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 274.87 238.33 274.87 236.12 267.53"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 283.76 238.33 283.76 236.12 276.42"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 292.65 238.33 292.65 236.12 285.31"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
            <Polyline
              points="144.12 301.55 238.33 301.55 236.12 294.2"
              fill="none"
              stroke="#000"
              strokeMiterlimit={10}
            />
          </G>
        </AG>
        <AG {...rise(2)}>
          <Line fill="none" stroke="#263238" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#263238" strokeLinecap="round" strokeLinejoin="round" />
        </AG>
        <AG {...rise(3)}>
          <Path
            d="M136,328.49l5.72,14.73c2,4.18,2.82,11.29,2.28,15.9l-13.42,106.4a2.05,2.05,0,0,0,2,2.3h0a2,2,0,0,0,2-1.67l25.64-136.24h-9.4l-1.65,7.84a1.33,1.33,0,0,1-2.56.13l-3.17-10Z"
            fill="#fff"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polygon
            points="149.9 334.29 159.39 334.29 160.22 329.91 150.82 329.91 149.9 334.29"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polygon
            points="143.44 327.9 135.95 328.49 138.2 334.29 145.47 334.29 143.44 327.9"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M280.37,328.49l-5.72,14.73c-2,4.18-2.83,11.29-2.29,15.9l13.43,106.4a2.05,2.05,0,0,1-2,2.3h0a2,2,0,0,1-2-1.67L256.1,329.91h9.4l1.65,7.84a1.32,1.32,0,0,0,2.55.13l3.18-10Z"
            fill="#fff"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polygon
            points="265.5 329.91 256.1 329.91 256.93 334.29 266.42 334.29 265.5 329.91"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polygon
            points="270.85 334.29 278.12 334.29 280.37 328.49 272.88 327.9 270.85 334.29"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={125.91}
            y={321.13}
            width={165.21}
            height={8.73}
            fill="#fff"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={236.65}
            y={318.67}
            width={42.22}
            height={2.52}
            fill="#fff"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M211.21,320.63H192.79a6.1,6.1,0,0,1-6.09-5.78,6,6,0,0,1,.23-2l11.54-33.19a1.34,1.34,0,0,1,2.54.88l-11.52,33.12a3.26,3.26,0,0,0-.11,1.07,3.42,3.42,0,0,0,3.41,3.23h18.42a1.35,1.35,0,0,1,0,2.69Z"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M206.45,234.22l20.34,77.88-2.22,1.67S199,293.74,199,277s4.45-42.29,4.45-42.29Z"
            fill="#fff"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polygon
            points="206.45 234.22 203.42 234.75 224.57 313.77 226.79 312.1 206.45 234.22"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M150.14,305.4s-7.22-11.56-1.44-18.06S163.87,284,165.79,290s-2.16,16.13-2.16,16.13Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M150.39,292.16c-1.21,0-5.78-1.69-7.23-3.86s-1.68-7,2.41-7,5.54,7.23,5.54,7.23l.24,2.64"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M154.09,287.66c-1.08-.54-4.42-4.09-4.75-6.67s1.61-7,5.28-5.18,1.73,8.94,1.73,8.94l-1,2.48"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M158.46,288.87c-.6-1-1.41-5.85-.25-8.18s5.23-4.93,7.26-1.38S162,287.7,162,287.7l-2.18,1.53"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M159.9,297.5c-.2-1.19.7-6,2.6-7.76s6.61-2.82,7.29,1.22-6.21,6.65-6.21,6.65l-2.57.68"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
          <Rect
            x={146.49}
            y={301.37}
            width={19.75}
            height={19.75}
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </AG>
        <AG {...rise(4)}>
          <Rect
            x={117.48}
            y={25.92}
            width={252.22}
            height={224.51}
            fill="#fff"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={117.48}
            y={25.92}
            width={252.22}
            height={35.08}
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={360.2}
            y={25.92}
            width={9.5}
            height={224.51}
            fill="#dbdbdb"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={360.2}
            y={59.67}
            width={9.5}
            height={43.33}
            fill="#949494"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={117.48}
            y={25.92}
            width={252.22}
            height={17.05}
            fill="#dbdbdb"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={130.27}
            y={30.9}
            width={99.47}
            height={7.1}
            fill="#fff"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Line fill="none" stroke="#263238" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#263238" strokeLinecap="round" strokeLinejoin="round" />
          <Line fill="none" stroke="#263238" strokeLinecap="round" strokeLinejoin="round" />
          {/**
           * The artwork's own indicator, driven in place.
           *
           * These eight elements are the file's, at the file's coordinates — only
           * their colours and the fill's width now come from the real download. In
           * place matters: the numerals 1, 2 and 3 are separate paths drawn *after*
           * these in the source, so replacing them here keeps the numbers on top.
           * A previous version painted fresh circles at the end of the tree and
           * buried the numbers under them.
           */}
          <Rect
            x={159.53}
            y={87}
            width={160}
            height={6}
            fill="#dbdbdb"
            stroke="#a8a8a8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <ARect
            x={159.53}
            y={87}
            width={bar}
            height={6}
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/**
           * The halo on the working step — a `G`'s opacity, not a circle's `r`.
           *
           * The first version animated `r` on the `Circle` itself and nothing
           * moved: `r` is not an animatable prop in `react-native-svg`, so the
           * value updated every frame and no pixel changed. Measured rather
           * than assumed — a frame diff across the indicator showed the
           * entrance moving for eight frames and then **zero** changed pixels
           * for the next two seconds.
           *
           * Group opacity does animate. The entrance is proof, because that is
           * all the entrance is.
           */}
          {stepsDone < 3 ? (
            <AG opacity={pulse}>
              <Circle cx={STEPS[stepsDone]} cy={91} r={23} fill={GREEN} />
            </AG>
          ) : null}

          {STEPS.map((cx, i) => (
            <Circle
              key={cx}
              cx={cx}
              cy={91}
              r={14.67}
              fill={i < stepsDone ? GREEN : i === stepsDone ? "#cdeed8" : GREY_FILL}
              stroke={i <= stepsDone ? INK : GREY_LINE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {STEPS.map((cx, i) => (
            <Circle
              key={`in-${cx}`}
              cx={cx}
              cy={91}
              r={12.47}
              fill="#fff"
              stroke={i < stepsDone ? INK : GREY_LINE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          <Path d="M148.32,86.51a2,2,0,0,0,2.19-1.59h1.34V97.56h-2V87.92h-1.54Z" fill="#263238" />
          <Path
            d="M238.9,86.58c-.63,0-1,.34-1,1.25v1.35H236V88c0-2,1-3.18,3-3.18s3,1.16,3,3.18c0,4-3.95,5.46-3.95,7.54a1.23,1.23,0,0,0,0,.27h3.75v1.8H236V96c0-3.72,3.94-4.34,3.94-8C239.93,86.89,239.53,86.58,238.9,86.58Z"
            fill="#263238"
          />
          <Path
            d="M329.06,88c0-1.14-.4-1.45-1-1.45s-1,.34-1,1.25v.81h-1.88V88c0-2,1-3.18,3-3.18s3,1.16,3,3.18v.33a2.46,2.46,0,0,1-1.39,2.6A2.57,2.57,0,0,1,331,93.54v1c0,2-1,3.18-3,3.18s-3-1.16-3-3.18v-1H327v1.18c0,.9.39,1.24,1,1.24s1-.3,1-1.42v-1c0-1.17-.4-1.61-1.3-1.61h-.67v-1.8h.77c.74,0,1.2-.33,1.2-1.34Z"
            fill="#263238"
          />
          {/**
           * The form on the monitor fills itself in, over and over.
           *
           * This is the scene's actual work — a person at a desk completing a
           * setup — so it is the thing that should be moving while somebody
           * waits. The four fields are the file's own rects at the file's own
           * coordinates; each is wrapped in a group whose opacity runs on a
           * staggered loop, so they populate top to bottom and start again.
           *
           * A single pulsing dot is not an animation. Four elements filling in
           * sequence reads as work being done, which is what the screen is
           * claiming is happening.
           */}
          {ROWS.map((r, i) => (
            <AG key={`row-${i}`} opacity={fill[i]}>
              <Rect
                x={r.x}
                y={r.y}
                width={r.width}
                height={11.52}
                fill="#fff"
                stroke="#263238"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* The line of "text" that appears inside it. */}
              <Rect x={r.x + 4} y={r.y + 4} width={r.width - 8} height={3.5} fill={GREEN} />
            </AG>
          ))}
          <Path
            d="M142.54,120.22c1.29,0,1.94.76,1.94,2.11v.26h-1.24v-.35c0-.6-.24-.83-.66-.83s-.66.23-.66.83c0,1.73,2.58,2.05,2.58,4.45,0,1.34-.67,2.11-2,2.11s-2-.77-2-2.11v-.51h1.25v.6c0,.6.26.81.68.81s.69-.21.69-.81c0-1.73-2.58-2.06-2.58-4.45C140.6,121,141.26,120.22,142.54,120.22Z"
            fill="#263238"
          />
          <Path d="M144.87,120.31H149v1.2h-1.38v7.2h-1.32v-7.2h-1.38Z" fill="#263238" />
          <Path
            d="M150.85,123.85h1.81v1.2h-1.81v2.46h2.27v1.2h-3.59v-8.4h3.59v1.2h-2.27Z"
            fill="#263238"
          />
          <Path
            d="M157.85,122.39v1.09c0,1.34-.65,2.07-2,2.07h-.63v3.16h-1.32v-8.4h1.95C157.2,120.31,157.85,121,157.85,122.39Zm-2.59-.88v2.84h.63c.42,0,.64-.19.64-.79V122.3c0-.6-.22-.79-.64-.79Z"
            fill="#263238"
          />
          <Path
            d="M162.87,122.37c0-.75-.27-1-.68-1s-.69.23-.69.83v.54h-1.25v-.45a1.84,1.84,0,0,1,2-2.11c1.3,0,2,.76,2,2.11v.21a1.63,1.63,0,0,1-.93,1.73,1.71,1.71,0,0,1,.93,1.76v.66c0,1.34-.67,2.11-2,2.11a1.84,1.84,0,0,1-2-2.11V126h1.25v.78c0,.6.27.82.69.82s.68-.2.68-.94V126c0-.78-.27-1.07-.86-1.07h-.45v-1.2h.52c.49,0,.79-.22.79-.89Z"
            fill="#263238"
          />
          <Line fill="none" stroke="#263238" strokeMiterlimit={10} />
          <Line fill="none" stroke="#263238" strokeMiterlimit={10} />
          <Line fill="none" stroke="#263238" strokeMiterlimit={10} />
          <Line fill="none" stroke="#263238" strokeLinecap="round" strokeLinejoin="round" />
        </AG>
        <AG {...rise(5)}>
          {/**
           * The leaves move; the pot does not.
           *
           * The whole group was being translated, so the plant slid
           * bodily across the floor — a pot on castors rather than a
           * plant in a draught. The pot is the file's last element, a
           * polygon from y 431 to the floor line; everything above it is
           * foliage. Only that part sways.
           *
           * `translateX` rather than a rotation: a `G`'s rotation is not
           * reliably animatable here, which is the same lesson as a
           * circle's `r`. Two degrees of movement at the top of a stem
           * that is anchored in a static pot reads as bending.
           */}
          <AG translateX={sway}>
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M397.72,408.67a5.85,5.85,0,0,0-2.07-4.4c-1.33-1.2-8.35-4.15-9-1.68C385.91,405.28,393.1,410.56,397.72,408.67Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M399,421.16a5.89,5.89,0,0,0-2.06-4.41c-1.34-1.19-8.35-4.14-9-1.67C387.22,417.77,394.4,423.05,399,421.16Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M394.54,378.2a5.86,5.86,0,0,0-2.07-4.4c-1.33-1.19-8.35-4.15-9-1.67C382.73,374.81,389.92,380.09,394.54,378.2Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M395.84,390.69a5.89,5.89,0,0,0-2.06-4.41c-1.34-1.19-8.35-4.14-9-1.67C384,387.3,391.22,392.58,395.84,390.69Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M392.42,357.92a5.89,5.89,0,0,0-2.06-4.41c-1.34-1.19-8.35-4.14-9-1.67C380.62,354.53,387.8,359.81,392.42,357.92Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M390.3,337.55a5.88,5.88,0,0,0-2.07-4.41c-1.33-1.19-8.35-4.14-9-1.67C378.49,334.16,385.67,339.44,390.3,337.55Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M403.21,400.62a5.88,5.88,0,0,1,1.11-4.74c1.06-1.44,7.32-5.78,8.48-3.49C414.06,394.87,408.12,401.51,403.21,400.62Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M399.78,367.76a5.88,5.88,0,0,1,1.11-4.74c1.06-1.44,7.32-5.77,8.48-3.49C410.63,362,404.7,368.66,399.78,367.76Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M398.27,353.32a5.88,5.88,0,0,1,1.12-4.73c1.05-1.45,7.31-5.78,8.47-3.5C409.13,347.57,403.19,354.22,398.27,353.32Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M396.06,332.15a5.88,5.88,0,0,1,1.12-4.73c1.05-1.44,7.31-5.78,8.47-3.5C406.92,326.4,401,333.05,396.06,332.15Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Path
              d="M391.63,323.13a5.87,5.87,0,0,1,1.11-4.74c1.06-1.44,7.32-5.78,8.48-3.5C402.48,317.37,396.55,324,391.63,323.13Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Path
              d="M392,323.37a5.89,5.89,0,0,1-4.6-1.6c-1.32-1.2-5-7.88-2.59-8.8C387.39,312,393.38,318.58,392,323.37Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M410.32,423.21a5.87,5.87,0,0,0-1.11-4.74c-1.06-1.44-7.32-5.77-8.48-3.49C399.47,417.46,405.41,424.1,410.32,423.21Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M413.49,392.74a5.9,5.9,0,0,0-1.12-4.74c-1.06-1.44-7.32-5.77-8.48-3.49C402.63,387,408.57,393.63,413.49,392.74Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M412.19,405.22a5.86,5.86,0,0,0-1.12-4.74c-1.06-1.43-7.31-5.77-8.47-3.49C401.33,399.47,407.27,406.12,412.19,405.22Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M415.59,372.45a5.86,5.86,0,0,0-1.12-4.74c-1.05-1.44-7.31-5.77-8.47-3.49C404.73,366.7,410.68,373.35,415.59,372.45Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M417.7,352.08a5.87,5.87,0,0,0-1.11-4.74c-1.06-1.44-7.32-5.77-8.48-3.49C406.85,346.33,412.79,353,417.7,352.08Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M417.35,416.46a5.88,5.88,0,0,1,2.07-4.41c1.33-1.19,8.34-4.15,9-1.68C429.16,413.06,422,418.34,417.35,416.46Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M420.76,383.6a5.88,5.88,0,0,1,2.07-4.41c1.33-1.19,8.34-4.15,9-1.68C432.57,380.2,425.39,385.48,420.76,383.6Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M422.26,369.16a5.88,5.88,0,0,1,2.07-4.41c1.33-1.19,8.34-4.15,9-1.68C434.07,365.76,426.89,371,422.26,369.16Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M424.46,348a5.89,5.89,0,0,1,2.06-4.41c1.33-1.19,8.35-4.15,9-1.68C436.26,344.59,429.08,349.87,424.46,348Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Path
              d="M422,338.24a5.89,5.89,0,0,1,2.06-4.41c1.33-1.19,8.35-4.15,9-1.67C433.78,334.84,426.6,340.13,422,338.24Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Path
              d="M422.27,338.55A5.87,5.87,0,0,1,418.1,336c-1-1.45-3.25-8.74-.72-9.14C420.13,326.46,424.63,334.15,422.27,338.55Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M405.8,407.92a5.89,5.89,0,0,0-1.6-4.6c-1.2-1.32-7.87-5-8.79-2.6C394.41,403.32,401,409.32,405.8,407.92Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M405.8,381.82a5.87,5.87,0,0,0-1.6-4.59c-1.2-1.32-7.87-5-8.79-2.6C394.41,377.23,401,383.22,405.8,381.82Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M405.8,351.19a5.89,5.89,0,0,0-1.6-4.6c-1.2-1.32-7.87-5-8.79-2.59C394.41,346.59,401,352.59,405.8,351.19Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M405.8,330.8a5.89,5.89,0,0,0-1.6-4.6c-1.2-1.32-7.87-5-8.79-2.6C394.41,326.2,401,332.2,405.8,330.8Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M405.8,310.32a5.89,5.89,0,0,0-1.6-4.6c-1.2-1.32-7.87-5-8.79-2.6C394.41,305.72,401,311.71,405.8,310.32Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M412.1,415.88a5.87,5.87,0,0,1,1.6-4.59c1.2-1.33,7.87-5,8.79-2.6C423.49,411.29,416.89,417.28,412.1,415.88Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M412.1,374.39a5.89,5.89,0,0,1,1.6-4.6c1.2-1.32,7.87-5,8.79-2.6C423.49,369.79,416.89,375.79,412.1,374.39Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M412.1,353.9a5.87,5.87,0,0,1,1.6-4.59c1.2-1.33,7.87-5,8.79-2.6C423.49,349.31,416.89,355.3,412.1,353.9Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M412.1,326.83a5.86,5.86,0,0,1,1.6-4.59c1.2-1.33,7.87-5,8.79-2.6C423.49,322.24,416.89,328.23,412.1,326.83Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="2px" />
            <Path
              d="M412.1,305.55a5.89,5.89,0,0,1,1.6-4.6c1.2-1.32,7.87-5,8.79-2.6C423.49,301,416.89,307,412.1,305.55Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Path
              d="M408.62,296.11a5.89,5.89,0,0,1,1.6-4.6c1.2-1.32,7.88-5,8.8-2.6C420,291.51,413.42,297.51,408.62,296.11Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
            <Path
              d="M408.94,296.39a5.86,5.86,0,0,1-4.4-2.07c-1.19-1.33-4.13-8.35-1.66-9C405.57,284.58,410.84,291.77,408.94,296.39Z"
              fill="#92E3A9"
              stroke="#263238"
              strokeMiterlimit={10}
            />
            <Line fill="none" stroke="#263238" strokeMiterlimit={10} strokeWidth="0.5px" />
          </AG>
          <Polygon
            points="414.6 469 399.9 469 398.06 431.87 416.44 431.87 414.6 469"
            fill="#263238"
            stroke="#263238"
            strokeMiterlimit={10}
          />
        </AG>
        <AG {...rise(6)}>
          <Path
            d="M243.41,356.43l10.14,87.86,10.88-.75,2.63-67.21,6.76-.75,42.43,2.63a61.7,61.7,0,0,1,6.76-1.13c1.5,0,3.38-4.13-5.63-7.88S246,353.43,244.54,353.43,243.41,356.43,243.41,356.43Z"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M302.36,344s-39-12.91-77-4.5c-3.11.69-9.77,80-9.77,80l10.14,3,15.77-62.71s66.08,19.15,79.6,17.27S302.36,344,302.36,344Z"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M313.25,211.51s-3,7.88-3,11.63A19.26,19.26,0,0,0,312,230.5s-5.89,6.39-4.8,8.81c.67,1.51,3.67,2.07,3.67,2.07s2.63,13.88,4.88,14.63,11.64-1.13,11.64-1.13l-1.6,19,18.63-15.82-1.5-12s4.5-6.39,9.76-13.89,2.25-19.53-.75-25.16-25.91-17.27-41.3,1.88Z"
            fill="#9c9c9c"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M374,217.83c-.48-1.69,4.82-2.17,2.89-6.27s-7.71-3.85-7.46-6.74,2.16-2.65-1.21-5.79-6-1.44-7-4.57-1.68-6.27-1.68-6.27l-2.17-1.68c-1.43-1.11-2.75,0-3.49.83-2,.65-3.84,3.25-5.7,3-2.76-.34-3.45-7.58-9-7.24s-3.44,9.31-5.51,8.62-6.21-3.45-11.72-2.07,0,6.55-2.07,6.21-14.13-2.76-15.17.34,6.55,7.24,6.55,7.24-9.31-2.76-6.55,2.41a11.31,11.31,0,0,0,8.48,5.63s-3.7,1.37-2.2,3.06c1.3,1.46,5.55,1.8,6.66,1.86l.2.21c-.36.9-1.55,4.65,2.89,5.81,1.2.31,2.18.51,3,.64l.67.74a21.56,21.56,0,0,0-1.05,3.08c-.69,3.1,4.82,4.83,6.89,4.83s3.79,6.89,2.07,9a2.17,2.17,0,0,0-.48,1.62c-.32.35-.59.63-.73.82-1,1.2-1.93,5.3-.73,6s6,0,6,0,.72,5.78,2.89,6.27,3.85-1.69,4.58-3.38,2.65,2.41,5.54,1.93,4.09-2.65,5.06-4.34,1.92,1.45,6.5.48,2.65-7.71,2.65-7.71,4.34,2.41,6.75.49,3.13-6.27,3.37-9.16,4.1.72,4.1-4.58S374.5,219.51,374,217.83Z"
            fill="#263238"
          />
          <Polygon
            points="327.38 254.88 332.61 253.52 326.99 263.51 327.38 254.88"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M316.56,230.55c0,1.28-.45,2.32-1,2.32s-1-1-1-2.32.45-2.31,1-2.31S316.56,229.28,316.56,230.55Z"
            fill="#263238"
          />
          <Path
            d="M314.25,224.77s2-.86,4.33,1.16"
            fill="none"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M314.11,307.06l-40.41,3.27-13-1.21s-17.89,6.08-14.4,7.25a14,14,0,0,0,7.55-.08,29.81,29.81,0,0,0,10.56,2.1,35.63,35.63,0,0,0,8.71-1.17L318.2,324Z"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M343.66,255.81s-23.28,22.53-27,28.16-5.25,10.51-5.25,15.39,3.38,15.77,3.38,15.77l-4.51,16.15-13.14,12,20.65,33s9.39,1.88,15.77-1.87S344,354.56,344,346.67s-1.5-24.78-1.5-24.78,8.64-27,11.27-37.17,3-19.15.37-24S347.41,253.18,343.66,255.81Z"
            fill="#fff"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M316.62,284a38.58,38.58,0,0,0-2.07,3.47c9.87,1.37,23.38,3.48,36.69,6.31.52-1.76,1-3.43,1.44-5-12.56-2.68-25.29-4.72-35.09-6.12C317.2,283.17,316.87,283.6,316.62,284Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M354.11,283.45c.42-1.72.77-3.41,1.05-5.05l-27.19-7c-1.42,1.45-2.8,2.89-4.11,4.26Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M343.18,319.86l1.59-5.05c-9.86-.72-20.69-1.53-30.79-2.3.44,1.58.77,2.62.77,2.62l-.71,2.55C323.59,318.41,333.78,319.17,343.18,319.86Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M355.8,273.43a39.59,39.59,0,0,0,.11-5.39L337.36,262l-4.1,4.08Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M331.57,375.4c-8.28-6.61-18.87-15-28.73-22.93l8.22,13.16L325,376.75A21.27,21.27,0,0,0,331.57,375.4Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M342.83,325.4c-10.65-.17-21.57-.46-30.69-.92l-1.42,5.09c9.6.51,21.23.82,32.51,1C343.08,328.62,342.94,326.84,342.83,325.4Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M311.9,294.47a22.8,22.8,0,0,0-.53,4.89v.25c10.6.32,23.9,1.46,37.23,2.89.52-1.69,1-3.38,1.53-5C336.56,296,322.91,294.81,311.9,294.47Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M311.06,346c-3.91-1.81-7.68-3.55-11.23-5.17l-2.73,2.49,1.69,2.7,10.1,4.65A306.63,306.63,0,0,0,341,362.72c.56-1.62,1.06-3.3,1.47-5C331.88,354.33,320.06,350.14,311.06,346Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M344,346.67c0-1.18,0-2.57-.09-4.08a306.56,306.56,0,0,1-36.75-8.52l-4.44,4.05a318.55,318.55,0,0,0,41.25,9.7C344,347.42,344,347,344,346.67Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M253.55,444.29l-12.77,14.27s-9.76,3-11.26,4.51,1.5,2.25,5.25,3.75,17.65-.75,22.16-1.13,8.63,0,10.13-3.75,0-7.89-.37-9.39-2.26-9-2.26-9Z"
            fill="#9c9c9c"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M240.14,458.76c-2.16.69-9.35,3-10.62,4.31-1.5,1.5,1.5,2.25,5.25,3.75s17.65-.75,22.16-1.13,8.63,0,10.13-3.75,0-7.89-.37-9.39c0-.17-.11-.42-.18-.73-6.56,4.11-17.71,8.62-20.1,8.62A21.33,21.33,0,0,1,240.14,458.76Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M215.62,419.51S201,435.66,199.1,437.91s-7.5,3-7.13,5.63,6.38,1.88,9,1.5,19.15-4.5,21.4-5.25,5.26-1.88,5.64-5.26-2.26-12-2.26-12Z"
            fill="#9c9c9c"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M228,434.53c.23-2.11-.71-6.26-1.44-9.09-3.69,1.8-7.25,6.67-9.08,7.59-2.25,1.12-19.52,6.76-19.52,6.76l-.79-.45c-2.36,1.3-5.5,2.22-5.22,4.2.38,2.63,6.38,1.88,9,1.5s19.15-4.5,21.4-5.25S227.64,437.91,228,434.53Z"
            fill="#92E3A9"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M351.76,259.54c-3.26-1.81-9.78,1.45-11.95,5.07l-2.89,10.86-10.5,35.12-52.72-.26s-14.92-3.29-17.09-3.24-13.24,7.18-13.22,8.26,2.92,1,2.92,1l5.06-.47,5.41-1.21s4.73,1.34,6.91,1.29a31.16,31.16,0,0,0,5.41-.84S326.05,328,329.67,328s7.61-1.09,9.06-3.62,16.65-40.19,17.37-48.52S355,261.35,351.76,259.54Z"
            fill="#9c9c9c"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M246.65,315.77s8.4-4.49,9.33-4.67"
            fill="none"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M254.68,308.67s-9.53,5.42-10.09,7.47"
            fill="none"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M368,265l-6-.34s-15.45,44.67-17.47,61.46-1.34,30.89-.33,35.59,6.38,13.77,6.38,13.77l6.71,1.68s-7-18.14-7.38-23.17.53-25,1-27.54C354.59,307,368,265,368,265Z"
            fill="#6e6e6e"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M314,436.28S280.71,453.07,280,456.76a31.37,31.37,0,0,0,0,8.39l1.18-1.17,3.19-7.56,29.88-14.1Z"
            fill="#6e6e6e"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M286.09,463.81a3.7,3.7,0,1,1-3.7-3.69A3.7,3.7,0,0,1,286.09,463.81Z"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M323.69,436.28s33.25,16.79,33.92,20.48a31.37,31.37,0,0,1,0,8.39L356.43,464l-3.19-7.56-29.88-14.1Z"
            fill="#6e6e6e"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M351.57,463.81a3.69,3.69,0,1,0,3.69-3.69A3.7,3.7,0,0,0,351.57,463.81Z"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={315.64}
            y={381.54}
            width={5.37}
            height={58.43}
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={310.6}
            y={387.25}
            width={15.78}
            height={10.75}
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M356,376.43c-11.63-1.22-49.09-4.47-82.68,0a1.54,1.54,0,0,0-.83,2.64c3.57,3.37,13.48,9.49,39.13,11.17,26.5,1.74,40-6.4,45.31-10.78A1.74,1.74,0,0,0,356,376.43Z"
            fill="#6e6e6e"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M272.45,379.07l.07.06a1.5,1.5,0,0,0,1,.4h83.31l.06,0a1.73,1.73,0,0,0-.94-3.05c-11.64-1.22-49.09-4.47-82.67,0A1.53,1.53,0,0,0,272.45,379.07Z"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={312.28}
            y={430.9}
            width={12.42}
            height={13.1}
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={317.15}
            y={437.45}
            width={1.85}
            height={30.05}
            fill="#6e6e6e"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x={316.43}
            y={459.67}
            width={3.25}
            height={7.87}
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polygon
            points="331.08 379.53 323.69 379.53 318.99 334.53 324.03 334.53 331.08 379.53"
            fill="#6e6e6e"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M343.84,337.55h-50.7s3.69-6.71,6-7.38,40.63,0,40.63,0S343.84,331.51,343.84,337.55Z"
            fill="#263238"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M293.14,337.55h50.7a12.4,12.4,0,0,0-.12-1.68H294.13C293.53,336.85,293.14,337.55,293.14,337.55Z"
            fill="#6e6e6e"
            stroke="#263238"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </AG>
      </Svg>
    </View>
  )
}
