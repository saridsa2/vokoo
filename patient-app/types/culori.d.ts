/**
 * `culori` ships ESM without bundled declarations, and the vendored AntV tree
 * reaches for it in three places for colour conversion.
 *
 * Every export is declared `any` through an index signature rather than typed
 * exhaustively. This is somebody else's dependency, used only by vendored code,
 * and writing a speculative full typing would be inventing a contract nobody
 * here maintains — while enumerating exactly the symbols upstream imports today
 * would break the next time they import one more.
 */
declare module "culori" {
  export const formatHex: any
  export const formatHex8: any
  export const formatRgb: any
  export const parse: any
  export const converter: any
  export const interpolate: any
  export const modeOklch: any
  export const modeRgb: any
  export const modeHsl: any
  export const oklch: any
  export const rgb: any
  export const useMode: any
  export const wcagLuminance: any
  export const wcagContrast: any
  export const differenceEuclidean: any
  export const clampChroma: any
  export type Color = any
}
