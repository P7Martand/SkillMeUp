import { describe, it, expect } from 'vitest';
import { mergeCatalogs, Catalog, SkillMeta } from './types';

function cat(skills: SkillMeta[]): Catalog {
  return { skills, plugins: [], fetchedAt: 0, errors: [] };
}

function skill(id: string, extra: Partial<SkillMeta> = {}): SkillMeta {
  return {
    kind: 'skill',
    id,
    name: id,
    sourceRepo: 'o/r',
    sourceUrl: 'u',
    pathInRepo: 'p',
    ref: 'r',
    ...extra
  };
}

describe('mergeCatalogs', () => {
  it('dedupes by id; the first catalog (index) wins on collision', () => {
    // loadCatalog calls mergeCatalogs([indexCatalog, customCatalog]) — index first.
    const index = cat([skill('o/r#a', { tier: 'verified' })]);
    const custom = cat([skill('o/r#a', { tier: 'community' }), skill('o/r#b')]);
    const merged = mergeCatalogs([index, custom]);
    expect(merged.skills.map((s) => s.id).sort()).toEqual(['o/r#a', 'o/r#b']);
    const a = merged.skills.find((s) => s.id === 'o/r#a')!;
    expect(a.tier).toBe('verified'); // index entry won over the custom duplicate
  });

  it('combines unique items across catalogs', () => {
    const merged = mergeCatalogs([cat([skill('o/r#a')]), cat([skill('o/r#b')])]);
    expect(merged.skills).toHaveLength(2);
  });

  it('aggregates errors from every catalog', () => {
    const a: Catalog = { skills: [], plugins: [], fetchedAt: 0, errors: [{ source: 's1', message: 'm1' }] };
    const b: Catalog = { skills: [], plugins: [], fetchedAt: 0, errors: [{ source: 's2', message: 'm2' }] };
    const merged = mergeCatalogs([a, b]);
    expect(merged.errors).toHaveLength(2);
  });
});
