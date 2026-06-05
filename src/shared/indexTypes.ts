import { CatalogItem } from '../sources/types';

export const INDEX_VERSION = 1;

export const CATEGORIES = [
  'debugging',
  'testing',
  'frontend',
  'data',
  'docs',
  'devops',
  'security',
  'productivity',
  'other'
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface IndexStats {
  skills: number;
  plugins: number;
  repos: number;
}

export interface SkillMeUpIndex {
  version: number;
  generatedAt: string;        // ISO timestamp
  stats: IndexStats;
  entries: CatalogItem[];     // each entry is a SkillMeta | PluginMeta
}

export interface IndexMeta {
  version: number;
  generatedAt: string;
  count: number;
}
