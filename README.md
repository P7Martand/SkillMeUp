# SkillMeUp

> Discover Claude Code skills and plugins that match your codebase, pick the ones you want with checkboxes, and install them straight into your project — minimalistic, IDE-native, works in both VSCode and Cursor.

## Why

[Claude Code](https://claude.com/claude-code) gets dramatically better with **skills** — small folders of YAML + markdown instructions that teach Claude how to handle specific tasks (writing PDFs, testing webapps, calling the Anthropic API, etc.). The ecosystem is real: there are community-maintained skill catalogs and plugin collections available on GitHub, and the list keeps growing.

But adopting them is manual:

- Find the right repo on GitHub.
- Clone it, copy the `SKILL.md` folder into `.claude/skills/`, commit.
- Repeat for every skill.
- Rediscover the same hunt for every new project.

**SkillMeUp does the discovery, matches skills to *your* codebase, and installs them with a click.**

## What it does

- **Fetches catalogs** from configurable sources: defaults are [`anthropics/skills`](https://github.com/anthropics/skills) and [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official). Pluggable — paste any GitHub URL.
- **Scans your workspace** for signals: file globs, `package.json` / `pyproject.toml` / `requirements.txt` dependencies, languages, the presence of telltale files (`*.ipynb`, `*.pdf`, `playwright.config.*`, `Dockerfile`, `.github/workflows/`).
- **Recommends** the most relevant skills/plugins, scored using the skill's own `paths` frontmatter globs (×3 weight), dependency matches (×5), file-type flags (×2), language and README keyword overlap.
- **Multi-select install** via a clean native panel. Pre-checks the suggested items, lets you tick anything extra, writes to `<workspace>/.claude/skills/` or `<workspace>/.claude/plugins/`.
- **Per-item overwrite/skip prompts** if a skill folder already exists, with "Overwrite all" / "Skip all" shortcuts.

## Install

### From `.vsix` (VSCode or Cursor)

```bash
# VSCode
code --install-extension skillmeup-0.1.0.vsix

# Cursor (same file, same command)
cursor --install-extension skillmeup-0.1.0.vsix
```

Or in the editor UI: `⌘⇧P` → **Extensions: Install from VSIX…** → pick the file.

Then reload the window. You'll see a startup toast — click **Open SkillMeUp** to focus the view, or click the stacked-card icon in the Activity Bar.

### From source

```bash
git clone <this-repo>
cd skillmeup
npm install
npm run compile
# Press F5 in VSCode to launch an Extension Development Host
```

## Usage

1. Click the **SkillMeUp** icon in the Activity Bar.
2. Hit **Refresh Catalog** (↻ in the view title) to fetch sources for the first time.
3. Browse the tree:
   - **Suggested** — top matches for *this* workspace, with reason tags (`dependency: @anthropic-ai/sdk`, `matches glob *.pdf`, etc.)
   - **All Skills** / **All Plugins** — the full catalog
   - **Sources** — your configured sources
4. Click **Install Skills…** (cloud-download icon in the view title) to open the multi-select panel.
5. Tick what you want, click **Install N**. Files appear in `<workspace>/.claude/skills/<name>/`.

## Commands

| Command | What it does |
|---|---|
| `SkillMeUp: Refresh Catalog` | Re-fetch every configured source (bypasses cache) |
| `SkillMeUp: Install Skills…` | Open the multi-select install panel |
| `SkillMeUp: Add Source from GitHub URL…` | Add a custom catalog source — paste any GitHub repo |

## Settings

| Key | Default | Description |
|---|---|---|
| `skillmeup.sources` | official Anthropic skills + plugins repos | List of `{ url, kind }` source entries. `kind` is `marketplace`, `awesome-list`, or `repo`. |
| `skillmeup.installScope` | `project` | Where to install. `project` = `<workspace>/.claude/`; `user` = `~/.claude/`. |
| `skillmeup.cacheMinutes` | `60` | How long to cache fetched catalogs. |
| `skillmeup.githubToken` | `""` | Optional GitHub PAT to raise the API rate limit from 60/hour to 5,000/hour. Read-only public-repo access is sufficient — no scopes needed. |
| `skillmeup.maxSuggestions` | `10` | Cap on the Suggested list. |

## Skills vs Plugins — important nuance

**Skills work out of the box.** Claude Code reads `<workspace>/.claude/skills/<name>/SKILL.md` automatically — install via SkillMeUp and the skill is live next time Claude Code starts in that workspace.

**Plugins are not auto-registered.** Claude Code's plugin system uses a registry (`/plugin install …`). Dropping a plugin folder into `.claude/plugins/` puts the files on disk but doesn't register the plugin with Claude Code. For now, plugin installs are best treated as a way to *download and inspect* a plugin's contents — to enable a plugin's skills today, install them as skills instead.

## Sources

The default catalog fetches from:

- [`anthropics/skills`](https://github.com/anthropics/skills) — skills catalog
- [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) — plugin catalog

You can add more:

- `marketplace` — a repo with `.claude-plugin/marketplace.json` at the root
- `awesome-list` — a README-style index of links (e.g. `travisvn/awesome-claude-skills`)
- `repo` — auto-detect any GitHub repo (single skill / plugin / marketplace)

Edit `skillmeup.sources` in settings, or use **SkillMeUp: Add Source from GitHub URL…**.

## How the recommendation engine works

For each catalog item, SkillMeUp scores it against your workspace:

| Signal | Weight |
|---|---|
| Skill's `paths` frontmatter glob matches a file in the workspace | **+3** per match, capped |
| Workspace `package.json` / `pyproject.toml` dependency matches a known mapping (e.g. `@anthropic-ai/sdk` → `claude-api`) | **+5** |
| Telltale file present and matches description (`*.pdf` + skill named `pdf`, `playwright.config.*` + `webapp-testing`, etc.) | **+2** |
| Language present (TypeScript, Python, Go, Rust, …) appears in skill name/description | **+1** |
| README keyword overlap with skill description | **+1** (capped at +1 total) |

Top-N items with `score > 0` show up under **Suggested**, with the reasons shown as tags.

## Troubleshooting

**Activity Bar icon is missing.** It's probably in the **…** overflow at the bottom of the Activity Bar — drag it out, or right-click the bar and tick **SkillMeUp**. The startup toast's **Open SkillMeUp** button also works.

**`403 rate limit exceeded`.** GitHub's anonymous API limit is 60 req/hour. SkillMeUp uses the recursive git-tree endpoint to install entire folders in a single call, so this should be rare. If you hit it, either wait for the reset (`curl -s https://api.github.com/rate_limit`) or set `skillmeup.githubToken` — any GitHub PAT (no scopes needed for public repos) raises the limit to 5,000/hr.

**Nothing in the Suggested list.** Make sure you're in a workspace with a real `package.json`/`pyproject.toml`/code files. The signals come from analyzing those. Also confirm the catalog actually loaded — the **SkillMeUp** Output channel logs what was fetched and why each scored.

**Want logs.** View → Output → pick **"SkillMeUp"** from the dropdown.

## Development

```bash
npm install
npm run watch     # esbuild in watch mode
# F5 in VSCode → Extension Development Host launches with samples/test-workspace/ open
```

The dev workspace has `@anthropic-ai/sdk` + `@playwright/test` in `package.json` and a sample `.pdf` + `.ipynb` so you can see the recommender fire.

To repackage the `.vsix`:

```bash
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

## License

MIT. SkillMeUp is an unofficial tool and is not affiliated with Anthropic.
