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
