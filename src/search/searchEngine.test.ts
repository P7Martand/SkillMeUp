import { describe, it, expect } from 'vitest';
import { search, SearchFilters } from './searchEngine';
import { CatalogItem } from '../sources/types';

function item(partial: Partial<CatalogItem> & { name: string; kind: 'skill' | 'plugin' }): CatalogItem {
  return {
    id: `o/r#${partial.name}`,
    sourceRepo: 'o/r', sourceUrl: 'u', pathInRepo: 'p', ref: 'sha',
    tier: 'community', stars: 0, tags: [], ...partial
  } as CatalogItem;
}

const catalog: CatalogItem[] = [
  item({ name: 'systematic-debugging', kind: 'skill', description: 'debug methodically', category: 'debugging', tags: ['debug'], stars: 100, tier: 'verified' }),
  item({ name: 'webapp-testing', kind: 'skill', description: 'playwright tests', category: 'testing', tags: ['testing', 'playwright'], stars: 50 }),
  item({ name: 'frontend-design', kind: 'plugin', description: 'react UI components', category: 'frontend', tags: ['react'], stars: 500 }),
  item({ name: 'random-thing', kind: 'skill', description: 'unrelated', category: 'other', tags: [], stars: 10 })
];

describe('search', () => {
  it('ranks an exact name match first', () => {
    const r = search(catalog, 'webapp-testing', {});
    expect(r[0].item.name).toBe('webapp-testing');
  });

  it('matches on description and tags', () => {
    const names = search(catalog, 'react', {}).map((x) => x.item.name);
    expect(names).toContain('frontend-design');
  });

  it('returns all items sorted by tier then stars when query is empty', () => {
    const names = search(catalog, '', {}).map((x) => x.item.name);
    expect(names[0]).toBe('systematic-debugging'); // verified first
    expect(names[1]).toBe('frontend-design');      // then highest stars
  });

  it('filters by kind', () => {
    const r = search(catalog, '', { kind: 'plugin' });
    expect(r.every((x) => x.item.kind === 'plugin')).toBe(true);
  });

  it('filters by tier', () => {
    const r = search(catalog, '', { tier: 'verified' });
    expect(r).toHaveLength(1);
    expect(r[0].item.name).toBe('systematic-debugging');
  });

  it('filters by category', () => {
    const r = search(catalog, '', { category: 'testing' });
    expect(r.map((x) => x.item.name)).toEqual(['webapp-testing']);
  });

  it('filters by minStars', () => {
    const r = search(catalog, '', { minStars: 100 });
    expect(r.every((x) => (x.item.stars ?? 0) >= 100)).toBe(true);
  });

  it('excludes non-matching items for a specific query', () => {
    const names = search(catalog, 'debugging', {}).map((x) => x.item.name);
    expect(names).not.toContain('random-thing');
  });

  it('caps results to the requested limit', () => {
    const r = search(catalog, '', {}, 2);
    expect(r).toHaveLength(2);
  });
});
