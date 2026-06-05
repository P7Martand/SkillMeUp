import { CatalogItem } from '../src/sources/types';
import { SkillMeUpIndex, IndexMeta, INDEX_VERSION } from '../src/shared/indexTypes';

const tierRank = (t?: string) => (t === 'verified' ? 0 : 1);

/** Dedupe by id (verified wins), sort by tier then stars, compute stats. */
export function buildIndex(entries: CatalogItem[], generatedAt: string): SkillMeUpIndex {
  const byId = new Map<string, CatalogItem>();
  for (const e of entries) {
    const existing = byId.get(e.id);
    if (!existing) { byId.set(e.id, e); continue; }
    // Prefer verified; otherwise keep the one with more stars.
    if (tierRank(e.tier) < tierRank(existing.tier)) byId.set(e.id, e);
    else if (tierRank(e.tier) === tierRank(existing.tier) && (e.stars ?? 0) > (existing.stars ?? 0)) byId.set(e.id, e);
  }

  const deduped = [...byId.values()].sort((a, b) => {
    const t = tierRank(a.tier) - tierRank(b.tier);
    if (t !== 0) return t;
    const s = (b.stars ?? 0) - (a.stars ?? 0);
    if (s !== 0) return s;
    return a.name.localeCompare(b.name);
  });

  const repos = new Set(deduped.map((e) => e.sourceRepo));
  return {
    version: INDEX_VERSION,
    generatedAt,
    stats: {
      skills: deduped.filter((e) => e.kind === 'skill').length,
      plugins: deduped.filter((e) => e.kind === 'plugin').length,
      repos: repos.size
    },
    entries: deduped
  };
}

export function buildMeta(index: SkillMeUpIndex): IndexMeta {
  return { version: index.version, generatedAt: index.generatedAt, count: index.entries.length };
}
