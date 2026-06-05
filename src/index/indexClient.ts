import { Catalog, CatalogItem, SkillMeta, PluginMeta } from '../sources/types';
import { SkillMeUpIndex } from '../shared/indexTypes';

/** Minimal persistence surface — satisfied directly by vscode.Memento. */
export interface IndexStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | void;
}

interface CacheEntry {
  index: SkillMeUpIndex;
  etag: string | null;
  fetchedAt: number;
}

export interface IndexClientOpts {
  indexUrl: string;
  ttlMs: number;
  fetchFn?: typeof fetch;
  /** Bundled seed index used when nothing is cached and the remote fetch fails. */
  fallbackIndex?: SkillMeUpIndex;
}

const CACHE_KEY = 'skillmeup.index.cache';

export class IndexClient {
  /** Called after a background refresh produces a new catalog. */
  onRefreshed?: (catalog: Catalog) => void;
  private refreshing = false;

  constructor(private readonly store: IndexStore, private readonly opts: IndexClientOpts) {}

  async getCatalog(force = false): Promise<Catalog> {
    const cached = this.store.get<CacheEntry>(CACHE_KEY);
    const fresh = cached && Date.now() - cached.fetchedAt < this.opts.ttlMs;

    if (cached && fresh && !force) {
      return toCatalog(cached.index);
    }
    if (cached && !force) {
      // Stale: serve immediately, revalidate in the background.
      this.backgroundRefresh();
      return toCatalog(cached.index);
    }
    // Cold or forced: fetch synchronously, fall back to cache on failure.
    try {
      const entry = await this.fetchIndex(cached ?? null);
      return toCatalog(entry.index);
    } catch (e) {
      if (cached) return toCatalog(cached.index);
      // No cache and the remote is unreachable (e.g. index not yet published):
      // serve the bundled seed index so the catalog is never empty.
      if (this.opts.fallbackIndex) return toCatalog(this.opts.fallbackIndex);
      throw e;
    }
  }

  private backgroundRefresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    const cached = this.store.get<CacheEntry>(CACHE_KEY) ?? null;
    this.fetchIndex(cached)
      .then((entry) => this.onRefreshed?.(toCatalog(entry.index)))
      .catch(() => { /* keep serving stale */ })
      .finally(() => { this.refreshing = false; });
  }

  private async fetchIndex(cached: CacheEntry | null): Promise<CacheEntry> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    const res = await fetchFn(this.opts.indexUrl, { headers });
    if (res.status === 304 && cached) {
      const refreshed: CacheEntry = { ...cached, fetchedAt: Date.now() };
      await this.store.update(CACHE_KEY, refreshed);
      return refreshed;
    }
    if (!res.ok) throw new Error(`Index fetch ${this.opts.indexUrl} -> ${res.status} ${res.statusText}`);

    const index = (await res.json()) as SkillMeUpIndex;
    if (!index || typeof index.version !== 'number' || !Array.isArray(index.entries)) {
      throw new Error('Index payload is not a valid SkillMeUp index');
    }
    const entry: CacheEntry = { index, etag: res.headers.get('etag'), fetchedAt: Date.now() };
    await this.store.update(CACHE_KEY, entry);
    return entry;
  }
}

function toCatalog(index: SkillMeUpIndex): Catalog {
  const skills: SkillMeta[] = [];
  const plugins: PluginMeta[] = [];
  for (const e of index.entries as CatalogItem[]) {
    if (e.kind === 'skill') skills.push(e);
    else if (e.kind === 'plugin') plugins.push(e);
  }
  return { skills, plugins, fetchedAt: Date.parse(index.generatedAt) || Date.now(), errors: [] };
}
