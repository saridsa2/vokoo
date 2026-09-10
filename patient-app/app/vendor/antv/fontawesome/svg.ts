import type {
  FontAwesomeGraphicColors,
  LocalIconGraphic,
  LocalIconPath,
} from './types';

function invalid(reason: string): never {
  throw new Error(`Invalid Font Awesome SVG: ${reason}`);
}

function parseViewBox(value: string | null) {
  const parts = value?.trim().split(/\s+/).map(Number) || [];
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    invalid('viewBox must contain four finite numbers');
  }
  return parts as [number, number, number, number];
}

function ensureSafeAttributes(element: Element, allowed: Set<string>) {
  Array.from(element.attributes).forEach(({ name }) => {
    const normalized = name.toLowerCase();
    if (normalized.startsWith('on') || !allowed.has(normalized)) {
      invalid(`unsupported attribute "${name}" on <${element.tagName}>`);
    }
  });
}

export function parseFontAwesomeSVG(
  source: string,
  name: string,
): LocalIconGraphic {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.tagName.toLowerCase() === 'parsererror') invalid('malformed XML');
  if (root.tagName.toLowerCase() !== 'svg') invalid('root must be <svg>');

  ensureSafeAttributes(root, new Set(['height', 'viewbox', 'width', 'xmlns']));
  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const descendants = Array.from(root.querySelectorAll('*'));
  if (descendants.some((element) => element.tagName.toLowerCase() !== 'path')) {
    invalid('only <path> drawing elements are supported');
  }

  const paths: LocalIconPath[] = descendants.map((element) => {
    ensureSafeAttributes(element, new Set(['d', 'fill', 'opacity']));
    const d = element.getAttribute('d')?.trim();
    if (!d) invalid('every path requires non-empty d data');
    const opacityValue = element.getAttribute('opacity');
    if (opacityValue == null) return { d };
    const opacity = Number(opacityValue);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      invalid('path opacity must be a number between 0 and 1');
    }
    return { d, opacity };
  });

  if (!paths.length) invalid('at least one path is required');
  return { name, paths, viewBox };
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function graphicToSVG(
  graphic: LocalIconGraphic,
  { primaryColor, secondaryColor = primaryColor }: FontAwesomeGraphicColors,
): string {
  const paths = graphic.paths
    .map(({ d, opacity }) => {
      const fill = opacity == null ? primaryColor : secondaryColor;
      const opacityAttribute =
        opacity == null ? '' : ` opacity="${String(opacity)}"`;
      return `<path fill="${escapeAttribute(fill)}"${opacityAttribute} d="${escapeAttribute(d)}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${graphic.viewBox.join(' ')}">${paths}</svg>`;
}
