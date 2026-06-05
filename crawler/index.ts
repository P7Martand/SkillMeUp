import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGhClient } from './github';
import { discover, SeedConfig, DenyConfig } from './discover';
import { parseRepo } from './parseRepo';
import { buildIndex, buildMeta } from './buildIndex';
import { CatalogItem } from '../src/sources/types';

async function main() {
  const token = process.env.CRAWLER_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (!token) console.warn('[crawl] no token set — unauthenticated requests will hit the 60/hr limit fast.');

  const seeds: SeedConfig = JSON.parse(readFileSync(join(__dirname, 'seeds.json'), 'utf8'));
  const deny: DenyConfig = JSON.parse(readFileSync(join(__dirname, 'denylist.json'), 'utf8'));

  const client = createGhClient(token);
  const targets = await discover(client, seeds, deny);

  const allEntries: CatalogItem[] = [];
  let parsed = 0;
  for (const t of targets) {
    const meta = await client.getRepoMeta(t.owner, t.repo);
    if (!meta) { console.warn(`[crawl] skip ${t.owner}/${t.repo} — no repo metadata`); continue; }
    try {
      const entries = await parseRepo(client, t, meta);
      allEntries.push(...entries);
      parsed++;
      if (entries.length) console.log(`[crawl] ${t.owner}/${t.repo}: ${entries.length} entries (${t.tier})`);
    } catch (e) {
      console.warn(`[crawl] parse failed for ${t.owner}/${t.repo}: ${(e as Error).message}`);
    }
  }

  const generatedAt = new Date().toISOString();
  const index = buildIndex(allEntries, generatedAt);

  // Guard: never overwrite a good index with an empty one.
  if (index.entries.length === 0) {
    console.error('[crawl] produced 0 entries — refusing to publish an empty index.');
    process.exit(1);
  }

  const outDir = join(__dirname, '..', 'dist');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index));
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(buildMeta(index)));
  console.log(`[crawl] wrote dist/index.json — ${index.entries.length} entries from ${parsed}/${targets.length} repos`);
}

main().catch((e) => {
  console.error('[crawl] fatal:', e);
  process.exit(1);
});
