import { createElement, type ReactNode } from "react"
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  Line,
  LinearGradient,
  Mask,
  Path,
  Polygon,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
  TSpan,
  Use,
} from "react-native-svg"

import { processElement } from "@/vendor/antv/jsx/renderer"
import type { JSXElement, JSXNode, RenderContext } from "@/vendor/antv/jsx/types"
import { createDefaultContext, getElementBounds, getRenderableChildrenOf } from "@/vendor/antv/jsx/utils"

/**
 * AntV's renderer, rewritten to draw with `react-native-svg`.
 *
 * It lives outside `vendor/antv` on purpose: everything under that directory
 * compiles against AntV's JSX runtime via a Babel override, and this file is
 * ours and uses React's. Keeping the vendored tree untouched is also what makes
 * re-vendoring a newer AntV a copy rather than a merge.
 *
 * ## What this replaces, and what it does not
 *
 * Upstream ends in `renderSVG`, which walks the processed tree and concatenates
 * an **SVG string**. A string is no use to React Native, and it is the *only*
 * part of their pipeline that is browser-shaped. Everything before it —
 * expanding function components, running their flex layout, measuring text,
 * collecting `<defs>` — is arithmetic over plain objects and runs here
 * untouched.
 *
 * So this file is deliberately small. `processElement` still does the work;
 * this walks what it returns and emits React elements instead of markup. Their
 * ~20k lines of structures, items and layouts are vendored unmodified.
 *
 * ## Why the port is possible at all
 *
 * Their JSX runtime returns plain `{ type, props }` objects rather than React
 * elements — see `jsx/jsx-runtime.ts`. The vendored tree therefore never
 * imports React and has no opinion about what draws it. That separation is
 * theirs, not something introduced here, and it is what makes a fork this
 * shallow possible.
 *
 * ## The one thing that had to be solved for a phone
 *
 * Their layout computes a canvas from its content, which is why every server
 * render came back landscape and ignored the size requested. Their own
 * `getElementBounds` already produces the right `viewBox`; handing that to an
 * `<Svg>` with `width="100%"` lets the geometry keep its natural coordinates
 * and scale into whatever width the phone has. Portrait stops being a question
 * the template has to answer.
 */

/**
 * SVG tag → `react-native-svg` component.
 *
 * `react-native-svg` covers the drawing primitives and not the document ones.
 * Anything absent here is skipped rather than approximated — see `NOT_DRAWN`.
 */
const TAGS: Record<string, React.ComponentType<any>> = {
  g: G,
  rect: Rect,
  circle: Circle,
  ellipse: Ellipse,
  path: Path,
  polygon: Polygon,
  polyline: Polyline,
  line: Line,
  text: SvgText,
  tspan: TSpan,
  image: SvgImage,
  use: Use,
  defs: Defs,
  linearGradient: LinearGradient,
  radialGradient: RadialGradient,
  stop: Stop,
  clipPath: ClipPath,
  mask: Mask,
}

/**
 * Elements with no counterpart on this platform.
 *
 * `foreignObject` is how upstream places HTML text inside an SVG, and
 * `filter`/`feDropShadow` are how it softens edges. Neither exists in
 * `react-native-svg`. They are dropped silently rather than approximated,
 * because a shadow drawn wrong is worse than no shadow, and a `foreignObject`
 * faked with SVG text would lose the wrapping that was the reason to use one.
 */
const NOT_DRAWN = new Set(["foreignobject", "filter", "fedropshadow", "fegaussianblur", "feoffset"])

function toElement(node: JSXNode, context: RenderContext, key: string): ReactNode {
  if (node == null || typeof node === "boolean") return null
  if (typeof node === "string" || typeof node === "number") return node

  if (Array.isArray(node)) {
    return node.map((child, i) => toElement(child, context, `${key}.${i}`))
  }

  const element = node as JSXElement
  const { type, props } = element
  if (!type) return null

  /* Fragments and Defs are flattened by `processElement`; a symbol arriving
     here means the tree was not processed, which is a caller error. */
  if (typeof type === "symbol") {
    return getRenderableChildrenOf(element).map((child, i) =>
      toElement(child, context, `${key}.${i}`),
    )
  }

  if (typeof type === "function") {
    /* Upstream warns here too. An unexpanded component means `processElement`
       was skipped, and rendering nothing is clearer than rendering half. */
    console.warn("[antv-native] unprocessed component reached the renderer:", type)
    return null
  }

  const tag = String(type)
  if (NOT_DRAWN.has(tag.toLowerCase())) return null

  const Component = TAGS[tag]
  if (!Component) {
    console.warn(`[antv-native] no react-native-svg equivalent for <${tag}>`)
    return null
  }

  const { children: _children, ...rest } = props ?? {}
  const kids = getRenderableChildrenOf(element).map((child, i) =>
    toElement(child, context, `${key}.${i}`),
  )

  /* Props stay camelCase. Upstream only kebab-cases them inside its string
     emitter, and `react-native-svg` wants camelCase anyway — so the tree that
     reaches here needs no attribute translation at all. */
  return createElement(Component, { key, ...rest }, kids.length ? kids : undefined)
}

export interface RenderNativeProps {
  /** Falls back to the bounds AntV computes from the content. */
  viewBox?: string
  width?: number | string
  height?: number | string
  style?: object
}

/**
 * Draw an AntV element tree with `react-native-svg`.
 *
 * The counterpart of upstream's `renderSVG`, returning React elements rather
 * than a string.
 */
export function renderNative(element: JSXNode, props: RenderNativeProps = {}): ReactNode {
  const context = createDefaultContext()
  const processed = processElement(element, context)
  if (!processed) return null

  const content = toElement(processed, context, "n")

  /* `processElement` strips `<Defs>` out of the tree and banks its children on
     the context, so they have to be put back — inside a real <Defs>, or every
     `url(#…)` reference in the drawing resolves to nothing. */
  const defs = [...context.defs.entries()].map(([id, node]) => toElement(node, context, `def.${id}`))

  const bounds = getElementBounds(processed)
  const viewBox =
    props.viewBox ??
    (bounds ? `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}` : undefined)

  return (
    <Svg
      width={props.width ?? "100%"}
      height={props.height}
      viewBox={viewBox}
      style={[
        /* Natural proportions, scaled to the available width. Without this the
           SVG collapses to zero height in a flex column. */
        bounds && bounds.height > 0 ? { aspectRatio: bounds.width / bounds.height } : null,
        props.style,
      ]}
    >
      {defs.length ? <Defs>{defs}</Defs> : null}
      {content}
    </Svg>
  )
}
