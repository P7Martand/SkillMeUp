import * as vscode from 'vscode';
import { log, logError } from './logger';

export interface RepoRef {
  owner: string;
  repo: string;
  ref: string; // branch / tag / sha
}

export interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  sha: string;
  size: number;
  download_url: string | null;
}

const GH_API = 'https://api.github.com';
const GH_RAW = 'https://raw.githubusercontent.com';

function token(): string {
  return vscode.workspace.getConfiguration('skillmeup').get<string>('githubToken', '').trim();
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SkillMeUp-VSCode'
  };
  const t = token();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export function parseGitHubUrl(url: string): RepoRef | null {
  try {
    const u = new URL(url);
    if (!/github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    let ref = 'main';
    // /owner/repo/tree/<ref>/...
    if (parts[2] === 'tree' && parts[3]) ref = parts[3];
    return { owner, repo: repo.replace(/\.git$/, ''), ref };
  } catch {
    return null;
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${r.statusText}`);
  return await r.text();
}

export async function fetchRaw(repo: RepoRef, pathInRepo: string): Promise<string> {
  const url = `${GH_RAW}/${repo.owner}/${repo.repo}/${repo.ref}/${pathInRepo}`;
  return fetchText(url);
}

export async function tryFetchRaw(repo: RepoRef, pathInRepo: string): Promise<string | null> {
  try {
    return await fetchRaw(repo, pathInRepo);
  } catch (e) {
    log(`tryFetchRaw miss ${pathInRepo}`);
    return null;
  }
}

export async function listContents(repo: RepoRef, pathInRepo: string): Promise<GitHubContentItem[]> {
  const url = `${GH_API}/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(pathInRepo).replace(/%2F/g, '/')}?ref=${encodeURIComponent(repo.ref)}`;
  const json = await fetchJson<GitHubContentItem | GitHubContentItem[]>(url);
  return Array.isArray(json) ? json : [json];
}

export async function resolveDefaultBranch(repo: { owner: string; repo: string }): Promise<string> {
  // Skip the API hit when there's no token — it burns 1 of 60 unauth requests
  // per repo just to learn the branch name. We probe main → master via raw URLs
  // in the fetchers, which is cheaper.
  if (!token()) return 'main';
  try {
    const r = await fetchJson<{ default_branch: string }>(`${GH_API}/repos/${repo.owner}/${repo.repo}`);
    return r.default_branch || 'main';
  } catch (e) {
    logError(`resolveDefaultBranch ${repo.owner}/${repo.repo}`, e);
    return 'main';
  }
}

/** Recursively walk a directory and return every file path under it. */
export async function walkDirectory(repo: RepoRef, pathInRepo: string): Promise<GitHubContentItem[]> {
  const out: GitHubContentItem[] = [];
  const stack = [pathInRepo];
  while (stack.length) {
    const cur = stack.pop()!;
    const items = await listContents(repo, cur);
    for (const it of items) {
      if (it.type === 'file') out.push(it);
      else if (it.type === 'dir') stack.push(it.path);
    }
  }
  return out;
}

export async function downloadFile(item: GitHubContentItem): Promise<Buffer> {
  if (!item.download_url) throw new Error(`No download_url for ${item.path}`);
  const r = await fetch(item.download_url, { headers: { 'User-Agent': 'SkillMeUp-VSCode' } });
  if (!r.ok) throw new Error(`GET ${item.download_url} → ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
  sha: string;
}

interface TreeResponse {
  sha: string;
  url: string;
  tree: TreeEntry[];
  truncated: boolean;
}

/**
 * Single API call → full recursive tree. Costs 1 hit against the 60/hr
 * unauth budget regardless of repo depth, vs. one hit per directory with
 * the contents endpoint.
 */
export async function getRepoTreeRecursive(repo: RepoRef): Promise<TreeResponse> {
  const url = `${GH_API}/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(repo.ref)}?recursive=1`;
  return fetchJson<TreeResponse>(url);
}

/** Raw URL download — doesn't count against the api.github.com rate limit. */
export async function downloadRaw(repo: RepoRef, pathInRepo: string): Promise<Buffer> {
  const url = `${GH_RAW}/${repo.owner}/${repo.repo}/${repo.ref}/${pathInRepo}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'SkillMeUp-VSCode' } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}
