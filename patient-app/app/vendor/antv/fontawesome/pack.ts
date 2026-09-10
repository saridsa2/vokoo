import { resolveFontAwesomeIcon, searchFontAwesomeIndex } from './search';
import { parseFontAwesomeSVG } from './svg';
import type {
  FontAwesomeIndex,
  FontAwesomePack,
  FontAwesomeVariant,
} from './types';

export function createFontAwesomePack(
  index: FontAwesomeIndex,
  readAsset: (path: string) => Promise<string>,
): FontAwesomePack {
  if (index.schemaVersion !== 1) {
    throw new Error(
      `Unsupported Font Awesome index schema: ${String(index.schemaVersion)}`,
    );
  }

  return {
    index,
    search: (query, limit) => searchFontAwesomeIndex(index, query, limit),
    resolve: (name, variant) => resolveFontAwesomeIcon(index, name, variant),
    async load(name: string, variant: FontAwesomeVariant) {
      const resolved = resolveFontAwesomeIcon(index, name, variant);
      const source = await readAsset(resolved.path);
      return parseFontAwesomeSVG(source, resolved.name);
    },
  };
}
