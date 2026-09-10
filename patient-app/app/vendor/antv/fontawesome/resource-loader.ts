import { loadSVGResource } from '../resource/loaders';
import type { ResourceLoader } from '../resource/types';
import { graphicToSVG } from './svg';
import type {
  FontAwesomeFamily,
  FontAwesomePack,
  FontAwesomeStyle,
} from './types';

const FONT_AWESOME_SCHEME = 'fontawesome:';

function stringOption(value: unknown, fallback: string) {
  return typeof value === 'string' && value ? value : fallback;
}

export function createFontAwesomeResourceLoader(
  pack: FontAwesomePack,
): ResourceLoader {
  return async (config) => {
    if (!config.data.startsWith(FONT_AWESOME_SCHEME)) return null;
    const name = config.data.slice(FONT_AWESOME_SCHEME.length);
    const family = stringOption(config.family, 'classic') as FontAwesomeFamily;
    const style = stringOption(config.style, 'solid') as FontAwesomeStyle;
    const graphic = await pack.load(name, { family, style });
    const primaryColor = stringOption(config.primaryColor, 'currentColor');
    const secondaryColor = stringOption(config.secondaryColor, primaryColor);
    return loadSVGResource(
      graphicToSVG(graphic, { primaryColor, secondaryColor }),
    );
  };
}
