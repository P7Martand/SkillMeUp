import { CatalogItem, SkillMeta, PluginMeta, Tier } from '../src/sources/types';
import { parseFrontmatter, normalizePaths, normalizeWhenToUse, normalizeAllowedTools } from '../src/shared/parse/frontmatter';
import { parseMarketplaceJson, parsePluginJson } from '../src/shared/parse/manifest';
import { RepoReader, RepoMeta } from './github';
import { categorize } from './categorize';

export interface RepoTarget {
  owner: string;
  repo: string;
  tier: Tier;
}

/** Parse one repo into catalog entries, fully enriched with repo metadata. */
export async function parseRepo(reader: RepoReader, target: RepoTarget, meta: RepoMeta): Promise<CatalogItem[]> {
  const { owner, repo } = target;
  const ref = meta.headSha;
  const byId = new Map<string, CatalogItem>();

  const add = (item: CatalogItem | null) => {
    if (item && !byId.has(item.id)) byId.set(item.id, item);
  };

  // 1. marketplace.json (try common locations).
  const mpText =
    (await reader.getText(owner, repo, ref, '.claude-plugin/marketplace.json')) ??
    (await reader.getText(owner, repo, ref, '.claude-code/marketplace.json')) ??
    (await reader.getText(owner, repo, ref, 'marketplace.json'));
  if (mpText) {
    const mp = parseMarketplaceJson(mpText);
    for (const entry of mp?.plugins ?? []) {
      const looksLikeSkill = /(^|\/)skills\//.test(entry.source) || entry.source.startsWith('skills/');
      if (looksLikeSkill && entry.source) {
        add(await readSkill(reader, target, meta, entry.source, entry.name, entry.description));
      } else if (entry.source) {
        add(await readPlugin(reader, target, meta, entry.source, entry));
      }
    }
  }

  // 2. scan skills/ and plugins/ folders.
  for (const it of await reader.listDir(owner, repo, ref, 'skills')) {
    if (it.type === 'dir') add(await readSkill(reader, target, meta, it.path));
  }
  for (const it of await reader.listDir(owner, repo, ref, 'plugins')) {
    if (it.type === 'dir') add(await readPlugin(reader, target, meta, it.path));
  }

  return [...byId.values()];
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

async function readSkill(
  reader: RepoReader,
  target: RepoTarget,
  meta: RepoMeta,
  pathInRepo: string,
  fallbackName?: string,
  fallbackDesc?: string
): Promise<SkillMeta | null> {
  const { owner, repo, tier } = target;
  const ref = meta.headSha;
  const text = await reader.getText(owner, repo, ref, `${pathInRepo}/SKILL.md`);
  if (!text) return null;
  const { data } = parseFrontmatter(text);
  const name = (typeof data.name === 'string' ? data.name : undefined) ?? fallbackName ?? basename(pathInRepo);
  if (!name) return null;
  const description = (typeof data.description === 'string' ? data.description : undefined) ?? fallbackDesc;
  return {
    kind: 'skill',
    id: `${owner}/${repo}#${name}`,
    name,
    description,
    whenToUse: normalizeWhenToUse(data),
    paths: normalizePaths(data),
    allowedTools: normalizeAllowedTools(data),
    sourceRepo: `${owner}/${repo}`,
    sourceUrl: `https://github.com/${owner}/${repo}/tree/${ref}/${pathInRepo}`,
    pathInRepo,
    ref,
    tier,
    stars: meta.stars,
    category: categorize(meta.topics, pathInRepo, name),
    tags: meta.topics,
    updatedAt: meta.updatedAt
  };
}

async function readPlugin(
  reader: RepoReader,
  target: RepoTarget,
  meta: RepoMeta,
  pathInRepo: string,
  fallback?: { name?: string; description?: string; version?: string; author?: string | { name?: string }; commands?: string[]; agents?: string[]; skills?: string[] }
): Promise<PluginMeta | null> {
  const { owner, repo, tier } = target;
  const ref = meta.headSha;
  const text =
    (await reader.getText(owner, repo, ref, `${pathInRepo}/.claude-plugin/plugin.json`)) ??
    (await reader.getText(owner, repo, ref, `${pathInRepo}/plugin.json`));
  const pj = text ? parsePluginJson(text) : null;
  const name = pj?.name ?? fallback?.name ?? basename(pathInRepo);
  if (!name) return null;
  const author = pj?.author ?? fallback?.author;
  return {
    kind: 'plugin',
    id: `${owner}/${repo}#${name}`,
    name,
    description: pj?.description ?? fallback?.description,
    version: pj?.version ?? fallback?.version,
    author: typeof author === 'string' ? author : author?.name,
    commands: pj?.commands ?? fallback?.commands,
    agents: pj?.agents ?? fallback?.agents,
    skills: pj?.skills ?? fallback?.skills,
    sourceRepo: `${owner}/${repo}`,
    sourceUrl: `https://github.com/${owner}/${repo}/tree/${ref}/${pathInRepo}`,
    pathInRepo,
    ref,
    tier,
    stars: meta.stars,
    category: categorize(meta.topics, pathInRepo, name),
    tags: meta.topics,
    updatedAt: meta.updatedAt
  };
}
