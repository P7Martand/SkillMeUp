import { GhClient } from './github';
import { RepoTarget } from './parseRepo';

export interface SeedConfig { repos: string[]; }
export interface DenyConfig { repos: string[]; }

const TOPICS = ['claude-skill', 'claude-plugin', 'claude-code', 'claude-skills'];

/**
 * Build the de-duplicated list of repos to crawl. Seeds are tier=verified;
 * everything found via code/topic search is tier=community. Seeds win on
 * collisions. Denylisted repos are removed.
 */
export async function discover(client: GhClient, seeds: SeedConfig, deny: DenyConfig): Promise<RepoTarget[]> {
  const denySet = new Set(deny.repos.map((r) => r.toLowerCase()));
  const byKey = new Map<string, RepoTarget>();

  const put = (fullName: string, tier: 'verified' | 'community') => {
    const key = fullName.toLowerCase();
    if (denySet.has(key)) return;
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) return;
    const existing = byKey.get(key);
    // Seeds (verified) take precedence; never downgrade verified to community.
    if (existing && existing.tier === 'verified') return;
    byKey.set(key, { owner, repo, tier });
  };

  for (const r of seeds.repos) put(r, 'verified');

  const codeHits = await client.searchCode('filename:SKILL.md', 3);
  console.log(`[discover] code search: ${codeHits.length} repos`);
  for (const h of codeHits) put(h.fullName, 'community');

  for (const topic of TOPICS) {
    const hits = await client.searchReposByTopic(topic, 2);
    console.log(`[discover] topic:${topic}: ${hits.length} repos`);
    for (const h of hits) put(h.fullName, 'community');
  }

  const targets = [...byKey.values()];
  console.log(`[discover] total: ${targets.length} repos (${targets.filter((t) => t.tier === 'verified').length} verified)`);
  return targets;
}
