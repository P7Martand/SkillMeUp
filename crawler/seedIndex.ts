import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGhClient } from './github';
import { SeedConfig } from './discover';
import { parseRepo, RepoTarget } from './parseRepo';
import { buildIndex, buildMeta } from './buildIndex';
import { CatalogItem } from '../src/sources/types';

/**
 * Fast, narrow crawl of ONLY the curated seed repos (all tier=verified).
 * Useful for local dev / demos: produces a real index in a handful of API
 * calls, no broad ecosystem search, works unauthenticated. The full nightly
 * crawl (`npm run crawl`) is the production path.
 */
async function main() {
  const token = process.env.CRAWLER_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (!token) console.warn('[seed] no token — fine for the few seed repos.');

  const seeds: SeedConfig = JSON.parse(readFileSync(join(__dirname, 'seeds.json'), 'utf8'));
  const client = createGhClient(token);

  const all: CatalogItem[] = [];
  for (const full of seeds.repos) {
    const [owner, repo] = full.split('/');
    if (!owner || !repo) continue;
    const target: RepoTarget = { owner, repo, tier: 'verified' };
    const meta = await client.getRepoMeta(owner, repo);
    if (!meta) { console.warn(`[seed] skip ${full} — no repo metadata`); continue; }
    try {
      const entries = await parseRepo(client, target, meta);
      all.push(...entries);
      console.log(`[seed] ${full}: ${entries.length} entries`);
    } catch (e) {
      console.warn(`[seed] parse failed for ${full}: ${(e as Error).message}`);
    }
  }

  const index = buildIndex(all, new Date().toISOString());
  if (index.entries.length === 0) {
    console.error('[seed] produced 0 entries — refusing to write an empty index.');
    process.exit(1);
  }
  const outDir = join(__dirname, '..', 'dist');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(buildMeta(index)));
  console.log(`[seed] wrote dist/index.json — ${index.entries.length} entries (${index.stats.skills} skills, ${index.stats.plugins} plugins)`);
}

main().catch((e) => {
  console.error('[seed] fatal:', e);
  process.exit(1);
});
