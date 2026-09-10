import { uniqueSorted } from './normalize';
import type {
  BuildFontAwesomeIndexInput,
  FontAwesomeFamily,
  FontAwesomeIndex,
  FontAwesomeStyle,
  FontAwesomeVariantKey,
} from './types';

function getVariantKey(directory: string): FontAwesomeVariantKey | null {
  if (directory === 'brands') return 'brands:brands';
  if (directory.startsWith('sharp-')) {
    return `sharp:${directory.slice('sharp-'.length)}` as FontAwesomeVariantKey;
  }

  const classicStyles = new Set<FontAwesomeStyle>([
    'duotone',
    'duotone-light',
    'duotone-regular',
    'duotone-thin',
    'light',
    'regular',
    'solid',
    'thin',
  ]);
  if (!classicStyles.has(directory as FontAwesomeStyle)) return null;
  return `${'classic' satisfies FontAwesomeFamily}:${directory}` as FontAwesomeVariantKey;
}

function collectVariantPaths(svgEntries: string[]) {
  const paths = new Map<string, Map<FontAwesomeVariantKey, string>>();

  svgEntries.forEach((entry) => {
    const match = entry.match(/(?:^|\/)svgs\/([^/]+)\/([^/]+)\.svg$/);
    if (!match) return;
    const [, directory, name] = match;
    const variant = getVariantKey(directory);
    if (!variant) return;
    const iconVariants = paths.get(name) || new Map();
    iconVariants.set(variant, `svgs/${directory}/${name}.svg`);
    paths.set(name, iconVariants);
  });

  return paths;
}

export function buildFontAwesomeIndex({
  categories,
  metadata,
  svgEntries,
  version,
}: BuildFontAwesomeIndexInput): FontAwesomeIndex {
  const variantsByName = collectVariantPaths(svgEntries);
  const categoriesByName = new Map<string, string[]>();

  Object.entries(categories).forEach(([category, definition]) => {
    definition.icons.forEach((name) => {
      const iconCategories = categoriesByName.get(name) || [];
      iconCategories.push(category);
      categoriesByName.set(name, iconCategories);
    });
  });

  const icons = Object.entries(metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, definition]) => {
      const variants = variantsByName.get(name);
      if (!variants?.size) return [];

      const sortedVariants = Object.fromEntries(
        Array.from(variants.entries()).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );

      return [
        {
          aliases: uniqueSorted(definition.aliases?.names || []),
          categories: uniqueSorted(categoriesByName.get(name) || []),
          label: definition.label || name,
          name,
          terms: uniqueSorted(definition.search?.terms || []),
          variants: sortedVariants,
        },
      ];
    });

  return { schemaVersion: 1, version, icons };
}
