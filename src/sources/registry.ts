import * as vscode from 'vscode';
import { TTLCache } from '../util/cache';
import { log, logError } from '../util/logger';
import { fetchMarketplace } from './marketplaceFetcher';
import { fetchAwesomeList } from './awesomeListFetcher';
import { fetchGenericRepo } from './githubUrlFetcher';
import { Catalog, SourceConfig, emptyCatalog, mergeCatalogs } from './types';

export class SourceRegistry {
  constructor(private readonly cache: TTLCache) {}

  private cfg(): SourceConfig[] {
    const raw = vscode.workspace.getConfiguration('skillmeup').get<SourceConfig[]>('sources', []);
    return raw.filter((s) => s && typeof s.url === 'string');
  }

  private cacheTtlMs(): number {
    const min = vscode.workspace.getConfiguration('skillmeup').get<number>('cacheMinutes', 60);
    return Math.max(1, min) * 60_000;
  }

  async getCatalog(force = false): Promise<Catalog> {
    const sources = this.cfg();
    const key = `catalog:${JSON.stringify(sources)}`;
    if (!force) {
      const hit = this.cache.get<Catalog>(key);
      if (hit) return hit;
    }
    const catalogs: Catalog[] = [];
    for (const src of sources) {
      try {
        const c = await this.fetchOne(src);
        catalogs.push(c);
      } catch (e) {
        logError(`source ${src.url}`, e);
        const err = emptyCatalog();
        err.errors.push({ source: src.url, message: (e as Error).message });
        catalogs.push(err);
      }
    }
    const merged = mergeCatalogs(catalogs);
    await this.cache.set(key, merged, this.cacheTtlMs());
    log(`catalog: ${merged.skills.length} skills, ${merged.plugins.length} plugins, ${merged.errors.length} errors`);
    return merged;
  }

  async addSource(url: string, kind: SourceConfig['kind'] = 'repo'): Promise<void> {
    const current = this.cfg();
    if (current.some((s) => s.url === url)) return;
    const next = [...current, { url, kind }];
    const config = vscode.workspace.getConfiguration('skillmeup');
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update('sources', next, target);
    await this.cache.clear();
  }

  private fetchOne(src: SourceConfig): Promise<Catalog> {
    switch (src.kind) {
      case 'marketplace':
        return fetchMarketplace(src.url);
      case 'awesome-list':
        return fetchAwesomeList(src.url);
      case 'repo':
      default:
        return fetchGenericRepo(src.url);
    }
  }
}
