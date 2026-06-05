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
