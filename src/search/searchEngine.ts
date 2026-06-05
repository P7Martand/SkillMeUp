import { CatalogItem } from '../sources/types';

export interface SearchFilters {
  kind?: 'skill' | 'plugin';
  tier?: 'verified' | 'community';
  category?: string;
  minStars?: number;
}

export interface SearchResult {
  item: CatalogItem;
  score: number;
}

const DEFAULT_LIMIT = 100;

/**
 * Rank catalog items against a query with field weighting + popularity/tier
 * boosting. Empty query returns all (filtered) items sorted by tier then stars.
 * Pure and synchronous — safe to call on every keystroke.
 */
export function search(
  catalog: CatalogItem[],
  query: string,
  filters: SearchFilters,
  limit = DEFAULT_LIMIT
): SearchResult[] {
  const filtered = catalog.filter((item) => passesFilters(item, filters));
  const q = query.trim().toLowerCase();

  if (!q) {
    const sorted = [...filtered].sort(byTierThenStars);
    return sorted.slice(0, limit).map((item) => ({ item, score: 0 }));
  }

  const terms = q.split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];
  for (const item of filtered) {
    const score = scoreItem(item, terms);
    if (score > 0) results.push({ item, score });
  }
  results.sort((a, b) => b.score - a.score || byTierThenStars(a.item, b.item));
  return results.slice(0, limit);
}

function passesFilters(item: CatalogItem, f: SearchFilters): boolean {
  if (f.kind && item.kind !== f.kind) return false;
  if (f.tier && item.tier !== f.tier) return false;
  if (f.category && item.category !== f.category) return false;
  if (f.minStars != null && (item.stars ?? 0) < f.minStars) return false;
  return true;
}

function byTierThenStars(a: CatalogItem, b: CatalogItem): number {
  const tier = tierRank(a.tier) - tierRank(b.tier);
  if (tier !== 0) return tier;
  const stars = (b.stars ?? 0) - (a.stars ?? 0);
  if (stars !== 0) return stars;
  return a.name.localeCompare(b.name);
}

const tierRank = (t?: string) => (t === 'verified' ? 0 : 1);

/** Field weights — name dominates, then tags/whenToUse, then description. */
function scoreItem(item: CatalogItem, terms: string[]): number {
  const name = item.name.toLowerCase();
  const tags = (item.tags ?? []).join(' ').toLowerCase();
  const whenToUse = (item.kind === 'skill' ? item.whenToUse ?? '' : '').toLowerCase();
  const description = (item.description ?? '').toLowerCase();
  const category = (item.category ?? '').toLowerCase();
  const repo = item.sourceRepo.toLowerCase();

  let score = 0;
  let allTermsHit = true;

  for (const term of terms) {
    let termScore = 0;
    if (name === term) termScore += 100;
    else if (name.includes(term)) termScore += 40;
    if (tags.includes(term)) termScore += 20;
    if (whenToUse.includes(term)) termScore += 15;
    if (description.includes(term)) termScore += 10;
    if (category.includes(term)) termScore += 8;
    if (repo.includes(term)) termScore += 5;
    if (termScore === 0) allTermsHit = false;
    score += termScore;
  }

  // Require every term to match somewhere (AND semantics).
  if (!allTermsHit) return 0;

  // Light popularity + verified boosts so good, trusted results float up.
  score += Math.log10((item.stars ?? 0) + 1) * 3;
  if (item.tier === 'verified') score += 10;
  return score;
}
