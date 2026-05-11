import {
  fetchRaw,
  fetchJson,
  listContents,
  parseGitHubUrl,
  resolveDefaultBranch,
  tryFetchRaw,
  RepoRef
} from '../util/githubFetcher';
import { parseFrontmatter, normalizePaths, normalizeWhenToUse, normalizeAllowedTools } from '../util/yaml';
import { Catalog, SkillMeta, PluginMeta, emptyCatalog } from './types';
import { log, logError } from '../util/logger';

interface MarketplaceJson {
  name?: string;
  owner?: { name?: string };
  plugins?: Array<{
    name: string;
    source?: string;        // path inside repo, e.g. "plugins/foo" or URL
    description?: string;
    version?: string;
    author?: string | { name?: string };
    commands?: string[];
    agents?: string[];
    skills?: string[];
  }>;
}

interface PluginJson {
  name?: string;
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string[] | { name: string }[];
  agents?: string[] | { name: string }[];
  skills?: string[] | { name: string }[];
}

/**
 * Fetch a marketplace.json from a GitHub repo and resolve every entry into
 * SkillMeta and/or PluginMeta. Falls back to scanning `skills/` and `plugins/`
 * folders directly if marketplace.json is missing.
 */
export async function fetchMarketplace(url: string): Promise<Catalog> {
  const out = emptyCatalog();
  const ref0 = parseGitHubUrl(url);
  if (!ref0) {
    out.errors.push({ source: url, message: 'Not a github.com URL' });
    return out;
  }
  let ref: RepoRef = {
    ...ref0,
    ref: ref0.ref === 'main' ? await resolveDefaultBranch(ref0) : ref0.ref
  };
  log(`fetchMarketplace ${ref.owner}/${ref.repo}@${ref.ref}`);

  // Try marketplace.json (probe main; fall back to master if main misses).
  let mpText =
    (await tryFetchRaw(ref, '.claude-plugin/marketplace.json')) ??
    (await tryFetchRaw(ref, '.claude-code/marketplace.json')) ??
    (await tryFetchRaw(ref, 'marketplace.json'));
  if (!mpText && ref.ref === 'main') {
    const masterRef = { ...ref, ref: 'master' };
    const probe = await tryFetchRaw(masterRef, '.claude-plugin/marketplace.json');
    if (probe) {
      ref = masterRef;
      mpText = probe;
    }
  }

  if (mpText) {
    try {
      const mp = JSON.parse(mpText) as MarketplaceJson;
      await ingestMarketplace(out, ref, mp);
    } catch (e) {
      logError(`parse marketplace.json ${url}`, e);
      out.errors.push({ source: url, message: `Invalid marketplace.json: ${(e as Error).message}` });
    }
  }

  // Always also scan top-level skills/ and plugins/ — many repos have either
  // both or no marketplace.json at all.
  await scanFolder(out, ref, 'skills', 'skill');
  await scanFolder(out, ref, 'plugins', 'plugin');

  return out;
}

async function ingestMarketplace(out: Catalog, ref: RepoRef, mp: MarketplaceJson): Promise<void> {
  for (const entry of mp.plugins ?? []) {
    const sourcePath = typeof entry.source === 'string' ? entry.source : '';
    const looksLikeSkill = /(^|\/)skills\//.test(sourcePath) || sourcePath.startsWith('skills/');
    const pathInRepo = sourcePath.replace(/^\.\//, '');
    if (looksLikeSkill && pathInRepo) {
      const skill = await tryReadSkill(ref, pathInRepo, entry.name, entry.description);
      if (skill) out.skills.push(skill);
    } else if (pathInRepo) {
      const plugin = await tryReadPlugin(ref, pathInRepo, entry);
      if (plugin) out.plugins.push(plugin);
    } else {
      // No source path → entry is the repo itself
      const guessSkills = await tryReadSkill(ref, '', entry.name, entry.description);
      if (guessSkills) out.skills.push(guessSkills);
    }
  }
}

async function scanFolder(out: Catalog, ref: RepoRef, folder: 'skills' | 'plugins', kind: 'skill' | 'plugin'): Promise<void> {
  let items;
  try {
    items = await listContents(ref, folder);
  } catch {
    return;
  }
  for (const it of items) {
    if (it.type !== 'dir') continue;
    if (kind === 'skill') {
      const skill = await tryReadSkill(ref, it.path);
      if (skill && !out.skills.find((s) => s.id === skill.id)) out.skills.push(skill);
    } else {
      const plugin = await tryReadPlugin(ref, it.path);
      if (plugin && !out.plugins.find((p) => p.id === plugin.id)) out.plugins.push(plugin);
    }
  }
}

async function tryReadSkill(
  ref: RepoRef,
  pathInRepo: string,
  fallbackName?: string,
  fallbackDesc?: string
): Promise<SkillMeta | null> {
  const skillPath = pathInRepo ? `${pathInRepo}/SKILL.md` : 'SKILL.md';
  const text = await tryFetchRaw(ref, skillPath);
  if (!text) return null;
  const { data } = parseFrontmatter(text);
  const name = (typeof data.name === 'string' ? data.name : undefined) ?? fallbackName ?? basename(pathInRepo);
  if (!name) return null;
  return {
    kind: 'skill',
    id: `${ref.owner}/${ref.repo}#${name}`,
    name,
    description: (typeof data.description === 'string' ? data.description : undefined) ?? fallbackDesc,
    whenToUse: normalizeWhenToUse(data),
    paths: normalizePaths(data),
    allowedTools: normalizeAllowedTools(data),
    sourceRepo: `${ref.owner}/${ref.repo}`,
    sourceUrl: `https://github.com/${ref.owner}/${ref.repo}/tree/${ref.ref}/${pathInRepo}`,
    pathInRepo,
    ref: ref.ref
  };
}

async function tryReadPlugin(
  ref: RepoRef,
  pathInRepo: string,
  fallback?: {
    name?: string;
    description?: string;
    version?: string;
    author?: string | { name?: string };
    commands?: string[];
    agents?: string[];
    skills?: string[];
  }
): Promise<PluginMeta | null> {
  const pluginJsonPath = pathInRepo ? `${pathInRepo}/.claude-plugin/plugin.json` : '.claude-plugin/plugin.json';
  const altPath = pathInRepo ? `${pathInRepo}/plugin.json` : 'plugin.json';
  const text = (await tryFetchRaw(ref, pluginJsonPath)) ?? (await tryFetchRaw(ref, altPath));
  let pj: PluginJson | null = null;
  if (text) {
    try {
      pj = JSON.parse(text) as PluginJson;
    } catch (e) {
      logError(`parse plugin.json ${pathInRepo}`, e);
    }
  }
  const name = pj?.name ?? fallback?.name ?? basename(pathInRepo);
  if (!name) return null;
  const author = pj?.author ?? fallback?.author;
  return {
    kind: 'plugin',
    id: `${ref.owner}/${ref.repo}#${name}`,
    name,
    description: pj?.description ?? fallback?.description,
    version: pj?.version ?? fallback?.version,
    author: typeof author === 'string' ? author : author?.name,
    commands: namesOf(pj?.commands) ?? fallback?.commands,
    agents: namesOf(pj?.agents) ?? fallback?.agents,
    skills: namesOf(pj?.skills) ?? fallback?.skills,
    sourceRepo: `${ref.owner}/${ref.repo}`,
    sourceUrl: `https://github.com/${ref.owner}/${ref.repo}/tree/${ref.ref}/${pathInRepo}`,
    pathInRepo,
    ref: ref.ref
  };
}

function namesOf(v: PluginJson['commands']): string[] | undefined {
  if (!v) return undefined;
  const arr = Array.isArray(v) ? v : [];
  return arr.map((x) => (typeof x === 'string' ? x : x?.name ?? '')).filter(Boolean);
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
