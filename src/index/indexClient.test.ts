import { describe, it, expect, vi } from 'vitest';
import { IndexClient, IndexStore } from './indexClient';
import { SkillMeUpIndex } from '../shared/indexTypes';

function memStore(): IndexStore {
  const m = new Map<string, unknown>();
  return {
    get<T>(k: string) { return m.get(k) as T | undefined; },
    update(k: string, v: unknown) { m.set(k, v); }
  };
}

const sampleIndex: SkillMeUpIndex = {
  version: 1,
  generatedAt: '2026-06-04T00:00:00Z',
  stats: { skills: 1, plugins: 0, repos: 1 },
  entries: [
    { kind: 'skill', id: 'o/r#a', name: 'a', sourceRepo: 'o/r', sourceUrl: 'u', pathInRepo: 'p', ref: 'sha', tier: 'verified', stars: 3 }
  ]
};

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers();
  if (init.etag) headers.set('etag', init.etag);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

describe('IndexClient', () => {
  it('fetches and returns a catalog split into skills/plugins', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(sampleIndex, { etag: 'v1' }));
    const client = new IndexClient(memStore(), { indexUrl: 'https://x/index.json', ttlMs: 1000, fetchFn });
    const catalog = await client.getCatalog();
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.plugins).toHaveLength(0);
    expect(catalog.skills[0].tier).toBe('verified');
  });

  it('serves cached data when within TTL without re-fetching', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(sampleIndex, { etag: 'v1' }));
    const store = memStore();
    const client = new IndexClient(store, { indexUrl: 'https://x/index.json', ttlMs: 60_000, fetchFn });
    await client.getCatalog();
    await client.getCatalog();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sends If-None-Match and keeps cached data on 304', async () => {
    const store = memStore();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(sampleIndex, { etag: 'v1' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = new IndexClient(store, { indexUrl: 'https://x/index.json', ttlMs: 0, fetchFn });
    await client.getCatalog();
    const catalog = await client.getCatalog(true);
    expect(catalog.skills).toHaveLength(1);
    const secondCallHeaders = (fetchFn.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(secondCallHeaders['If-None-Match']).toBe('v1');
  });

  it('falls back to cached data when the network throws', async () => {
    const store = memStore();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(sampleIndex, { etag: 'v1' }))
      .mockRejectedValueOnce(new Error('offline'));
    const client = new IndexClient(store, { indexUrl: 'https://x/index.json', ttlMs: 0, fetchFn });
    await client.getCatalog();
    const catalog = await client.getCatalog(true);
    expect(catalog.skills).toHaveLength(1);
  });

  it('throws when nothing is cached and the network fails', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
    const client = new IndexClient(memStore(), { indexUrl: 'https://x/index.json', ttlMs: 0, fetchFn });
    await expect(client.getCatalog()).rejects.toThrow();
  });
});
