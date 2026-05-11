export type SourceKind = 'marketplace' | 'awesome-list' | 'repo';

export interface SourceConfig {
  url: string;
  kind: SourceKind;
}

export interface BaseMeta {
  id: string;                 // "<owner/repo>#<name>"
  name: string;
  description?: string;
  sourceRepo: string;         // "owner/repo"
  sourceUrl: string;          // canonical github URL
  pathInRepo: string;         // location of the folder inside the repo
  ref: string;                // branch / tag
}

export interface SkillMeta extends BaseMeta {
  kind: 'skill';
  whenToUse?: string;
  paths?: string[];           // frontmatter `paths` globs
  allowedTools?: string[];
}

export interface PluginMeta extends BaseMeta {
  kind: 'plugin';
  version?: string;
  author?: string;
  skills?: string[];          // names of bundled skills, if known
  commands?: string[];
  agents?: string[];
}

export type CatalogItem = SkillMeta | PluginMeta;

export interface Recommendation {
  item: CatalogItem;
  score: number;
  reasons: string[];
}

export interface Catalog {
  skills: SkillMeta[];
  plugins: PluginMeta[];
  fetchedAt: number;
  errors: { source: string; message: string }[];
}

export function emptyCatalog(): Catalog {
  return { skills: [], plugins: [], fetchedAt: Date.now(), errors: [] };
}

export function mergeCatalogs(catalogs: Catalog[]): Catalog {
  const out = emptyCatalog();
  const seen = new Set<string>();
  for (const c of catalogs) {
    for (const s of c.skills) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.skills.push(s);
    }
    for (const p of c.plugins) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.plugins.push(p);
    }
    out.errors.push(...c.errors);
  }
  out.fetchedAt = Date.now();
  return out;
}
