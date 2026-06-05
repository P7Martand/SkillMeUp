import { describe, it, expect } from 'vitest';
import { buildIndex } from './buildIndex';
import { CatalogItem } from '../src/sources/types';
import { INDEX_VERSION } from '../src/shared/indexTypes';

function skill(id: string, repo: string, tier: 'verified' | 'community'): CatalogItem {
  return {
    kind: 'skill', id, name: id.split('#')[1], sourceRepo: repo,
    sourceUrl: 'u', pathInRepo: 'p', ref: 'sha', tier, stars: 1
  };
}

describe('buildIndex', () => {
  it('produces a versioned index with correct stats', () => {
    const idx = buildIndex([
      skill('o/r#a', 'o/r', 'verified'),
      { ...skill('o/r#b', 'o/r', 'community'), kind: 'plugin' } as CatalogItem
    ], '2026-06-04T00:00:00Z');
    expect(idx.version).toBe(INDEX_VERSION);
    expect(idx.generatedAt).toBe('2026-06-04T00:00:00Z');
    expect(idx.stats.skills).toBe(1);
    expect(idx.stats.plugins).toBe(1);
    expect(idx.stats.repos).toBe(1);
    expect(idx.entries).toHaveLength(2);
  });

  it('dedupes by id, preferring verified over community', () => {
    const idx = buildIndex([
      skill('o/r#a', 'o/r', 'community'),
      skill('o/r#a', 'o/r', 'verified')
    ], 'ts');
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries[0].tier).toBe('verified');
  });

  it('sorts entries by tier then stars descending', () => {
    const idx = buildIndex([
      { ...skill('o/r#low', 'o/r', 'community'), stars: 5 },
      { ...skill('o/r#high', 'o/r', 'community'), stars: 500 },
      { ...skill('o/r#ver', 'o/r', 'verified'), stars: 1 }
    ], 'ts');
    expect(idx.entries.map((e) => e.name)).toEqual(['ver', 'high', 'low']);
  });
});
