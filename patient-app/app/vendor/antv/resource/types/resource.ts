import { ResourceScene } from './scene';

export type ResourceSource = 'inline' | 'remote' | 'search' | 'custom';

export type ResourceFormat = 'svg' | 'image' | 'json' | 'binary' | string;

export type ResourceEncoding = 'raw' | 'data-uri' | 'base64' | string;

export interface ResourceConfig {
  source: ResourceSource;
  format?: ResourceFormat;
  encoding?: ResourceEncoding;
  data: string;
  /** Fail instead of falling back when this exact resource cannot load. */
  required?: boolean;
  scene?: ResourceScene;
  [key: string]: any;
}

export type Resource = SVGSymbolElement;

export type ResourceLoader = (
  config: ResourceConfig,
) => Promise<Resource | null>;
