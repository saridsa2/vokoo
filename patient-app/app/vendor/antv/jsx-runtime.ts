/**
 * The automatic-JSX entry point for the vendored AntV tree.
 *
 * Mirrors `src/jsx-runtime.ts` in AntV upstream. It exists so that
 * `jsxImportSource` can name this directory: every `.tsx` under `vendor/antv`
 * compiles against **AntV's** runtime, which returns plain `{ type, props }`
 * objects, rather than React's, which returns React elements.
 *
 * That separation is the whole basis of the port. The vendored code stays pure
 * — data in, a tree of description objects out — and never imports React. What
 * turns that tree into something a phone can draw is `renderer-native.tsx`,
 * which is ours.
 */
export * from "./jsx/jsx-runtime"
