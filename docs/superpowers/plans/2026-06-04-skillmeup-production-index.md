# SkillMeUp Production-Ready Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SkillMeUp's live per-user GitHub fetching with a nightly CI crawler that publishes a static index to GitHub Pages, plus tiered discovery, ranked search, and a search-engine webview UX.

**Architecture:** A standalone TypeScript crawler (run by GitHub Actions on a cron) discovers and parses skill/plugin repos across the ecosystem, tags each `verified` or `community`, and emits `index.json` + `meta.json` to a `gh-pages` branch served via GitHub Pages. The extension fetches that single static file (ETag-conditional GET + cache) — **zero GitHub API calls on the default path**. A pure `SearchEngine` module ranks results host-side (instant local IPC, one tested implementation), and the webview renders a faceted, badge-rich discovery surface. The legacy live fetchers are retained only behind an opt-in "add custom source" path.

**Tech Stack:** TypeScript, Node 20 (global `fetch`), esbuild (extension bundle), `tsx` (run crawler), Vitest (tests), `js-yaml` + `minimatch` (existing), GitHub Actions + GitHub Pages.

**Architecture refinement vs. spec:** The spec described search as "fully client-side in the webview." This plan instead runs the `SearchEngine` in the **extension host** and returns results to the webview over local `postMessage` IPC. This is in-process and instant (no network), keeps a **single, unit-tested** ranking implementation (DRY), and avoids duplicating scoring logic in webview JS. User-facing behavior (instant search) is identical.

**Phases (each independently shippable):**
- **Phase 0** — Test harness + shared parser extraction (no behavior change).
- **Phase A** — Crawler + index schema + CI publishing (produces `index.json`; extension unchanged).
- **Phase B** — `IndexClient` + wire into extension; demote live fetchers; config.
- **Phase C** — `SearchEngine` ranked search module.
- **Phase D** — Webview discovery UX.

---

## File Structure

**New files:**
- `vitest.config.ts` — test runner config.
- `tsconfig.crawler.json` — typecheck config covering `crawler/` + `src/shared/`.
- `src/shared/parse/frontmatter.ts` — moved from `src/util/yaml.ts` (vscode-free).
- `src/shared/parse/manifest.ts` — pure marketplace.json / plugin.json parsing.
- `src/shared/parse/manifest.test.ts` — manifest parser tests.
- `src/shared/indexTypes.ts` — index schema types + constants.
- `crawler/categorize.ts` + `crawler/categorize.test.ts` — topic/path → category.
- `crawler/github.ts` — GitHub REST/raw client (PAT from env, injectable fetch).
- `crawler/parseRepo.ts` + `crawler/parseRepo.test.ts` — repo → `CatalogItem[]`.
- `crawler/discover.ts` + `crawler/discover.test.ts` — seeds + denylist + search discovery.
- `crawler/buildIndex.ts` + `crawler/buildIndex.test.ts` — entries → `SkillMeUpIndex`.
- `crawler/index.ts` — main orchestration + file emission.
- `crawler/seeds.json` — curated verified repos.
- `crawler/denylist.json` — excluded repos.
- `.github/workflows/crawl.yml` — nightly crawl + Pages deploy.
- `src/index/indexClient.ts` + `src/index/indexClient.test.ts` — fetch/cache the published index.
- `src/search/searchEngine.ts` + `src/search/searchEngine.test.ts` — ranked search.

**Modified files:**
- `package.json` — devDeps (`vitest`, `tsx`), scripts, config (`skillmeup.indexUrl`), empty default `sources`.
- `tsconfig.json` — keep `src/**`; (crawler typechecked separately).
- `src/sources/types.ts` — add optional `tier`/`stars`/`category`/`tags`/`updatedAt` to `BaseMeta`.
- `src/sources/marketplaceFetcher.ts` — import frontmatter parser from new shared path.
- `src/extension.ts` — use `IndexClient` for default catalog; keep `SourceRegistry` for custom sources; run `SearchEngine` for webview search messages.
- `src/ui/webview/panel.ts` — send catalog+facets+suggested; handle `search`/`filter`; lazy README; drop default GitHub-search path.
- `src/ui/webview/media/main.js` — search bar, filter chips, ranked result rows, badges, suggested section.
- `src/ui/webview/media/main.css` — styling for the above.

**Deleted from default path (retained for custom sources only):** `src/util/githubSearch.ts` stays in the tree but is no longer wired into the default webview flow.

---

## PHASE 0 — Test harness + shared parser extraction

### Task 0.1: Add Vitest test harness

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDependencies + scripts)

- [ ] **Step 1: Add devDependencies and scripts to `package.json`**

In the `"scripts"` block add:
```json
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck:crawler": "tsc -p tsconfig.crawler.json --noEmit"
```

In `"devDependencies"` add:
```json
    "vitest": "^2.1.8",
    "tsx": "^4.19.2"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'crawler/**/*.test.ts'],
    environment: 'node'
  }
});
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules/.bin/vitest` exists.

- [ ] **Step 4: Add a smoke test to prove the harness runs**

Create `src/shared/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 6: Delete the smoke test and commit**

Run: `rm src/shared/smoke.test.ts`
```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test harness and crawler typecheck script"
```

---

### Task 0.2: Extract shared parser (frontmatter + manifest)

**Files:**
- Create: `src/shared/parse/frontmatter.ts` (moved from `src/util/yaml.ts`)
- Create: `src/shared/parse/manifest.ts`
- Create: `src/shared/parse/manifest.test.ts`
- Modify: `src/sources/marketplaceFetcher.ts` (import path)
- Delete: `src/util/yaml.ts`

- [ ] **Step 1: Create `src/shared/parse/frontmatter.ts`** (verbatim move of `src/util/yaml.ts`)

```ts
import * as yaml from 'js-yaml';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'when-to-use'?: string;
  when_to_use?: string;
  whenToUse?: string;
  paths?: string[];
  'allowed-tools'?: string[];
  allowed_tools?: string[];
  allowedTools?: string[];
  [k: string]: unknown;
}

/**
 * Extracts YAML frontmatter from a SKILL.md-style document.
 * Returns { data, body } where body is the markdown after the closing ---.
 */
export function parseFrontmatter(text: string): { data: SkillFrontmatter; body: string } {
  if (!text.startsWith('---')) {
    return { data: {}, body: text };
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    return { data: {}, body: text };
  }
  const raw = text.slice(3, end).replace(/^\r?\n/, '');
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  try {
    const data = (yaml.load(raw) as SkillFrontmatter) || {};
    return { data, body };
  } catch {
    return { data: {}, body };
  }
}

export function normalizePaths(fm: SkillFrontmatter): string[] {
  const p = fm.paths;
  if (!p) return [];
  if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string');
  if (typeof p === 'string') return [p];
  return [];
}

export function normalizeWhenToUse(fm: SkillFrontmatter): string | undefined {
  return (
    fm.whenToUse ??
    fm['when-to-use'] ??
    fm.when_to_use ??
    undefined
  );
}

export function normalizeAllowedTools(fm: SkillFrontmatter): string[] {
  const v: unknown = fm.allowedTools ?? fm['allowed-tools'] ?? fm.allowed_tools;
  if (!v) return [];
  if (Array.isArray(v)) return (v as unknown[]).filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') return v.split(',').map((s: string) => s.trim()).filter(Boolean);
  return [];
}
```

- [ ] **Step 2: Write failing tests for the manifest parser**

Create `src/shared/parse/manifest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseMarketplaceJson, parsePluginJson, manifestPluginNames } from './manifest';

describe('parseMarketplaceJson', () => {
  it('returns plugin entries with normalized source paths', () => {
    const json = JSON.stringify({
      name: 'mp',
      plugins: [
        { name: 'a', source: './plugins/a', description: 'A' },
        { name: 'b', source: 'skills/b' }
      ]
    });
    const mp = parseMarketplaceJson(json);
    expect(mp).not.toBeNull();
    expect(mp!.plugins.map((p) => p.name)).toEqual(['a', 'b']);
    expect(mp!.plugins[0].source).toBe('plugins/a');
  });

  it('returns null on invalid JSON', () => {
    expect(parseMarketplaceJson('{ not json')).toBeNull();
  });
});

describe('parsePluginJson', () => {
  it('parses name/description/version', () => {
    const pj = parsePluginJson(JSON.stringify({ name: 'x', description: 'd', version: '1.0.0' }));
    expect(pj).toEqual({ name: 'x', description: 'd', version: '1.0.0', author: undefined, commands: undefined, agents: undefined, skills: undefined });
  });

  it('returns null on invalid JSON', () => {
    expect(parsePluginJson('nope')).toBeNull();
  });
});

describe('manifestPluginNames', () => {
  it('handles string arrays and object arrays', () => {
    expect(manifestPluginNames(['a', 'b'])).toEqual(['a', 'b']);
    expect(manifestPluginNames([{ name: 'a' }, { name: '' }])).toEqual(['a']);
    expect(manifestPluginNames(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/shared/parse/manifest.test.ts`
Expected: FAIL — cannot find module `./manifest`.

- [ ] **Step 4: Implement `src/shared/parse/manifest.ts`**

```ts
export interface MarketplacePlugin {
  name: string;
  source: string;            // normalized: leading "./" stripped
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string[];
  agents?: string[];
  skills?: string[];
}

export interface ParsedMarketplace {
  name?: string;
  plugins: MarketplacePlugin[];
}

export interface ParsedPlugin {
  name?: string;
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string[];
  agents?: string[];
  skills?: string[];
}

/** Parse a marketplace.json. Returns null if the text is not valid JSON. */
export function parseMarketplaceJson(text: string): ParsedMarketplace | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const plugins: MarketplacePlugin[] = [];
  for (const p of Array.isArray(raw?.plugins) ? raw.plugins : []) {
    if (!p || typeof p.name !== 'string') continue;
    const source = typeof p.source === 'string' ? p.source.replace(/^\.\//, '') : '';
    plugins.push({
      name: p.name,
      source,
      description: typeof p.description === 'string' ? p.description : undefined,
      version: typeof p.version === 'string' ? p.version : undefined,
      author: p.author,
      commands: manifestPluginNames(p.commands),
      agents: manifestPluginNames(p.agents),
      skills: manifestPluginNames(p.skills)
    });
  }
  return { name: typeof raw?.name === 'string' ? raw.name : undefined, plugins };
}

/** Parse a plugin.json. Returns null if the text is not valid JSON. */
export function parsePluginJson(text: string): ParsedPlugin | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return {
    name: typeof raw?.name === 'string' ? raw.name : undefined,
    description: typeof raw?.description === 'string' ? raw.description : undefined,
    version: typeof raw?.version === 'string' ? raw.version : undefined,
    author: raw?.author,
    commands: manifestPluginNames(raw?.commands),
    agents: manifestPluginNames(raw?.agents),
    skills: manifestPluginNames(raw?.skills)
  };
}

/** Normalize a commands/agents/skills field that may be string[] or {name}[]. */
export function manifestPluginNames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .map((x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? (x as any).name ?? '' : '')))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/shared/parse/manifest.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Re-point the marketplaceFetcher import and delete the old file**

In `src/sources/marketplaceFetcher.ts` line 10, change:
```ts
import { parseFrontmatter, normalizePaths, normalizeWhenToUse, normalizeAllowedTools } from '../util/yaml';
```
to:
```ts
import { parseFrontmatter, normalizePaths, normalizeWhenToUse, normalizeAllowedTools } from '../shared/parse/frontmatter';
```

Run: `rm src/util/yaml.ts`

- [ ] **Step 7: Verify nothing else imports the old path**

Run: `grep -rn "util/yaml" src/`
Expected: no output (no remaining references).

- [ ] **Step 8: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/shared/parse/ src/sources/marketplaceFetcher.ts
git rm src/util/yaml.ts
git commit -m "refactor: extract shared frontmatter+manifest parsers (vscode-free)"
```

---

## PHASE A — Crawler + index schema + CI

### Task A.1: Index schema types

**Files:**
- Modify: `src/sources/types.ts` (extend `BaseMeta`)
- Create: `src/shared/indexTypes.ts`
- Create: `tsconfig.crawler.json`

- [ ] **Step 1: Extend `BaseMeta` in `src/sources/types.ts`**

Replace the `BaseMeta` interface (lines 8-16) with:
```ts
export type Tier = 'verified' | 'community';

export interface BaseMeta {
  id: string;                 // "<owner/repo>#<name>"
  name: string;
  description?: string;
  sourceRepo: string;         // "owner/repo"
  sourceUrl: string;          // canonical github URL
  pathInRepo: string;         // location of the folder inside the repo
  ref: string;                // branch / tag / pinned commit SHA
  tier?: Tier;                // verified (curated) | community (auto-discovered)
  stars?: number;             // source repo star count
  category?: string;          // derived category (see crawler/categorize.ts)
  tags?: string[];            // topics / keywords for search + filtering
  updatedAt?: string;         // ISO timestamp of source repo's last push
}
```

- [ ] **Step 2: Create `src/shared/indexTypes.ts`**

```ts
import { CatalogItem } from '../sources/types';

export const INDEX_VERSION = 1;

export const CATEGORIES = [
  'debugging',
  'testing',
  'frontend',
  'data',
  'docs',
  'devops',
  'security',
  'productivity',
  'other'
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface IndexStats {
  skills: number;
  plugins: number;
  repos: number;
}

export interface SkillMeUpIndex {
  version: number;
  generatedAt: string;        // ISO timestamp
  stats: IndexStats;
  entries: CatalogItem[];     // each entry is a SkillMeta | PluginMeta
}

export interface IndexMeta {
  version: number;
  generatedAt: string;
  count: number;
}
```

- [ ] **Step 3: Create `tsconfig.crawler.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["crawler/**/*.ts", "src/shared/**/*.ts", "src/sources/types.ts"]
}
```

- [ ] **Step 4: Typecheck the extension**

Run: `npm run typecheck`
Expected: clean (the new optional fields don't break existing code).

- [ ] **Step 5: Commit**

```bash
git add src/sources/types.ts src/shared/indexTypes.ts tsconfig.crawler.json
git commit -m "feat: add index schema types and tiered catalog fields"
```

---

### Task A.2: Categorizer

**Files:**
- Create: `crawler/categorize.ts`
- Create: `crawler/categorize.test.ts`

- [ ] **Step 1: Write failing tests**

Create `crawler/categorize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { categorize } from './categorize';

describe('categorize', () => {
  it('maps debugging topics/names', () => {
    expect(categorize(['debugging'], 'skills/x', 'systematic-debugging')).toBe('debugging');
  });
  it('maps testing', () => {
    expect(categorize([], 'skills/test-runner', 'webapp-testing')).toBe('testing');
  });
  it('maps frontend', () => {
    expect(categorize(['react'], 'plugins/ui', 'frontend-design')).toBe('frontend');
  });
  it('maps security', () => {
    expect(categorize([], '', 'security-review')).toBe('security');
  });
  it('falls back to other', () => {
    expect(categorize([], 'skills/misc', 'a-random-skill')).toBe('other');
  });
  it('prioritizes the first matching category by table order', () => {
    // "test" appears before "frontend" cues here; debugging cue present too.
    expect(categorize(['debugging', 'react'], '', 'debug-react')).toBe('debugging');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run crawler/categorize.test.ts`
Expected: FAIL — cannot find `./categorize`.

- [ ] **Step 3: Implement `crawler/categorize.ts`**

```ts
import { Category } from '../src/shared/indexTypes';

/**
 * Deterministic category assignment from repo topics, path, and name.
 * The first category in CATEGORY_RULES order whose keywords match wins,
 * so the table order encodes priority.
 */
const CATEGORY_RULES: Array<{ category: Category; keywords: string[] }> = [
  { category: 'debugging', keywords: ['debug', 'debugging', 'troubleshoot', 'incident'] },
  { category: 'testing', keywords: ['test', 'testing', 'tdd', 'playwright', 'e2e', 'qa'] },
  { category: 'frontend', keywords: ['frontend', 'react', 'vue', 'svelte', 'ui', 'css', 'design'] },
  { category: 'data', keywords: ['data', 'pandas', 'numpy', 'notebook', 'jupyter', 'xlsx', 'sql', 'analytics'] },
  { category: 'docs', keywords: ['docs', 'documentation', 'pdf', 'docx', 'pptx', 'writing', 'markdown'] },
  { category: 'devops', keywords: ['devops', 'docker', 'kubernetes', 'k8s', 'ci', 'deploy', 'terraform', 'workflow'] },
  { category: 'security', keywords: ['security', 'auth', 'secrets', 'vulnerability', 'audit'] },
  { category: 'productivity', keywords: ['productivity', 'memory', 'task', 'standup', 'planning', 'brainstorm'] }
];

export function categorize(topics: string[], pathInRepo: string, name: string): Category {
  const hay = [...topics, pathInRepo, name].join(' ').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => hay.includes(k))) return rule.category;
  }
  return 'other';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run crawler/categorize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crawler/categorize.ts crawler/categorize.test.ts
git commit -m "feat(crawler): deterministic category assignment"
```

---

### Task A.3: GitHub client + repo parser

**Files:**
- Create: `crawler/github.ts`
- Create: `crawler/parseRepo.ts`
- Create: `crawler/parseRepo.test.ts`

- [ ] **Step 1: Implement `crawler/github.ts`**

```ts
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export interface DirItem {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
}

export interface RepoMeta {
  defaultBranch: string;
  headSha: string;
  stars: number;
  topics: string[];
  updatedAt: string;
}

export interface CodeHit {
  fullName: string;   // owner/repo
}

/** Reader surface used by parseRepo — lets tests inject canned content. */
export interface RepoReader {
  getText(owner: string, repo: string, ref: string, path: string): Promise<string | null>;
  listDir(owner: string, repo: string, ref: string, path: string): Promise<DirItem[]>;
}

export interface GhClient extends RepoReader {
  getRepoMeta(owner: string, repo: string): Promise<RepoMeta | null>;
  searchCode(query: string, maxPages: number): Promise<CodeHit[]>;
  searchReposByTopic(topic: string, maxPages: number): Promise<CodeHit[]>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createGhClient(token: string, fetchFn: typeof fetch = fetch): GhClient {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SkillMeUp-Crawler',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function api<T>(path: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetchFn(`${API}${path}`, { headers });
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        const waitMs = Number.isFinite(reset) ? Math.max(1000, reset - Date.now()) : 2000 * (attempt + 1);
        console.warn(`[gh] rate limited on ${path}; waiting ${Math.round(waitMs / 1000)}s`);
        await sleep(Math.min(waitMs, 60_000));
        continue;
      }
      if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    }
    throw new Error(`GET ${path} -> exhausted retries`);
  }

  return {
    async getText(owner, repo, ref, path) {
      const res = await fetchFn(`${RAW}/${owner}/${repo}/${ref}/${path}`, {
        headers: { 'User-Agent': 'SkillMeUp-Crawler' }
      });
      if (!res.ok) return null;
      return res.text();
    },

    async listDir(owner, repo, ref, path) {
      try {
        const json = await api<DirItem | DirItem[]>(
          `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`
        );
        return Array.isArray(json) ? json : [json];
      } catch {
        return [];
      }
    },

    async getRepoMeta(owner, repo) {
      try {
        const r = await api<any>(`/repos/${owner}/${repo}`);
        const defaultBranch = r.default_branch || 'main';
        const branch = await api<any>(`/repos/${owner}/${repo}/branches/${encodeURIComponent(defaultBranch)}`);
        return {
          defaultBranch,
          headSha: branch?.commit?.sha ?? defaultBranch,
          stars: r.stargazers_count ?? 0,
          topics: Array.isArray(r.topics) ? r.topics : [],
          updatedAt: r.pushed_at ?? r.updated_at ?? ''
        };
      } catch {
        return null;
      }
    },

    async searchCode(query, maxPages) {
      const out: CodeHit[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= maxPages; page++) {
        let data: any;
        try {
          data = await api<any>(`/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`);
        } catch (e) {
          console.warn(`[gh] searchCode page ${page} failed: ${(e as Error).message}`);
          break;
        }
        for (const it of data.items ?? []) {
          const fn = it.repository?.full_name;
          if (fn && !seen.has(fn)) { seen.add(fn); out.push({ fullName: fn }); }
        }
        if ((data.items?.length ?? 0) < 100) break;
        await sleep(2000); // code search is heavily throttled
      }
      return out;
    },

    async searchReposByTopic(topic, maxPages) {
      const out: CodeHit[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= maxPages; page++) {
        let data: any;
        try {
          data = await api<any>(`/search/repositories?q=topic:${encodeURIComponent(topic)}&per_page=100&page=${page}`);
        } catch (e) {
          console.warn(`[gh] searchReposByTopic page ${page} failed: ${(e as Error).message}`);
          break;
        }
        for (const it of data.items ?? []) {
          const fn = it.full_name;
          if (fn && !seen.has(fn)) { seen.add(fn); out.push({ fullName: fn }); }
        }
        if ((data.items?.length ?? 0) < 100) break;
        await sleep(1000);
      }
      return out;
    }
  };
}
```

- [ ] **Step 2: Write failing tests for `parseRepo`**

Create `crawler/parseRepo.test.ts`:
```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run crawler/parseRepo.test.ts`
Expected: FAIL — cannot find `./parseRepo`.

- [ ] **Step 4: Implement `crawler/parseRepo.ts`**

```ts
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
  const { owner, repo, tier } = target;
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
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run crawler/parseRepo.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 6: Typecheck the crawler**

Run: `npm run typecheck:crawler`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crawler/github.ts crawler/parseRepo.ts crawler/parseRepo.test.ts
git commit -m "feat(crawler): github client and repo parser"
```

---

### Task A.4: Discovery (seeds + denylist + search)

**Files:**
- Create: `crawler/seeds.json`
- Create: `crawler/denylist.json`
- Create: `crawler/discover.ts`
- Create: `crawler/discover.test.ts`

- [ ] **Step 1: Create `crawler/seeds.json`** (curated verified repos)

```json
{
  "repos": [
    "anthropics/skills",
    "anthropics/claude-plugins-official",
    "anthropics/claude-cookbooks"
  ]
}
```

- [ ] **Step 2: Create `crawler/denylist.json`**

```json
{
  "repos": []
}
```

- [ ] **Step 3: Write failing tests for `discover`**

Create `crawler/discover.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { discover } from './discover';
import { GhClient } from './github';

function fakeClient(codeHits: string[], topicHits: string[]): GhClient {
  return {
    async getText() { return null; },
    async listDir() { return []; },
    async getRepoMeta() { return null; },
    async searchCode() { return codeHits.map((fullName) => ({ fullName })); },
    async searchReposByTopic() { return topicHits.map((fullName) => ({ fullName })); }
  };
}

describe('discover', () => {
  it('tags seed repos verified and search hits community', async () => {
    const client = fakeClient(['alice/skills-pack'], ['bob/claude-stuff']);
    const targets = await discover(client, { repos: ['anthropics/skills'] }, { repos: [] });
    const byName = Object.fromEntries(targets.map((t) => [`${t.owner}/${t.repo}`, t.tier]));
    expect(byName['anthropics/skills']).toBe('verified');
    expect(byName['alice/skills-pack']).toBe('community');
    expect(byName['bob/claude-stuff']).toBe('community');
  });

  it('excludes denylisted repos', async () => {
    const client = fakeClient(['spam/bad-repo'], []);
    const targets = await discover(client, { repos: [] }, { repos: ['spam/bad-repo'] });
    expect(targets.find((t) => t.repo === 'bad-repo')).toBeUndefined();
  });

  it('deduplicates: a repo in seeds stays verified even if also found by search', async () => {
    const client = fakeClient(['anthropics/skills'], []);
    const targets = await discover(client, { repos: ['anthropics/skills'] }, { repos: [] });
    const matches = targets.filter((t) => `${t.owner}/${t.repo}` === 'anthropics/skills');
    expect(matches).toHaveLength(1);
    expect(matches[0].tier).toBe('verified');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run crawler/discover.test.ts`
Expected: FAIL — cannot find `./discover`.

- [ ] **Step 5: Implement `crawler/discover.ts`**

```ts
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
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run crawler/discover.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crawler/seeds.json crawler/denylist.json crawler/discover.ts crawler/discover.test.ts
git commit -m "feat(crawler): repo discovery with verified/community tiers"
```

---

### Task A.5: Build index + main orchestration

**Files:**
- Create: `crawler/buildIndex.ts`
- Create: `crawler/buildIndex.test.ts`
- Create: `crawler/index.ts`

- [ ] **Step 1: Write failing tests for `buildIndex`**

Create `crawler/buildIndex.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildIndex } from './buildIndex';
import { CatalogItem } from '../src/sources/types';
import { INDEX_VERSION } from '../src/shared/indexTypes';

function skill(id: string, repo: string, tier: 'verified' | 'community'): CatalogItem {
  return {
    kind: 'skill', id, name: id.split('#')[1], sourceRepo: repo,
    sourceUrl: 'u', pathInRepo: 'p', ref: 'sha', tier, stars: 1
  };
}

describe('buildIndex', () => {
  it('produces a versioned index with correct stats', () => {
    const idx = buildIndex([
      skill('o/r#a', 'o/r', 'verified'),
      { ...skill('o/r#b', 'o/r', 'community'), kind: 'plugin' } as CatalogItem
    ], '2026-06-04T00:00:00Z');
    expect(idx.version).toBe(INDEX_VERSION);
    expect(idx.generatedAt).toBe('2026-06-04T00:00:00Z');
    expect(idx.stats.skills).toBe(1);
    expect(idx.stats.plugins).toBe(1);
    expect(idx.stats.repos).toBe(1);
    expect(idx.entries).toHaveLength(2);
  });

  it('dedupes by id, preferring verified over community', () => {
    const idx = buildIndex([
      skill('o/r#a', 'o/r', 'community'),
      skill('o/r#a', 'o/r', 'verified')
    ], 'ts');
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries[0].tier).toBe('verified');
  });

  it('sorts entries by tier then stars descending', () => {
    const idx = buildIndex([
      { ...skill('o/r#low', 'o/r', 'community'), stars: 5 },
      { ...skill('o/r#high', 'o/r', 'community'), stars: 500 },
      { ...skill('o/r#ver', 'o/r', 'verified'), stars: 1 }
    ], 'ts');
    expect(idx.entries.map((e) => e.name)).toEqual(['ver', 'high', 'low']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run crawler/buildIndex.test.ts`
Expected: FAIL — cannot find `./buildIndex`.

- [ ] **Step 3: Implement `crawler/buildIndex.ts`**

```ts
import { CatalogItem } from '../src/sources/types';
import { SkillMeUpIndex, IndexMeta, INDEX_VERSION } from '../src/shared/indexTypes';

const tierRank = (t?: string) => (t === 'verified' ? 0 : 1);

/** Dedupe by id (verified wins), sort by tier then stars, compute stats. */
export function buildIndex(entries: CatalogItem[], generatedAt: string): SkillMeUpIndex {
  const byId = new Map<string, CatalogItem>();
  for (const e of entries) {
    const existing = byId.get(e.id);
    if (!existing) { byId.set(e.id, e); continue; }
    // Prefer verified; otherwise keep the one with more stars.
    if (tierRank(e.tier) < tierRank(existing.tier)) byId.set(e.id, e);
    else if (tierRank(e.tier) === tierRank(existing.tier) && (e.stars ?? 0) > (existing.stars ?? 0)) byId.set(e.id, e);
  }

  const deduped = [...byId.values()].sort((a, b) => {
    const t = tierRank(a.tier) - tierRank(b.tier);
    if (t !== 0) return t;
    const s = (b.stars ?? 0) - (a.stars ?? 0);
    if (s !== 0) return s;
    return a.name.localeCompare(b.name);
  });

  const repos = new Set(deduped.map((e) => e.sourceRepo));
  return {
    version: INDEX_VERSION,
    generatedAt,
    stats: {
      skills: deduped.filter((e) => e.kind === 'skill').length,
      plugins: deduped.filter((e) => e.kind === 'plugin').length,
      repos: repos.size
    },
    entries: deduped
  };
}

export function buildMeta(index: SkillMeUpIndex): IndexMeta {
  return { version: index.version, generatedAt: index.generatedAt, count: index.entries.length };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run crawler/buildIndex.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `crawler/index.ts`** (main orchestration; no unit test — verified by the dry-run smoke step)

```ts
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
```

- [ ] **Step 6: Typecheck the crawler**

Run: `npm run typecheck:crawler`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crawler/buildIndex.ts crawler/buildIndex.test.ts crawler/index.ts
git commit -m "feat(crawler): build index, dedupe/sort, main orchestration"
```

---

### Task A.6: CI workflow + crawl scripts

**Files:**
- Modify: `package.json` (add `crawl` script)
- Create: `.github/workflows/crawl.yml`
- Modify: `.gitignore` (add `dist/`)

- [ ] **Step 1: Add the `crawl` script to `package.json`**

In `"scripts"` add:
```json
    "crawl": "tsx crawler/index.ts"
```

- [ ] **Step 2: Add `dist/` to `.gitignore`**

Append a line `dist/` to `.gitignore` (the crawler output is published to the `gh-pages` branch by CI, not committed to `main`).

- [ ] **Step 3: Create `.github/workflows/crawl.yml`**

```yaml
name: Crawl skills index

on:
  schedule:
    - cron: '0 3 * * *'   # nightly at 03:00 UTC
  workflow_dispatch: {}

permissions:
  contents: write

concurrency:
  group: crawl-index
  cancel-in-progress: true

jobs:
  crawl:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - name: Run crawler
        env:
          CRAWLER_GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run crawl
      - name: Deploy index to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
          publish_branch: gh-pages
          keep_files: false
```

- [ ] **Step 4: Local dry-run of the crawler**

Run: `npm run crawl`
Expected: prints discovery/parse logs and writes `dist/index.json` + `dist/meta.json`. (Without a token it may hit rate limits and parse fewer repos — that's fine for a local smoke test. To run fuller: `CRAWLER_GITHUB_TOKEN=<your PAT> npm run crawl`.)

- [ ] **Step 5: Verify the emitted index shape**

Run: `node -e "const i=require('./dist/index.json'); console.log(i.version, i.stats, i.entries.length, i.entries[0] && i.entries[0].kind)"`
Expected: prints `1 { skills, plugins, repos } <count> skill|plugin`.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore .github/workflows/crawl.yml
git commit -m "ci: nightly crawler workflow publishing index to gh-pages"
```

> **Manual one-time setup (document in README, not code):** In the GitHub repo, enable Pages from the `gh-pages` branch root. After the first workflow run the index is served at `https://<owner>.github.io/<repo>/index.json`. That URL becomes the default `skillmeup.indexUrl` in Task B.2.

---

## PHASE B — IndexClient + extension wiring

### Task B.1: IndexClient

**Files:**
- Create: `src/index/indexClient.ts`
- Create: `src/index/indexClient.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/index/indexClient.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/index/indexClient.test.ts`
Expected: FAIL — cannot find `./indexClient`.

- [ ] **Step 3: Implement `src/index/indexClient.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/index/indexClient.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/index/indexClient.ts src/index/indexClient.test.ts
git commit -m "feat: IndexClient — ETag-conditional fetch with cache + offline fallback"
```

---

### Task B.2: Wire IndexClient into the extension

**Files:**
- Modify: `package.json` (add `skillmeup.indexUrl`; empty default `sources`)
- Modify: `src/extension.ts`

- [ ] **Step 1: Add `skillmeup.indexUrl` config and empty the default `sources` in `package.json`**

In `contributes.configuration.properties`, change `skillmeup.sources` `default` (currently the two Anthropic entries) to:
```json
          "default": [],
```
and update its `description` to:
```json
          "description": "Optional user-added custom skill/plugin sources fetched live from GitHub. The default catalog comes from the hosted index (skillmeup.indexUrl); leave this empty unless adding a repo not yet indexed.",
```

Add a new property after `skillmeup.sources`:
```json
        "skillmeup.indexUrl": {
          "type": "string",
          "default": "https://anthropics.github.io/SkillMeUp/index.json",
          "description": "URL of the published SkillMeUp catalog index (index.json). Defaults to the hosted nightly index."
        },
```
> Replace the default URL with the actual GitHub Pages URL for this repo once Pages is enabled (Task A.6 setup note).

- [ ] **Step 2: Add IndexClient setup to `src/extension.ts`**

After the existing `const registry = new SourceRegistry(cache);` line (around line 30), add:
```ts
  const indexUrl = vscode.workspace.getConfiguration('skillmeup').get<string>('indexUrl', '');
  const indexTtlMs = Math.max(1, vscode.workspace.getConfiguration('skillmeup').get<number>('cacheMinutes', 720)) * 60_000;
  const indexClient = new IndexClient(context.globalState, { indexUrl, ttlMs: indexTtlMs });
```
And add the import at the top:
```ts
import { IndexClient } from './index/indexClient';
import { Catalog, mergeCatalogs } from './sources/types';
```
(Adjust the existing `import { CatalogItem, SourceConfig } from './sources/types';` to also include `Catalog` and `mergeCatalogs`, or add the new import line — ensure no duplicate symbols.)

- [ ] **Step 3: Add a catalog-combining helper inside `activate` (default index + any custom sources)**

Add this function inside `activate`, above `refreshCatalog`:
```ts
  async function loadCatalog(force: boolean): Promise<Catalog> {
    const indexCatalog = await indexClient.getCatalog(force);
    const customSources = vscode.workspace.getConfiguration('skillmeup').get<SourceConfig[]>('sources', []);
    if (customSources.length === 0) return indexCatalog;
    // Merge user-added live sources on top of the hosted index.
    const custom = await registry.getCatalog(force);
    return mergeCatalogs([indexCatalog, custom]);
  }
```

- [ ] **Step 4: Use `loadCatalog` in `refreshCatalog` and `openInstallPanel`**

In `refreshCatalog`, replace `const catalog = await registry.getCatalog(force);` with:
```ts
      const catalog = await loadCatalog(force);
```
In the `skillmeup.openInstallPanel` command handler, replace `const catalog = await registry.getCatalog(false);` with:
```ts
      const catalog = await loadCatalog(false);
```

- [ ] **Step 5: Route IndexClient background refreshes through the UI**

After the existing `registry.onRefreshed = ...` block, add:
```ts
  indexClient.onRefreshed = async (freshIndexCatalog) => {
    const merged = await loadCatalog(false);
    const signals = await scanWorkspace();
    const maxN = vscode.workspace.getConfiguration('skillmeup').get<number>('maxSuggestions', 10);
    const recs = recommend(merged, signals, maxN);
    tree.setState({ catalog: merged, recommendations: recs, loading: false });
    InstallPanel.updateIfOpen({ catalog: merged, recommendations: recs });
    log('index background refresh applied to UI');
  };
```

- [ ] **Step 6: React to `indexUrl` changes in the config listener**

In the `onDidChangeConfiguration` handler, add a branch:
```ts
      else if (e.affectsConfiguration('skillmeup.indexUrl')) {
        refreshCatalog(true);
      }
```

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run compile`
Expected: clean compile to `out/extension.js`.

- [ ] **Step 8: Manual smoke (load from a real index)**

Set `skillmeup.indexUrl` to a reachable published index (or a `file://`/local test URL serving the `dist/index.json` from Task A.6), launch the Extension Development Host (F5), open the SkillMeUp panel, and confirm the catalog populates with **no GitHub API calls** on load. (Check the SkillMeUp output channel — only the index URL should be fetched.)

- [ ] **Step 9: Commit**

```bash
git add package.json src/extension.ts
git commit -m "feat: default catalog from hosted index; live sources demoted to opt-in"
```

---

## PHASE C — Ranked search engine

### Task C.1: SearchEngine

**Files:**
- Create: `src/search/searchEngine.ts`
- Create: `src/search/searchEngine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/search/searchEngine.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { search, SearchFilters } from './searchEngine';
import { CatalogItem } from '../sources/types';

function item(partial: Partial<CatalogItem> & { name: string; kind: 'skill' | 'plugin' }): CatalogItem {
  return {
    id: `o/r#${partial.name}`,
    sourceRepo: 'o/r', sourceUrl: 'u', pathInRepo: 'p', ref: 'sha',
    tier: 'community', stars: 0, tags: [], ...partial
  } as CatalogItem;
}

const catalog: CatalogItem[] = [
  item({ name: 'systematic-debugging', kind: 'skill', description: 'debug methodically', category: 'debugging', tags: ['debug'], stars: 100, tier: 'verified' }),
  item({ name: 'webapp-testing', kind: 'skill', description: 'playwright tests', category: 'testing', tags: ['testing', 'playwright'], stars: 50 }),
  item({ name: 'frontend-design', kind: 'plugin', description: 'react UI components', category: 'frontend', tags: ['react'], stars: 500 }),
  item({ name: 'random-thing', kind: 'skill', description: 'unrelated', category: 'other', tags: [], stars: 10 })
];

describe('search', () => {
  it('ranks an exact name match first', () => {
    const r = search(catalog, 'webapp-testing', {});
    expect(r[0].item.name).toBe('webapp-testing');
  });

  it('matches on description and tags', () => {
    const names = search(catalog, 'react', {}).map((x) => x.item.name);
    expect(names).toContain('frontend-design');
  });

  it('returns all items sorted by tier then stars when query is empty', () => {
    const names = search(catalog, '', {}).map((x) => x.item.name);
    expect(names[0]).toBe('systematic-debugging'); // verified first
    expect(names[1]).toBe('frontend-design');      // then highest stars
  });

  it('filters by kind', () => {
    const r = search(catalog, '', { kind: 'plugin' });
    expect(r.every((x) => x.item.kind === 'plugin')).toBe(true);
  });

  it('filters by tier', () => {
    const r = search(catalog, '', { tier: 'verified' });
    expect(r).toHaveLength(1);
    expect(r[0].item.name).toBe('systematic-debugging');
  });

  it('filters by category', () => {
    const r = search(catalog, '', { category: 'testing' });
    expect(r.map((x) => x.item.name)).toEqual(['webapp-testing']);
  });

  it('filters by minStars', () => {
    const r = search(catalog, '', { minStars: 100 });
    expect(r.every((x) => (x.item.stars ?? 0) >= 100)).toBe(true);
  });

  it('excludes non-matching items for a specific query', () => {
    const names = search(catalog, 'debugging', {}).map((x) => x.item.name);
    expect(names).not.toContain('random-thing');
  });

  it('caps results to the requested limit', () => {
    const r = search(catalog, '', {}, 2);
    expect(r).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/search/searchEngine.test.ts`
Expected: FAIL — cannot find `./searchEngine`.

- [ ] **Step 3: Implement `src/search/searchEngine.ts`**

```ts
import { CatalogItem } from '../sources/types';

export interface SearchFilters {
  kind?: 'skill' | 'plugin';
  tier?: 'verified' | 'community';
  category?: string;
  minStars?: number;
}

export interface SearchResult {
  item: CatalogItem;
  score: number;
}

const DEFAULT_LIMIT = 100;

/**
 * Rank catalog items against a query with field weighting + popularity/tier
 * boosting. Empty query returns all (filtered) items sorted by tier then stars.
 * Pure and synchronous — safe to call on every keystroke.
 */
export function search(
  catalog: CatalogItem[],
  query: string,
  filters: SearchFilters,
  limit = DEFAULT_LIMIT
): SearchResult[] {
  const filtered = catalog.filter((item) => passesFilters(item, filters));
  const q = query.trim().toLowerCase();

  if (!q) {
    const sorted = [...filtered].sort(byTierThenStars);
    return sorted.slice(0, limit).map((item) => ({ item, score: 0 }));
  }

  const terms = q.split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];
  for (const item of filtered) {
    const score = scoreItem(item, terms);
    if (score > 0) results.push({ item, score });
  }
  results.sort((a, b) => b.score - a.score || byTierThenStars(a.item, b.item));
  return results.slice(0, limit);
}

function passesFilters(item: CatalogItem, f: SearchFilters): boolean {
  if (f.kind && item.kind !== f.kind) return false;
  if (f.tier && item.tier !== f.tier) return false;
  if (f.category && item.category !== f.category) return false;
  if (f.minStars != null && (item.stars ?? 0) < f.minStars) return false;
  return true;
}

function byTierThenStars(a: CatalogItem, b: CatalogItem): number {
  const tier = tierRank(a.tier) - tierRank(b.tier);
  if (tier !== 0) return tier;
  const stars = (b.stars ?? 0) - (a.stars ?? 0);
  if (stars !== 0) return stars;
  return a.name.localeCompare(b.name);
}

const tierRank = (t?: string) => (t === 'verified' ? 0 : 1);

/** Field weights — name dominates, then tags/whenToUse, then description. */
function scoreItem(item: CatalogItem, terms: string[]): number {
  const name = item.name.toLowerCase();
  const tags = (item.tags ?? []).join(' ').toLowerCase();
  const whenToUse = (item.kind === 'skill' ? item.whenToUse ?? '' : '').toLowerCase();
  const description = (item.description ?? '').toLowerCase();
  const category = (item.category ?? '').toLowerCase();
  const repo = item.sourceRepo.toLowerCase();

  let score = 0;
  let allTermsHit = true;

  for (const term of terms) {
    let termScore = 0;
    if (name === term) termScore += 100;
    else if (name.includes(term)) termScore += 40;
    if (tags.includes(term)) termScore += 20;
    if (whenToUse.includes(term)) termScore += 15;
    if (description.includes(term)) termScore += 10;
    if (category.includes(term)) termScore += 8;
    if (repo.includes(term)) termScore += 5;
    if (termScore === 0) allTermsHit = false;
    score += termScore;
  }

  // Require every term to match somewhere (AND semantics).
  if (!allTermsHit) return 0;

  // Light popularity + verified boosts so good, trusted results float up.
  score += Math.log10((item.stars ?? 0) + 1) * 3;
  if (item.tier === 'verified') score += 10;
  return score;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/search/searchEngine.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/search/searchEngine.ts src/search/searchEngine.test.ts
git commit -m "feat: ranked search engine with field weighting and facet filters"
```

---

## PHASE D — Webview discovery UX

### Task D.1: Panel — facets, search routing, serialization

**Files:**
- Modify: `src/ui/webview/panel.ts`

- [ ] **Step 1: Replace the GitHub-search message handling with SearchEngine routing**

In `src/ui/webview/panel.ts`, change the import line 5 from:
```ts
import { searchGitHubForSkills, RateLimitError } from '../../util/githubSearch';
```
to:
```ts
import { search, SearchFilters } from '../../search/searchEngine';
import { CATEGORIES } from '../../shared/indexTypes';
```

- [ ] **Step 2: Replace the `serialize` function and `update` method to send catalog + facets + suggested**

Replace the existing `serialize` function (bottom of file) with:
```ts
function serialize(data: PanelData): {
  items: CatalogItem[];
  suggestedIds: string[];
  reasons: Record<string, string[]>;
  facets: { categories: string[]; counts: { skills: number; plugins: number; verified: number; community: number } };
} {
  const items = [...data.catalog.skills, ...data.catalog.plugins];
  const reasons: Record<string, string[]> = {};
  const suggestedIds: string[] = [];
  for (const r of data.recommendations) {
    suggestedIds.push(r.item.id);
    reasons[r.item.id] = r.reasons;
  }
  const present = new Set(items.map((i) => i.category).filter(Boolean) as string[]);
  return {
    items,
    suggestedIds,
    reasons,
    facets: {
      categories: CATEGORIES.filter((c) => present.has(c)),
      counts: {
        skills: data.catalog.skills.length,
        plugins: data.catalog.plugins.length,
        verified: items.filter((i) => i.tier === 'verified').length,
        community: items.filter((i) => i.tier === 'community').length
      }
    }
  };
}
```

- [ ] **Step 3: Add a `search` message handler in `handleMessage`**

In `handleMessage`, replace the `else if (msg?.type === 'search-github')` and `else if (msg?.type === 'add-github-source')` branches with a single local-search branch:
```ts
    } else if (msg?.type === 'search') {
      const query = (msg.query as string | undefined) ?? '';
      const filters = (msg.filters as SearchFilters | undefined) ?? {};
      const results = search(this.lastItems, query, filters);
      this.panel.webview.postMessage({
        type: 'results',
        ids: results.map((r) => r.item.id)
      });
    }
```
(Keep the existing `install`, `open-github`, `add-source`, `refresh` branches unchanged.)

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run compile`
Expected: clean. (`githubSearch.ts` is now unreferenced by the default path; leave it in the tree for the custom-source command.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/webview/panel.ts
git commit -m "feat(webview): route search through SearchEngine; send facets + suggested"
```

---

### Task D.2: Webview script — search bar, filters, ranked rows

**Files:**
- Modify: `src/ui/webview/media/main.js`

- [ ] **Step 1: Rewrite `src/ui/webview/media/main.js`** (full replacement)

```js
(function () {
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const summary = document.getElementById('summary');
  const installBtn = document.getElementById('install');
  const cancelBtn = document.getElementById('cancel');
  const refreshBtn = document.getElementById('refresh');
  const addSourceBtn = document.getElementById('add-source');
  const searchInput = document.getElementById('search');
  const filterBar = document.getElementById('filters');

  /** itemsById: id -> item. order: ids in rank order from host. */
  let itemsById = new Map();
  let suggestedIds = [];
  let reasons = {};
  let facets = { categories: [], counts: { skills: 0, plugins: 0, verified: 0, community: 0 } };
  let resultIds = [];
  const selected = new Set();
  let filters = {};
  let query = '';
  let debounceTimer = null;

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state') {
      itemsById = new Map(msg.data.items.map((i) => [i.id, i]));
      suggestedIds = msg.data.suggestedIds;
      reasons = msg.data.reasons;
      facets = msg.data.facets;
      selected.clear();
      for (const id of suggestedIds) selected.add(id);
      renderFilters();
      requestSearch(true);
    } else if (msg.type === 'results') {
      resultIds = msg.ids;
      render();
    } else if (msg.type === 'install:done') {
      for (const r of msg.results) if (r.status === 'installed') selected.delete(r.item.id);
      render();
    }
  });

  installBtn.addEventListener('click', () => {
    if (selected.size === 0) return;
    vscode.postMessage({ type: 'install', ids: [...selected] });
  });
  cancelBtn.addEventListener('click', () => { selected.clear(); render(); });
  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  addSourceBtn.addEventListener('click', () => vscode.postMessage({ type: 'add-source' }));

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    requestSearch(false);
  });

  function requestSearch(immediate) {
    clearTimeout(debounceTimer);
    const send = () => vscode.postMessage({ type: 'search', query, filters });
    if (immediate) send();
    else debounceTimer = setTimeout(send, 120); // render debounce only; search is local + instant
  }

  function renderFilters() {
    filterBar.innerHTML = '';
    const groups = [
      { key: 'kind', label: 'All', value: undefined, active: () => filters.kind === undefined && filters.tier === undefined && !filters.category },
      { key: 'kind', label: 'Skills', value: 'skill', active: () => filters.kind === 'skill' },
      { key: 'kind', label: 'Plugins', value: 'plugin', active: () => filters.kind === 'plugin' },
      { key: 'tier', label: '✓ Verified', value: 'verified', active: () => filters.tier === 'verified' },
      { key: 'tier', label: 'Community', value: 'community', active: () => filters.tier === 'community' }
    ];
    for (const c of facets.categories) {
      groups.push({ key: 'category', label: c, value: c, active: () => filters.category === c });
    }
    for (const g of groups) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (g.active() ? ' active' : '');
      chip.textContent = g.label;
      chip.addEventListener('click', () => {
        if (g.label === 'All') {
          filters = {};
        } else if (filters[g.key] === g.value) {
          delete filters[g.key];
        } else {
          filters[g.key] = g.value;
        }
        renderFilters();
        requestSearch(true);
      });
      filterBar.appendChild(chip);
    }
  }

  function render() {
    content.innerHTML = '';
    const hasQueryOrFilter = query.trim().length > 0 || Object.keys(filters).length > 0;

    // Suggested section (only when not actively searching/filtering).
    if (!hasQueryOrFilter && suggestedIds.length) {
      const sec = sectionEl('Suggested for this workspace');
      for (const id of suggestedIds) {
        const item = itemsById.get(id);
        if (item) sec.appendChild(rowEl(item, reasons[id] || []));
      }
      content.appendChild(sec);
    }

    const title = hasQueryOrFilter ? `Results (${resultIds.length})` : `All skills & plugins (${resultIds.length})`;
    const sec = sectionEl(title);
    if (resultIds.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.padding = '12px 4px';
      p.textContent = itemsById.size === 0
        ? 'Catalog is empty. Click Refresh to load the index.'
        : 'No matches. Try a different term or clear filters.';
      sec.appendChild(p);
    } else {
      for (const id of resultIds) {
        const item = itemsById.get(id);
        if (item) sec.appendChild(rowEl(item, []));
      }
    }
    content.appendChild(sec);
    updateFooter();
  }

  function updateFooter() {
    installBtn.disabled = selected.size === 0;
    installBtn.textContent = `Install ${selected.size}`;
    summary.textContent = `${facets.counts.skills} skills · ${facets.counts.plugins} plugins · ${facets.counts.verified} verified · ${selected.size} selected`;
  }

  function sectionEl(title) {
    const wrap = document.createElement('div');
    wrap.className = 'section';
    const h = document.createElement('h2');
    h.textContent = title;
    wrap.appendChild(h);
    return wrap;
  }

  function badge(text, cls) {
    const span = document.createElement('span');
    span.className = 'badge ' + cls;
    span.textContent = text;
    return span;
  }

  function rowEl(item, itemReasons) {
    const row = document.createElement('div');
    row.className = 'row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(item.id);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(item.id);
      else selected.delete(item.id);
      updateFooter();
    });

    const body = document.createElement('div');
    body.className = 'body';

    const title = document.createElement('div');
    title.className = 'title';
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = item.name;
    title.appendChild(nameEl);
    title.appendChild(badge(item.kind, 'kind'));
    if (item.tier === 'verified') title.appendChild(badge('✓ Verified', 'verified'));
    else if (item.tier === 'community') title.appendChild(badge('Community', 'community'));
    if (typeof item.stars === 'number' && item.stars > 0) title.appendChild(badge('★ ' + item.stars, 'stars'));

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = item.description || (item.whenToUse || '');
    desc.title = desc.textContent;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = item.sourceRepo;
    a.addEventListener('click', (e) => { e.preventDefault(); vscode.postMessage({ type: 'open-github', url: item.sourceUrl }); });
    meta.appendChild(a);
    if (item.category) meta.appendChild(badge(item.category, 'cat'));
    for (const t of (item.tags || []).slice(0, 3)) meta.appendChild(badge(t, 'tag'));

    body.appendChild(title);
    if (desc.textContent) body.appendChild(desc);
    body.appendChild(meta);

    if (itemReasons && itemReasons.length) {
      const rWrap = document.createElement('div');
      rWrap.className = 'reasons';
      for (const r of itemReasons) {
        const tag = document.createElement('span');
        tag.className = 'reason';
        tag.textContent = r;
        rWrap.appendChild(tag);
      }
      body.appendChild(rWrap);
    }

    const installOne = document.createElement('button');
    installOne.className = 'ghost row-install';
    installOne.textContent = 'Install';
    installOne.addEventListener('click', () => vscode.postMessage({ type: 'install', ids: [item.id] }));

    row.appendChild(cb);
    row.appendChild(body);
    row.appendChild(installOne);
    return row;
  }
})();
```

- [ ] **Step 2: Add the `#filters` container to the HTML in `panel.ts`**

In `src/ui/webview/panel.ts` `renderHtml()`, between the `<div class="searchbar">…</div>` block and `<main id="content">`, insert:
```html
  <div id="filters" class="filters"></div>
```
Also change the search input `placeholder` to `Search skills & plugins…`.

- [ ] **Step 3: Build and manual smoke**

Run: `npm run compile`
Then F5 (Extension Development Host) → open SkillMeUp panel. Verify: typing filters instantly; filter chips toggle; Verified/Community badges, stars, and category tags render; Suggested section appears with empty query; per-row and bulk Install both work.

- [ ] **Step 4: Commit**

```bash
git add src/ui/webview/media/main.js src/ui/webview/panel.ts
git commit -m "feat(webview): faceted search UI with tier/star/category badges"
```

---

### Task D.3: Webview styling

**Files:**
- Modify: `src/ui/webview/media/main.css`

- [ ] **Step 1: Append filter/badge/row styles to `src/ui/webview/media/main.css`**

Append:
```css
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.chip {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--vscode-panel-border);
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
}
.chip.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}
.row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); }
.row .body { flex: 1; min-width: 0; }
.row .title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.row .name { font-weight: 600; }
.row .desc { font-size: 12px; opacity: 0.85; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; font-size: 11px; }
.row-install { align-self: center; white-space: nowrap; }
.badge { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--vscode-panel-border); }
.badge.kind { text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
.badge.verified { color: var(--vscode-testing-iconPassed, #3fb950); border-color: currentColor; }
.badge.community { opacity: 0.7; }
.badge.stars { opacity: 0.8; }
.badge.cat { opacity: 0.75; }
.badge.tag { opacity: 0.6; }
.reasons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.reason { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
```

- [ ] **Step 2: Build and visually verify**

Run: `npm run compile`
Then F5 and confirm chips, badges, and rows are styled and legible in both light and dark themes.

- [ ] **Step 3: Commit**

```bash
git add src/ui/webview/media/main.css
git commit -m "style(webview): filter chips, badges, and result row layout"
```

---

## Deferred (post-v1, conscious scope cuts)

These spec items are intentionally **not** in this plan to keep each phase shippable. They are additive and depend on nothing above:

- **Row detail expand + lazy README preview** (spec §D "Detail expand"). The result rows already surface the key metadata (description, when-to-use, category, tags, stars, tier, source link). An expandable drawer that lazily fetches the source README from raw CDN on click is a follow-up. Not built here.
- **"Search GitHub live" advanced action.** `src/util/githubSearch.ts` remains in the tree but is unwired from the default flow. Re-exposing it behind an explicit advanced command (the only place a token matters) is a follow-up.

## Final Verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass (manifest, categorize, parseRepo, discover, buildIndex, indexClient, searchEngine).

- [ ] **Step 2: Typecheck both projects**

Run: `npm run typecheck && npm run typecheck:crawler`
Expected: both clean.

- [ ] **Step 3: Production build**

Run: `npm run compile`
Expected: `out/extension.js` produced without errors.

- [ ] **Step 4: End-to-end manual check against a live/published index**
  - Default load populates the catalog with **no GitHub API calls** (check output channel).
  - Search is instant; filters (kind/tier/category) work.
  - Suggested section reflects the open workspace.
  - Install (single + bulk) writes SHA-pinned folders into `.claude/`.
  - "Add source from GitHub URL" still works for a custom repo (the only path where a token matters).

- [ ] **Step 5: Final commit (any cleanup)**

```bash
git add -A
git commit -m "chore: production-ready index — final verification"
```
