import { FC } from "react"
import Svg, { Path } from "react-native-svg"

/**
 * One turn of a serpentine timeline: down, round, across, round, down.
 *
 * ## The path is computed, not stretched
 *
 * It was authored once in a 300×80 box and scaled onto whatever size it was
 * given. That is the obvious way and it produced two different wrong shapes:
 *
 * - **Stretched corners.** The turn has to be as tall as the two rows it joins,
 *   about 110pt for a two-line card. Scaling a path drawn for 80 leaves long
 *   straight verticals with the corner radius they were authored with, so it
 *   reads as a bracket rather than a road.
 * - **A diagonal drape.** Replacing the corners with a single cubic fixed the
 *   stiffness and lost the road: one curve from one column to the other is a
 *   sash lying across the page, not a route that turns.
 *
 * Computing from the real width and height fixes both, because **the corner
 * radius can then scale with the height**. The turns absorb the extra distance
 * instead of the straights, so a tall turn is a rounder corner rather than a
 * longer stalk, and the run across the gap stays horizontal — which is what
 * makes it read as a road at all.
 *
 * It also removes the reason the old version needed `vectorEffect`: nothing is
 * transformed, so the stroke is the weight it says it is on every device.
 *
 * ## The endpoints are a contract
 *
 * A turn starts and ends at `PATH_INSET` and `1 - PATH_INSET` of the width, at
 * the very top and bottom edges. Whatever places these has to put its markers
 * on those two columns, which is why the inset is exported rather than written
 * down in two files that can disagree.
 */
export interface TimelinePathProps {
  /**
   * Which way the turn travels.
   *
   * `right` starts at the left column and ends at the right; `left` mirrors it.
   * Alternating them is the whole of a serpentine.
   */
  towards: "left" | "right"
  width: number
  height?: number
  stroke: string
  strokeWidth?: number
  /**
   * Where across its own height the road crosses, as a fraction. Defaults to
   * the middle.
   *
   * It has to be told, because the middle is only right when the two rows it
   * joins are the same height. A turn spans from one marker's centre to the
   * next, and each marker sits at its own card's centre — so with an expanded
   * card above and a collapsed one below, the halfway point of the turn falls
   * *inside* the taller card and the road runs under it. The caller knows where
   * the gap actually is; this does not.
   */
  crossAt?: number
  /** Marks a run that has not been travelled yet. */
  dashed?: boolean
}

/** Where a turn meets a marker, as a fraction of the width. */
export const PATH_INSET = 0.1

/** How tall one turn is, before anyone overrides it. */
export const PATH_HEIGHT = 80

/**
 * The corner, and it is a **constant** rather than a share of the height.
 *
 * This is the whole shape. Setting the radius from the height — `height / 2`,
 * which is what "let the turns absorb the extra distance" produced — means a
 * tall turn has no straight left in it at all: at the ~110pt two rows need, the
 * radius was 55 and the path was one continuous sweep. A road drawn that way is
 * a sash lying across the page.
 *
 * Fixed, the extra height goes where it should: into the **straight runs**, so
 * a turn is a short corner with rail above and below it. That rail is what runs
 * down beside each card, and it is why the road reads as one continuous route
 * rather than as a series of separate bends between cards.
 */
const CORNER = 22

/**
 * Down the near column, round, across, round, down the far one.
 *
 * `CORNER` is capped by what the height and the horizontal run can actually
 * spare, so the two corners can never eat into each other: a short gap or a
 * narrow screen degrades to a tighter corner rather than to a path that doubles
 * back on itself.
 */
function turnPath(width: number, height: number, towards: "left" | "right", crossAt: number) {
  const near = towards === "right" ? PATH_INSET * width : (1 - PATH_INSET) * width
  const far = towards === "right" ? (1 - PATH_INSET) * width : PATH_INSET * width
  const mid = height * Math.min(0.9, Math.max(0.1, crossAt))
  const direction = towards === "right" ? 1 : -1

  /* Capped by whichever side of the crossing has less room, so an off-centre
     crossing tightens the corners rather than letting one overshoot the end. */
  const radius = Math.min(CORNER, mid, height - mid, Math.abs(far - near) / 2)

  return [
    `M ${near} 0`,
    `V ${mid - radius}`,
    `Q ${near} ${mid} ${near + direction * radius} ${mid}`,
    `H ${far - direction * radius}`,
    `Q ${far} ${mid} ${far} ${mid + radius}`,
    `V ${height}`,
  ].join(" ")
}

export const TimelinePath: FC<TimelinePathProps> = function TimelinePath({
  towards,
  width,
  height = PATH_HEIGHT,
  stroke,
  strokeWidth = 14,
  crossAt = 0.5,
  dashed = false,
}) {
  return (
    <Svg width={width} height={height} pointerEvents="none" accessibilityElementsHidden>
      <Path
        d={turnPath(width, height, towards, crossAt)}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? "1 14" : undefined}
        fill="none"
      />
    </Svg>
  )
}
