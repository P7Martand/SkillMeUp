import { describe, it, expect } from 'vitest';
import { parseRepo } from './parseRepo';
import { RepoReader, RepoMeta } from './github';

function fakeReader(files: Record<string, string>, dirs: Record<string, { name: string; path: string; type: 'file' | 'dir' }[]>): RepoReader {
  return {
    async getText(owner, repo, ref, path) {
      return files[path] ?? null;
    },
    async listDir(owner, repo, ref, path) {
      return dirs[path] ?? [];
    }
  };
}

const meta: RepoMeta = { defaultBranch: 'main', headSha: 'abc123', stars: 42, topics: ['debugging'], updatedAt: '2026-01-01T00:00:00Z' };

describe('parseRepo', () => {
  it('reads a skill from skills/ folder with enriched fields', async () => {
    const reader = fakeReader(
      { 'skills/foo/SKILL.md': '---\nname: foo\ndescription: Foo skill\nwhen-to-use: when debugging\n---\nbody' },
      { skills: [{ name: 'foo', path: 'skills/foo', type: 'dir' }], plugins: [] }
    );
    const entries = await parseRepo(reader, { owner: 'o', repo: 'r', tier: 'verified' }, meta);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.kind).toBe('skill');
    expect(e.name).toBe('foo');
    expect(e.tier).toBe('verified');
    expect(e.stars).toBe(42);
    expect(e.ref).toBe('abc123');
    expect(e.category).toBe('debugging');
    expect(e.id).toBe('o/r#foo');
    expect(e.sourceUrl).toContain('/tree/abc123/skills/foo');
  });

  it('reads a plugin from plugins/ folder', async () => {
    const reader = fakeReader(
      { 'plugins/bar/.claude-plugin/plugin.json': JSON.stringify({ name: 'bar', description: 'Bar', version: '2.0.0' }) },
      { skills: [], plugins: [{ name: 'bar', path: 'plugins/bar', type: 'dir' }] }
    );
    const entries = await parseRepo(reader, { owner: 'o', repo: 'r', tier: 'community' }, meta);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('plugin');
    expect(entries[0].name).toBe('bar');
    expect((entries[0] as any).version).toBe('2.0.0');
    expect(entries[0].tier).toBe('community');
  });

  it('ingests entries from a marketplace.json', async () => {
    const reader = fakeReader(
      {
        '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'mp-skill', source: 'skills/mp-skill' }] }),
        'skills/mp-skill/SKILL.md': '---\nname: mp-skill\ndescription: From marketplace\n---\n'
      },
      { skills: [], plugins: [] }
    );
    const entries = await parseRepo(reader, { owner: 'o', repo: 'r', tier: 'verified' }, meta);
    expect(entries.map((e) => e.name)).toContain('mp-skill');
  });

  it('returns empty for a repo with no skills or plugins', async () => {
    const reader = fakeReader({}, { skills: [], plugins: [] });
    const entries = await parseRepo(reader, { owner: 'o', repo: 'r', tier: 'community' }, meta);
    expect(entries).toEqual([]);
  });

  it('deduplicates entries discovered via both marketplace and folder scan', async () => {
    const reader = fakeReader(
      {
        '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'foo', source: 'skills/foo' }] }),
        'skills/foo/SKILL.md': '---\nname: foo\ndescription: Foo\n---\n'
      },
      { skills: [{ name: 'foo', path: 'skills/foo', type: 'dir' }], plugins: [] }
    );
    const entries = await parseRepo(reader, { owner: 'o', repo: 'r', tier: 'verified' }, meta);
    expect(entries).toHaveLength(1);
  });
});
