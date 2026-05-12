import { fetchJson } from './githubFetcher';
import { log } from './logger';

export interface GitHubSkillResult {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  description: string;
  stars: number;
  topics: string[];
}

export class RateLimitError extends Error {
  constructor(msg = 'GitHub search rate limit reached — add a token in Settings › SkillMeUp › Github Token to unlock more searches.') {
    super(msg);
    this.name = 'RateLimitError';
  }
}

interface GHCodeItem {
  name: string;
  path: string;
  repository: {
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    owner: { login: string };
    name: string;
    topics?: string[];
  };
}

interface GHCodeSearchResult {
  total_count: number;
  incomplete_results: boolean;
  items: GHCodeItem[];
}

const MIN_INTERVAL_MS = 2500;
let lastSearchAt = 0;

export async function searchGitHubForSkills(query: string): Promise<GitHubSkillResult[]> {
  const now = Date.now();
  if (now - lastSearchAt < MIN_INTERVAL_MS) {
    throw new RateLimitError('Searching too quickly — wait a moment before trying again.');
  }
  lastSearchAt = now;

  const q = `filename:SKILL.md ${query}`;
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=8&sort=indexed`;
  log(`githubSearch: ${url}`);

  try {
    const data = await fetchJson<GHCodeSearchResult>(url);
    // Deduplicate by repo full name.
    const seen = new Set<string>();
    const results: GitHubSkillResult[] = [];
    for (const item of data.items) {
      const fn = item.repository.full_name;
      if (seen.has(fn)) continue;
      seen.add(fn);
      const [owner, repo] = fn.split('/');
      results.push({
        owner,
        repo,
        fullName: fn,
        url: item.repository.html_url,
        description: item.repository.description ?? '',
        stars: item.repository.stargazers_count,
        topics: item.repository.topics ?? [],
      });
    }
    return results;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('403') || msg.includes('429') || msg.includes('rate limit')) {
      throw new RateLimitError();
    }
    throw e;
  }
}
