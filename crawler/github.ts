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
