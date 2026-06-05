# SkillMeUp — Production-Ready Design

**Date:** 2026-06-04
**Status:** Approved for planning
**Owner:** SkillMeUp

## 1. Problem

SkillMeUp today is a working prototype but not a product we can confidently demo as a
"search engine for Claude Code skills." The gaps:

1. **Source lock-in.** The default catalog is hardcoded to two Anthropic repos
   (`anthropics/skills`, `anthropics/claude-plugins-official`). It does not discover the
   broader community ecosystem.
2. **Runtime rate limits and blockers.** Every catalog load and every search hits the
   GitHub API live (`marketplaceFetcher`, `awesomeListFetcher`, `githubSearch`). Without a
   token, users hit the 60 req/hr unauthenticated ceiling almost immediately. The product
   responds with "add a token" messaging — the exact friction that makes a user say
   *"I could have found this on the internet, why use the extension?"*
3. **Weak search.** Search is a substring `filter` over whatever happens to be cached
   locally, with a slow, rate-limited live GitHub fallback. There is no ranking, no
   fuzzy matching, no category/tier filtering.
4. **UI/UX is thin.** A flat list with one text input. No trust signals, no facets,
   no result ranking, no detail view worth the name.

## 2. Goal

Turn SkillMeUp into a production-quality discovery tool with:

- **Instant, comprehensive search** across the whole Claude Code skill/plugin ecosystem —
  no rate limits, no token required on the default path.
- **Trust without losing breadth** — curated `verified` entries plus auto-discovered
  `community` entries, filterable.
- **Workspace-aware suggestions** that GitHub search can never offer.
- **One-click, reproducible install** into `.claude/`.
- **A search-engine-grade UI** — ranked results, facets, badges, detail view.

### Non-goals

- No hosted server, database, or paid infrastructure. (GitHub Actions + Pages only.)
- No account system, telemetry backend, or auth. (Optional token stays optional and is
  only relevant to the advanced "add custom source" path.)
- No runtime crawling from the extension. Discovery happens centrally in CI.

## 3. Architecture Overview

Two halves connected by one static artifact:

```
                        ┌─────────────────────────────────────────┐
   GitHub Actions       │  crawler/  (runs nightly via cron)        │
   (this repo)          │  1. discover repos (seed list + GH search)│
                        │  2. parse SKILL.md / marketplace.json /   │
                        │     plugin.json (shared parser)           │
                        │  3. enrich (stars, topics, pinned SHA,    │
                        │     tier=verified|community, category)    │
                        │  4. emit index.json + meta.json           │
                        └───────────────┬───────────────────────────┘
                                        │ commit to gh-pages branch
                                        ▼
                        ┌─────────────────────────────────────────┐
   GitHub Pages CDN     │  https://<owner>.github.io/SkillMeUp/     │
                        │    index.json   (full catalog)            │
                        │    meta.json    (version + generatedAt)   │
                        └───────────────┬───────────────────────────┘
                                        │ single ETag-conditional GET
                                        ▼
   VSCode / Cursor      ┌─────────────────────────────────────────┐
   extension            │  IndexClient → TTLCache                   │
                        │  SearchEngine (client-side ranked fuzzy)  │
                        │  Recommender (workspace-aware, existing)  │
                        │  Webview (search-engine UX)               │
                        │  Installer (existing, SHA-pinned input)   │
                        │  CustomSourceProvider (advanced, opt-in,  │
                        │    reuses existing live fetchers)         │
                        └───────────────────────────────────────────┘
```

The key shift: **all GitHub API traffic moves from per-user runtime into one nightly CI
job.** Users fetch a single static JSON file from a CDN. No rate limits, no token, instant.

## 4. Components

### A. Index schema + crawler + CI publishing (foundation)

**A.1 Shared parser module (`src/shared/parse/`).** Extract the format-parsing logic that
currently lives inside `marketplaceFetcher.ts` and `util/yaml.ts` into a
dependency-light module importable by both the extension and the crawler. Pure functions:
`parseSkillFrontmatter(text)`, `parseMarketplaceJson(text)`, `parsePluginJson(text)`. No
`vscode` imports. This avoids two divergent copies of the parsing rules.

**A.2 Crawler (`crawler/`).** A standalone Node/TypeScript program (run by CI, not bundled
into the extension). Pipeline:

1. **Discover** candidate repos from three inputs:
   - `crawler/seeds.json` — curated, hand-maintained list of trusted repos/marketplaces.
     Every entry parsed from these is tagged `tier: "verified"`.
   - GitHub **code search** (`filename:SKILL.md`) and **topic search**
     (`topic:claude-skill`, `topic:claude-plugin`, `topic:claude-code`).
   - Repos linked from awesome-list seeds (reuse existing awesome-list extraction logic).
   - Everything found by search/awesome-list (and not in `seeds.json`) is tagged
     `tier: "community"`.
2. **Parse** each repo with the shared parser (marketplace.json, then scan `skills/` and
   `plugins/`, same precedence as today).
3. **Enrich** each entry with: `stars`, `topics`, `updatedAt`, `pinnedSha` (the commit SHA
   of the default branch HEAD at crawl time — used for reproducible installs),
   `category` (derived from topics/path heuristics; see A.4), and `tier`.
4. **Filter** out denylisted repos (`crawler/denylist.json`) and entries missing a usable
   `SKILL.md`/`plugin.json`.
5. **Emit** `dist/index.json` and `dist/meta.json`.

The crawler authenticates with a single PAT stored as a GitHub Actions secret
(`CRAWLER_GITHUB_TOKEN`) → 5,000 req/hr, ample for a nightly run over a few hundred repos.
The crawler is resilient: a single repo failing to parse logs a warning and is skipped;
it never aborts the whole run.

**A.3 Index format.**

`index.json`:
```jsonc
{
  "version": 1,
  "generatedAt": "2026-06-04T03:00:00Z",
  "stats": { "skills": 412, "plugins": 88, "repos": 137 },
  "entries": [
    {
      "kind": "skill",                       // "skill" | "plugin"
      "id": "owner/repo#name",
      "name": "systematic-debugging",
      "description": "…",
      "whenToUse": "…",                       // skills only
      "tier": "verified",                     // "verified" | "community"
      "category": "debugging",
      "tags": ["debugging", "testing"],
      "stars": 1820,
      "sourceRepo": "owner/repo",
      "sourceUrl": "https://github.com/owner/repo/tree/<sha>/path",
      "pathInRepo": "skills/systematic-debugging",
      "ref": "<pinnedSha>",                   // commit SHA, not branch — reproducible installs
      "updatedAt": "2026-05-30T…",
      "paths": ["**/*.ts"],                   // skill frontmatter globs (optional)
      "allowedTools": [],                     // skill (optional)
      "version": "1.2.0",                     // plugin (optional)
      "author": "…",                          // plugin (optional)
      "skills": [], "commands": [], "agents": []  // plugin (optional)
    }
  ]
}
```

`meta.json` (tiny, for cheap freshness checks):
```json
{ "version": 1, "generatedAt": "2026-06-04T03:00:00Z", "count": 500 }
```

The entry shape is a superset of the existing `CatalogItem` (`SkillMeta` | `PluginMeta`),
adding `tier`, `category`, `tags`, `stars`, `updatedAt`. The `Installer` consumes the same
`sourceRepo` / `pathInRepo` / `ref` fields it does today — with `ref` now a pinned SHA.

**A.4 Categorization.** Derive `category` from a small rule table mapping topics and path
keywords to a fixed set (`debugging`, `testing`, `frontend`, `data`, `docs`, `devops`,
`security`, `productivity`, `other`). Deterministic, no ML. Lives in `crawler/categorize.ts`.

**A.5 CI workflow (`.github/workflows/crawl.yml`).** Nightly `cron` + `workflow_dispatch`.
Steps: checkout → install → run crawler → write `dist/` → deploy `dist/` to the `gh-pages`
branch (using `peaceiris/actions-gh-pages` or equivalent). Result served at
`https://<owner>.github.io/SkillMeUp/index.json`.

### B. Extension index client (data layer swap)

**B.1 `IndexClient` (`src/index/indexClient.ts`).** Replaces `SourceRegistry` as the
default data source. Responsibilities:

- Fetch `meta.json` then `index.json` from the configured `skillmeup.indexUrl`
  (default: the Pages URL) using a conditional GET (`If-None-Match` with stored ETag).
- On `304 Not Modified`, serve the cached index. On `200`, parse, validate `version`, and
  store via the existing `TTLCache` (persisted in `globalState`) plus the ETag.
- Stale-while-revalidate behavior mirrors the current `SourceRegistry`: serve cached data
  instantly, refresh in the background, fire `onRefreshed`.
- Convert index entries into the in-memory `CatalogItem[]` the rest of the app already uses.
- **No GitHub API calls.** A single static file from a CDN.

**B.2 `CustomSourceProvider` (advanced, opt-in).** The existing live fetchers
(`marketplaceFetcher`, `awesomeListFetcher`, `githubUrlFetcher`, `githubSearch`) are
**retained but demoted**. They run only when the user explicitly adds a custom source URL
that is not in the index (the "Add source from GitHub URL" command). This is the *only*
path where `skillmeup.githubToken` is relevant. Rate-limit messaging is scoped to this
advanced path and never appears on the default experience.

**B.3 Config changes (`package.json`).**
- Add `skillmeup.indexUrl` (string, default = Pages URL).
- Keep `skillmeup.installScope`, `skillmeup.maxSuggestions`, `skillmeup.githubToken`,
  `skillmeup.cacheMinutes`.
- `skillmeup.sources` is retained only for user-added custom sources (default now empty,
  since the index replaces the hardcoded Anthropic entries).

### C. Search engine module (`src/search/searchEngine.ts`)

A self-contained, dependency-free ranked search over the in-memory catalog:

- **Tokenized fuzzy matching** with field weighting:
  `name` (highest) > `tags` / `whenToUse` > `description` > `category` > `sourceRepo`.
- **Scoring** combines match quality with light popularity boosting (`log(stars)`) and a
  small `verified`-tier boost, so trusted, relevant results rise to the top.
- **Filters** applied before/after scoring: `kind` (skill/plugin), `tier`
  (verified/community), `category`, `minStars`.
- Pure function: `search(catalog, query, filters) → RankedResult[]`. Synchronous, instant,
  runs on every keystroke (debounced lightly for rendering only, not for network).
- Unit-testable in isolation with no `vscode` or network dependency.

This replaces both the substring `filter` in `main.js` and the live `searchGitHubForSkills`
fallback for the default experience.

### D. Webview UX overhaul (`src/ui/webview/`)

Rework `panel.ts`, `media/main.js`, `media/main.css` into a real discovery surface:

- **Search bar** — prominent, instant results-as-you-type (powered by the local
  `SearchEngine`, so genuinely instant).
- **Filter chips** — All · Skills · Plugins · Verified · Community · category tags.
  Toggling re-runs the local search instantly.
- **Result rows** — name, kind badge, **tier badge** (✓ Verified / Community), ★ stars,
  source repo link, description, "when to use", category tags. Checkbox multi-select plus a
  per-row Install button.
- **Suggested section** — when the query is empty, pin the workspace-aware recommendations
  (`recommender.ts`, unchanged) at the top, then show the ranked full catalog below.
- **Detail expand** — expanding a row reveals full metadata and a link to the source;
  optional README preview (fetched lazily from raw CDN only on expand — never on list load).
- **States** — clean loading, empty (no results for query), and error states. The default
  path has no rate-limit messaging at all.
- **Footer** — running count + "Install N" action (existing multi-install flow, unchanged).

The message protocol between `panel.ts` and `main.js` gains `search`/`filter` message types
handled locally in the webview (no round-trip to the extension host needed for search,
since the full index is already in memory).

## 5. Data Flow

**Default load:**
1. Extension activates → `IndexClient.getCatalog()` → cached index served instantly (or
   fetched once if cold; single static GET).
2. `Recommender` scores entries against `workspaceScanner` signals → Suggested section.
3. Webview renders. User types → `SearchEngine.search()` runs locally, instantly.
4. User selects entries → `Installer.installMany()` downloads SHA-pinned folders into
   `.claude/` (existing mechanism).

**Nightly refresh (CI, invisible to users):**
1. Crawler discovers + parses + enriches → `index.json` + `meta.json`.
2. Deployed to `gh-pages`. Next time a user's TTL expires, the conditional GET picks up the
   new ETag and updates silently in the background.

**Advanced custom source (opt-in):**
1. User runs "Add source from GitHub URL" → `CustomSourceProvider` live-fetches via the
   existing fetchers → merged into the in-memory catalog for this session. Only here does
   the optional token matter.

## 6. Error Handling

- **Index fetch fails / offline:** serve last-good cached index from `globalState`; show a
  subtle "showing cached results" note. Never a hard failure on the default path.
- **Index `version` unknown/newer:** if the extension can read it, use it; if a future
  breaking version appears, fall back to cached data and prompt to update the extension.
- **Crawler partial failure:** per-repo errors are logged and skipped; the run still
  publishes a valid index. A run that produces zero entries does **not** overwrite the
  previous good index (CI guard).
- **Install failure:** unchanged — per-item `failed` status with message, surfaced in the
  webview and notifications.
- **Custom source rate limit:** the only place rate-limit messaging survives, scoped to the
  advanced path.

## 7. Testing

- **Shared parser:** unit tests over fixture `SKILL.md` / `marketplace.json` / `plugin.json`
  samples (valid, malformed, missing fields).
- **SearchEngine:** unit tests asserting ranking order, field weighting, tier boost, and
  each filter — pure functions, no mocks.
- **Crawler:** integration test against recorded GitHub API fixtures (no live calls in CI
  tests); assert the emitted `index.json` matches the schema and tiers are assigned
  correctly.
- **IndexClient:** tests for cold fetch, `304` cache hit, offline fallback, and version
  handling, using a stubbed fetch.
- **Manual smoke:** run the extension against a real published index; verify instant search,
  filters, install, and that no GitHub API call occurs on the default path.

## 8. Migration / Rollout

1. Land the shared parser refactor (no behavior change).
2. Build crawler + CI; publish a first index to `gh-pages`.
3. Add `IndexClient`, switch the default data source to the index, demote live fetchers to
   the custom-source path. Empty the hardcoded `skillmeup.sources` default.
4. Ship the new search engine + webview UX.
5. Verify end-to-end against the live index; demo.

## 9. Component / Phase Summary

| # | Component | Key files | Depends on |
|---|-----------|-----------|------------|
| A | Index schema + crawler + CI | `crawler/`, `src/shared/parse/`, `.github/workflows/crawl.yml` | — |
| B | Extension index client | `src/index/indexClient.ts`, `src/extension.ts`, `package.json` | A (index format) |
| C | Search engine | `src/search/searchEngine.ts` | B (catalog shape) |
| D | Webview UX | `src/ui/webview/panel.ts`, `media/main.js`, `media/main.css` | B, C |

`writing-plans` will sequence these into incremental, independently-shippable phases.
