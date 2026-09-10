import { useMemo } from "react"
import { View, ViewStyle } from "react-native"

import { renderNative } from "@/components/antv/renderer-native"
import "@/vendor/antv/designs"
import { jsx } from "@/vendor/antv/jsx/jsx-runtime"
import { parseOptions } from "@/vendor/antv/options"
import type { Data } from "@/vendor/antv/types"

/**
 * An AntV infographic, drawn natively.
 *
 * ## What this is
 *
 * The React Native counterpart of AntV's `Infographic` class. Theirs manages a
 * DOM container — it calls `container.replaceChildren(node)` and renders through
 * `renderSVG`, which returns markup — so it cannot be used here. What *can* be
 * used is the one method inside it that matters, `compose`, which does nothing
 * browser-shaped:
 *
 * ```
 * renderSVG(<Structure data Title Item Items options {...structureProps} />)
 * ```
 *
 * This builds that same element and hands it to `renderNative` instead. Their
 * parser, registry, structures, items, layouts and text measurement all run
 * untouched; only the final emission changes.
 *
 * ## Two accommodations the platform needs
 *
 * **The element is built with their `jsx()` rather than JSX syntax.** A
 * structure is an AntV component returning `{ type, props }`, and this file
 * compiles against React's runtime — writing `<Structure …>` here would produce
 * a React element that their pipeline cannot process. Calling `jsx` directly
 * says exactly what is meant.
 *
 * **`container` is passed as an object, not a selector.** `parseOptions`
 * reaches for `document.querySelector` when handed a string, and there is no
 * document here. Anything non-string short-circuits that branch; nothing else
 * in the parser touches the DOM.
 *
 * The `import "@/vendor/antv/designs"` is a side-effect import and load-bearing:
 * structures, items and templates register themselves on module load, so
 * without it every lookup returns undefined and the screen renders blank.
 */
export interface InfographicProps {
  /** A built-in template key, e.g. `sequence-snake-steps-pill-badge`. */
  template: string
  /**
   * Borrowed from AntV rather than restated.
   *
   * Their `Data` is a union — statistics data wants a numeric `value`, other
   * shapes do not — and a hand-written approximation here would drift from it
   * the first time they add a variant.
   */
  data: Data
  /** Overrides the template's own palette. Ours is meaning-bearing; theirs is decorative. */
  palette?: string[]
  style?: ViewStyle
}

export function Infographic({ template, data, palette, style }: InfographicProps) {
  const drawing = useMemo(() => {
    const parsed = parseOptions({
      /* Not a selector: see the note above. */
      container: {} as never,
      template,
      data,
      ...(palette ? { theme: { palette } as never } : {}),
    })

    const design = parsed.design
    if (!design?.structure) {
      console.warn(`[antv] no structure for template "${template}"`)
      return null
    }

    const { component: Structure, props: structureProps } = design.structure

    return renderNative(
      jsx(Structure, {
        data: parsed.data,
        Title: design.title?.component,
        Item: design.item?.component,
        Items: design.items?.map((it) => it.component),
        options: parsed,
        ...structureProps,
      }),
    )
  }, [template, data, palette])

  return <View style={style}>{drawing}</View>
}
