

export type RGB = readonly [number, number, number];

export interface ShaderVariant {

  id: string;

  label: string;

  description: string;

  swatch: string;

  hero: {
    base: RGB;

    warm: RGB;

    mid: RGB;

    cool: RGB;

    cursor: RGB;

    rgScale: RGB;

    brightness: number;
  };

  wave: readonly [RGB, RGB, RGB, RGB, RGB];
}

const rgb = (r: number, g: number, b: number): RGB => [r, g, b];

export const SHADER_VARIANTS: readonly ShaderVariant[] = [
  {
    // **Drawn from the mark, not chosen from a palette.**
    //
    // `sarvathra-mark@2x.png` is an S built from concentric arcs — a
    // fingerprint and a set of sound waves at once — and it carries a gradient
    // this shader can run on directly. Sampled off the file rather than
    // guessed:
    //
    //   #15576e  the arcs' left edge, deep teal
    //   #1080a8  the midtones, the single most common colour in the mark
    //   #0f61eb  the arcs' right edge, vivid blue
    //
    // The hero stops sit well below those values because `brightness` (2.5)
    // multiplies them; the wave stops are close to literal because that shader
    // does not.
    //
    // It is the only variant, and the switcher is gone. Five palettes is a
    // template demonstrating itself. A company has one.
    id: "sarvathra",
    label: "Sarvathra",
    description: "The mark's own teal through blue",
    swatch: "#1080a8",
    hero: {
      base: rgb(0.004, 0.016, 0.026),
      warm: rgb(0.024, 0.100, 0.300),
      mid: rgb(0.020, 0.150, 0.210),
      cool: rgb(0.020, 0.110, 0.140),
      cursor: rgb(0.008, 0.030, 0.050),
      rgScale: rgb(1.0, 1.0, 1.0),
      brightness: 2.5,
    },
    wave: [
      rgb(0.055, 0.230, 0.290),
      rgb(0.050, 0.360, 0.470),
      rgb(0.063, 0.502, 0.659),
      rgb(0.060, 0.440, 0.800),
      rgb(0.059, 0.380, 0.922),
    ],
  },
  {

    id: "warm",
    label: "Warm",
    description: "Coral, peach, golden",
    swatch: "#ff945e",
    hero: {

      base: rgb(0.10, 0.00, 0.00),
      warm: rgb(0.90, 0.10, 0.10),
      mid: rgb(0.60, 0.50, 0.10),
      cool: rgb(0.10, 0.35, 0.45),
      cursor: rgb(0.18, 0.06, 0.02),

      rgScale: rgb(0.825, 0.825, 1.0),
      brightness: 2.5,
    },
    wave: [
      rgb(1.00, 0.32, 0.42), 
      rgb(1.00, 0.58, 0.38), 
      rgb(1.00, 0.82, 0.38), 
      rgb(0.70, 0.62, 1.00), 
      rgb(0.45, 0.72, 1.00), 
    ],
  },
  {

    id: "mono",
    label: "Mono",
    description: "Charcoal to silver, no hue",
    swatch: "#8a8a8a",
    hero: {
      base: rgb(0.02, 0.02, 0.03),

      warm: rgb(0.38, 0.38, 0.42),
      mid: rgb(0.18, 0.18, 0.22),
      cool: rgb(0.55, 0.55, 0.60),
      cursor: rgb(0.06, 0.06, 0.08),
      rgScale: rgb(1.0, 1.0, 1.0),

      brightness: 1.5,
    },
    wave: [

      rgb(0.06, 0.06, 0.08), 
      rgb(0.20, 0.20, 0.24), 
      rgb(0.38, 0.38, 0.42), 
      rgb(0.58, 0.58, 0.62), 
      rgb(0.76, 0.76, 0.80), 
    ],
  },
  {

    id: "twilight",
    label: "Twilight",
    description: "Cyan, magenta, and violet",
    swatch: "#7d4dff",
    hero: {
      base: rgb(0.02, 0.02, 0.10),

      warm: rgb(0.10, 0.85, 0.80),

      mid: rgb(0.85, 0.20, 0.65),

      cool: rgb(0.35, 0.20, 0.75),

      cursor: rgb(0.16, 0.04, 0.14),
      rgScale: rgb(1.0, 1.0, 1.0),
      brightness: 1.9,
    },
    wave: [

      rgb(0.20, 0.85, 0.85), 
      rgb(0.45, 0.95, 0.70), 
      rgb(0.95, 0.40, 0.80), 
      rgb(0.65, 0.30, 0.95), 
      rgb(0.30, 0.45, 0.95), 
    ],
  },
  {

    id: "coffee",
    label: "Coffee",
    description: "Espresso, caramel, milk",
    swatch: "#7a4a22",
    hero: {

      base: rgb(0.025, 0.015, 0.005),

      warm: rgb(0.15, 0.085, 0.04),

      mid: rgb(0.22, 0.13, 0.06),

      cool: rgb(0.27, 0.18, 0.10),
      cursor: rgb(0.08, 0.04, 0.015),
      rgScale: rgb(1.0, 1.0, 1.0),

      brightness: 2.5,
    },
    wave: [

      rgb(0.165, 0.078, 0.031), 
      rgb(0.290, 0.157, 0.094), 
      rgb(0.431, 0.247, 0.118), 
      rgb(0.541, 0.333, 0.188), 
      rgb(0.659, 0.416, 0.243), 
    ],
  },
  {

    id: "royal",
    label: "Royal",
    description: "Royal blue, petrol, and teal",
    swatch: "#2960e0",
    hero: {

      base: rgb(0.005, 0.012, 0.030),

      warm: rgb(0.064, 0.152, 0.352),

      mid: rgb(0.040, 0.220, 0.248),

      cool: rgb(0.024, 0.140, 0.116),
      cursor: rgb(0.008, 0.028, 0.045),
      rgScale: rgb(1.0, 1.0, 1.0),
      brightness: 2.5,
    },
    wave: [

      rgb(0.040, 0.080, 0.220), 
      rgb(0.140, 0.300, 0.620), 
      rgb(0.080, 0.480, 0.620), 
      rgb(0.060, 0.500, 0.420), 
      rgb(0.080, 0.420, 0.300), 
    ],
  },
] as const;

const VARIANT_MAP: Map<string, ShaderVariant> = new Map(
  SHADER_VARIANTS.map((v) => [v.id, v]),
);

export function getVariantById(id: string | undefined): ShaderVariant {
  if (id && VARIANT_MAP.has(id)) return VARIANT_MAP.get(id)!;
  return SHADER_VARIANTS[0]!;
}

export type ShaderVariantId = (typeof SHADER_VARIANTS)[number]["id"];
