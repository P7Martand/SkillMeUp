import { minimatch } from 'minimatch';
import * as vscode from 'vscode';
import { Catalog, CatalogItem, Recommendation, SkillMeta, PluginMeta } from '../sources/types';
import { WorkspaceSignals } from './workspaceScanner';

/**
 * Hand-curated dependency → skill-name-hint mapping. The hint is matched
 * case-insensitively against the skill/plugin name and description.
 */
const DEP_HINTS: Array<{ dep: string; hints: string[]; lang?: string }> = [
  { dep: '@anthropic-ai/sdk', hints: ['claude-api', 'anthropic', 'claude api'] },
  { dep: 'anthropic', hints: ['claude-api', 'anthropic', 'claude api'], lang: 'python' },
  { dep: '@anthropic-ai/claude-code', hints: ['claude-code', 'plugin'] },
  { dep: 'playwright', hints: ['webapp-testing', 'playwright', 'web testing'] },
  { dep: '@playwright/test', hints: ['webapp-testing', 'playwright', 'web testing'] },
  { dep: 'puppeteer', hints: ['webapp-testing', 'puppeteer'] },
  { dep: 'react', hints: ['react', 'frontend', 'jsx'] },
  { dep: 'next', hints: ['next.js', 'react', 'ssr'] },
  { dep: 'fastapi', hints: ['fastapi', 'api'] },
  { dep: 'flask', hints: ['flask', 'api'] },
  { dep: 'django', hints: ['django'] },
  { dep: 'pandas', hints: ['data', 'pandas', 'notebook'] },
  { dep: 'numpy', hints: ['data', 'numpy', 'notebook'] },
  { dep: 'jupyter', hints: ['notebook', 'jupyter'] },
  { dep: 'pypdf', hints: ['pdf'] },
  { dep: 'pdfkit', hints: ['pdf'] },
  { dep: 'pdf-lib', hints: ['pdf'] },
  { dep: 'reportlab', hints: ['pdf'] },
  { dep: 'docx', hints: ['docx', 'word'] },
  { dep: 'python-docx', hints: ['docx', 'word'] },
  { dep: 'openpyxl', hints: ['xlsx', 'excel', 'spreadsheet'] }
];

const FLAG_HINTS: Array<{ flag: keyof WorkspaceSignals['flags']; hints: string[]; reason: string }> = [
  { flag: 'hasNotebooks', hints: ['notebook', 'jupyter', 'ipynb'], reason: 'workspace contains .ipynb files' },
  { flag: 'hasPdf', hints: ['pdf'], reason: 'workspace contains .pdf files' },
  { flag: 'hasPlaywright', hints: ['playwright', 'webapp-testing', 'web testing'], reason: 'playwright.config detected' },
  { flag: 'hasDocker', hints: ['docker', 'dockerfile', 'container'], reason: 'Dockerfile or docker-compose detected' },
  { flag: 'hasGitHubActions', hints: ['github-actions', 'workflow', 'ci'], reason: '.github/workflows detected' }
];

export function recommend(catalog: Catalog, signals: WorkspaceSignals, max: number): Recommendation[] {
  const out: Recommendation[] = [];

  for (const item of [...catalog.skills, ...catalog.plugins] as CatalogItem[]) {
    const rec: Recommendation = { item, score: 0, reasons: [] };

    // 1. paths-glob match (skills only)
    if (item.kind === 'skill' && item.paths?.length) {
      const matched = matchGlobs(item.paths, signals.files);
      if (matched.length) {
        rec.score += Math.min(matched.length, 3) * 3;
        rec.reasons.push(`matches paths glob: ${matched.slice(0, 2).join(', ')}`);
      }
    }

    // 2. dependency hints
    const hay = `${item.name} ${item.description ?? ''}`.toLowerCase();
    for (const d of DEP_HINTS) {
      if (!signals.dependencies.has(d.dep.toLowerCase())) continue;
      if (d.hints.some((h) => hay.includes(h.toLowerCase()))) {
        rec.score += 5;
        rec.reasons.push(`dependency: ${d.dep}`);
        break;
      }
    }

    // 3. file/lang flags
    for (const f of FLAG_HINTS) {
      if (!signals.flags[f.flag]) continue;
      if (f.hints.some((h) => hay.includes(h.toLowerCase()))) {
        rec.score += 2;
        rec.reasons.push(f.reason);
        break;
      }
    }

    // 4. language match in name/description
    for (const lang of signals.languages) {
      if (hay.includes(lang)) {
        rec.score += 1;
        rec.reasons.push(`language: ${lang}`);
        break;
      }
    }

    // 5. README keyword overlap (small bonus, capped)
    if (signals.readme && item.description) {
      const desc = item.description.toLowerCase();
      const tokens = desc.split(/[\s,.()[\]/-]+/).filter((t) => t.length >= 5);
      let hits = 0;
      for (const t of tokens) {
        if (signals.readme.includes(t)) hits++;
        if (hits >= 3) break;
      }
      if (hits >= 2) {
        rec.score += 1;
        rec.reasons.push(`README mentions: ${tokens.filter((t) => signals.readme.includes(t)).slice(0, 2).join(', ')}`);
      }
    }

    if (rec.score > 0) out.push(rec);
  }

  out.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return out.slice(0, max);
}

function matchGlobs(globs: string[], files: string[]): string[] {
  const matched: string[] = [];
  for (const g of globs) {
    for (const f of files) {
      try {
        if (minimatch(f, g, { dot: true, matchBase: true })) {
          matched.push(g);
          break;
        }
      } catch {
        // ignore malformed glob
      }
    }
  }
  return matched;
}
