export type FontAwesomeFamily = 'brands' | 'classic' | 'sharp';

export type FontAwesomeStyle =
  | 'brands'
  | 'duotone'
  | 'duotone-light'
  | 'duotone-regular'
  | 'duotone-solid'
  | 'duotone-thin'
  | 'light'
  | 'regular'
  | 'solid'
  | 'thin';

export type FontAwesomeVariantKey = `${FontAwesomeFamily}:${FontAwesomeStyle}`;

export interface FontAwesomeIconRecord {
  aliases: string[];
  categories: string[];
  label: string;
  name: string;
  terms: string[];
  variants: Partial<Record<FontAwesomeVariantKey, string>>;
}

export interface FontAwesomeIndex {
  schemaVersion: 1;
  version: string;
  icons: FontAwesomeIconRecord[];
}

export interface FontAwesomeMetadataIcon {
  aliases?: { names?: string[] };
  label?: string;
  search?: { terms?: string[] };
}

export interface FontAwesomeCategory {
  icons: string[];
  label: string;
}

export interface BuildFontAwesomeIndexInput {
  categories: Record<string, FontAwesomeCategory>;
  metadata: Record<string, FontAwesomeMetadataIcon>;
  svgEntries: string[];
  version: string;
}

export interface FontAwesomeVariant {
  family: FontAwesomeFamily;
  style: FontAwesomeStyle;
}

export interface FontAwesomeResolvedIcon {
  icon: FontAwesomeIconRecord;
  name: string;
  path: string;
  variant: FontAwesomeVariantKey;
}

export type FontAwesomeMatchField =
  'alias' | 'category' | 'label' | 'name' | 'term';

export interface FontAwesomeSearchResult {
  label: string;
  matchedBy: FontAwesomeMatchField[];
  name: string;
  score: number;
}

export interface LocalIconPath {
  d: string;
  opacity?: number;
}

export interface LocalIconGraphic {
  name: string;
  paths: LocalIconPath[];
  viewBox: [number, number, number, number];
}

export interface FontAwesomeGraphicColors {
  primaryColor: string;
  secondaryColor?: string;
}

export interface FontAwesomePack {
  index: FontAwesomeIndex;
  load(name: string, variant: FontAwesomeVariant): Promise<LocalIconGraphic>;
  resolve(name: string, variant: FontAwesomeVariant): FontAwesomeResolvedIcon;
  search(query: string, limit?: number): FontAwesomeSearchResult[];
}
