import { normalizeFontAwesomeText } from './normalize';
import type {
  FontAwesomeIconRecord,
  FontAwesomeIndex,
  FontAwesomeMatchField,
  FontAwesomeResolvedIcon,
  FontAwesomeSearchResult,
  FontAwesomeVariant,
  FontAwesomeVariantKey,
} from './types';

interface Match {
  fields: FontAwesomeMatchField[];
  score: number;
}

function normalizedFields(icon: FontAwesomeIconRecord) {
  return {
    alias: icon.aliases.map(normalizeFontAwesomeText),
    category: icon.categories.map(normalizeFontAwesomeText),
    label: [normalizeFontAwesomeText(icon.label)],
    name: [normalizeFontAwesomeText(icon.name)],
    term: icon.terms.map(normalizeFontAwesomeText),
  } satisfies Record<FontAwesomeMatchField, string[]>;
}

function fieldsMatching(
  fields: ReturnType<typeof normalizedFields>,
  predicate: (value: string) => boolean,
) {
  return (Object.entries(fields) as [FontAwesomeMatchField, string[]][])
    .filter(([, values]) => values.some(predicate))
    .map(([field]) => field);
}

function getMatch(icon: FontAwesomeIconRecord, query: string): Match | null {
  const fields = normalizedFields(icon);
  const exactBands: [FontAwesomeMatchField, number][] = [
    ['name', 1000],
    ['alias', 900],
    ['label', 800],
  ];

  for (const [field, score] of exactBands) {
    if (fields[field].includes(query)) return { fields: [field], score };
  }

  const semanticExact = fieldsMatching(
    { ...fields, alias: [], label: [], name: [] },
    (value) => value === query,
  );
  if (semanticExact.length) return { fields: semanticExact, score: 700 };

  const phraseFields = fieldsMatching(fields, (value) => value.includes(query));
  if (phraseFields.length) return { fields: phraseFields, score: 600 };

  const queryTokens = query.split(' ').filter(Boolean);
  const allValues = Object.values(fields).flat();
  if (
    queryTokens.length > 1 &&
    queryTokens.every((token) =>
      allValues.some((value) => value.split(' ').includes(token)),
    )
  ) {
    return {
      fields: fieldsMatching(fields, (value) =>
        queryTokens.some((token) => value.split(' ').includes(token)),
      ),
      score: 500,
    };
  }

  const prefixFields = fieldsMatching(fields, (value) =>
    value.startsWith(query),
  );
  if (prefixFields.length) return { fields: prefixFields, score: 400 };

  return null;
}

export function searchFontAwesomeIndex(
  index: FontAwesomeIndex,
  rawQuery: string,
  limit = 20,
): FontAwesomeSearchResult[] {
  const query = normalizeFontAwesomeText(rawQuery);
  if (!query || limit <= 0) return [];

  return index.icons
    .flatMap((icon) => {
      const match = getMatch(icon, query);
      if (!match) return [];
      return [
        {
          label: icon.label,
          matchedBy: match.fields,
          name: icon.name,
          score: match.score,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.name.localeCompare(right.name),
    )
    .slice(0, limit);
}

function findIcon(index: FontAwesomeIndex, rawName: string) {
  const name = normalizeFontAwesomeText(rawName);
  return index.icons.find(
    (icon) =>
      normalizeFontAwesomeText(icon.name) === name ||
      icon.aliases.some((alias) => normalizeFontAwesomeText(alias) === name),
  );
}

export function resolveFontAwesomeIcon(
  index: FontAwesomeIndex,
  rawName: string,
  { family, style }: FontAwesomeVariant,
): FontAwesomeResolvedIcon {
  const icon = findIcon(index, rawName);
  if (!icon) throw new Error(`Unknown Font Awesome icon: ${rawName}`);

  const variant = `${family}:${style}` as FontAwesomeVariantKey;
  const path = icon.variants[variant];
  if (!path) {
    const available = Object.keys(icon.variants).sort().join(', ');
    throw new Error(
      `Font Awesome icon "${icon.name}" does not provide ${variant}. Available variants: ${available}`,
    );
  }

  return { icon, name: icon.name, path, variant };
}
