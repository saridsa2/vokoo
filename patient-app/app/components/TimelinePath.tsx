import { FC } from "react"
import Svg, { Path } from "react-native-svg"

/**
 * One S-bend of a serpentine timeline, authored once and scaled to fit.
 *
 * ## The geometry is written at one size and only ever scaled
 *
 * The curve lives in a **300×80 authoring box**. Nothing recomputes it per
 * device: the box is stretched onto whatever width and height it is given, with
 * `scale(width / 300, height / 80)`. That is what makes a phone and a tablet the
 * same component rather than two — the alternative is control points computed
 * from a device width, which is a new curve at every size and a new chance for
 * one of them to be wrong.
 *
 * The scale is deliberately **non-uniform**. A `viewBox` alone preserves the
 * aspect ratio, so a tablet twice as wide would also want an S-bend twice as
 * tall, and the whole list would grow past a screen. Stretching lets the bend
 * stay 80pt tall and simply get wider, which is what a wider screen actually
 * wants.
 *
 * ## Why the stroke is exempt from that scale
 *
 * A stroke is scaled along with its path, so on a 760pt tablet a 6pt rail would
 * be drawn at 15 — and, under a non-uniform scale, thicker on the horizontal
 * run than on the vertical ones. `vectorEffect="non-scaling-stroke"` takes the
 * stroke out of the transform: the same weight on every device, which is what
 * a rule between two points is supposed to be.
 *
 * ## The endpoints are a contract
 *
 * The curve starts and ends at **10% and 90% of the width**, at the very top and
 * bottom edges. Whatever places these has to put its markers on those two
 * columns, which is why `PATH_INSET` is exported rather than written down in
 * two files that can disagree.
 */
export interface TimelinePathProps {
  /**
   * Which way the bend travels.
   *
   * `right` starts at the left column and ends at the right; `left` is its
   * mirror. Alternating them is the whole of a serpentine.
   */
  towards: "left" | "right"
  width: number
  height?: number
  stroke: string
  strokeWidth?: number
  /** Marks a run that has not been travelled yet. */
  dashed?: boolean
}

/** The authoring box. Every path below is drawn in these coordinates. */
const BOX_W = 300
const BOX_H = 80

/** Where the curve meets a marker, as a fraction of the width. */
export const PATH_INSET = 30 / BOX_W

/** How tall one bend is on screen, before anyone overrides it. */
export const PATH_HEIGHT = 80

const LEFT = 30
const RIGHT = BOX_W - 30

/* Down out of the previous marker, across the middle, down into the next. The
   two variants are exact mirrors, so a run of them reads as one continuous
   line rather than as a series of similar shapes. */
const TO_RIGHT = `M ${LEFT} 0 V 10 C ${LEFT} 28 ${LEFT + 14} 42 ${LEFT + 32} 42 H ${RIGHT - 32} C ${RIGHT - 14} 42 ${RIGHT} 56 ${RIGHT} 74 V ${BOX_H}`
const TO_LEFT = `M ${RIGHT} 0 V 10 C ${RIGHT} 28 ${RIGHT - 14} 42 ${RIGHT - 32} 42 H ${LEFT + 32} C ${LEFT + 14} 42 ${LEFT} 56 ${LEFT} 74 V ${BOX_H}`

export const TimelinePath: FC<TimelinePathProps> = function TimelinePath({
  towards,
  width,
  height = PATH_HEIGHT,
  stroke,
  strokeWidth = 6,
  dashed = false,
}) {
  return (
    <Svg width={width} height={height} pointerEvents="none" accessibilityElementsHidden>
      <Path
        d={towards === "right" ? TO_RIGHT : TO_LEFT}
        transform={`scale(${width / BOX_W} ${height / BOX_H})`}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dashed ? "1 14" : undefined}
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
    </Svg>
  )
}
