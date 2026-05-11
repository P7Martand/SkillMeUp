import { parseGitHubUrl, resolveDefaultBranch, tryFetchRaw, RepoRef } from '../util/githubFetcher';
import { Catalog, emptyCatalog } from './types';
import { fetchMarketplace } from './marketplaceFetcher';
import { log, logError } from '../util/logger';

/**
 * Parse README.md of an awesome-list style repo. We extract every GitHub URL
 * we find and treat each linked repo as a marketplace/repo source itself.
 */
export async function fetchAwesomeList(url: string): Promise<Catalog> {
  const out = emptyCatalog();
  const ref0 = parseGitHubUrl(url);
  if (!ref0) {
    out.errors.push({ source: url, message: 'Not a github.com URL' });
    return out;
  }
  const ref: RepoRef = {
    ...ref0,
    ref: ref0.ref === 'main' ? await resolveDefaultBranch(ref0) : ref0.ref
  };

  const readme = await tryFetchRaw(ref, 'README.md');
  if (!readme) {
    out.errors.push({ source: url, message: 'README.md not found' });
    return out;
  }

  const repos = extractGithubRepos(readme);
  log(`awesome-list ${url}: ${repos.size} candidate repos`);

  // Cap aggressively to avoid GitHub's 60-req/hour unauthenticated limit.
  const limited = [...repos].slice(0, 8);
  for (const repoUrl of limited) {
    try {
      const sub = await fetchMarketplace(repoUrl);
      out.skills.push(...sub.skills);
      out.plugins.push(...sub.plugins);
      out.errors.push(...sub.errors);
    } catch (e) {
      logError(`awesome-list entry ${repoUrl}`, e);
      out.errors.push({ source: repoUrl, message: (e as Error).message });
      // If we hit a rate limit, stop iterating — every following call will fail too.
      if (/rate limit/i.test((e as Error).message)) {
        out.errors.push({ source: url, message: 'GitHub rate-limit hit; set skillmeup.githubToken to fetch more.' });
        break;
      }
    }
  }
  return out;
}

function extractGithubRepos(md: string): Set<string> {
  const set = new Set<string>();
  const re = /https?:\/\/github\.com\/([^\s)\]\/]+)\/([^\s)\]#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, '');
    // Skip non-repo links (gists, sponsors, settings, the org itself, etc.)
    if (!repo || repo === 'sponsors' || owner === 'sponsors') continue;
    if (/^(orgs|users|settings|topics|features|marketplace|sponsors|enterprise)$/i.test(owner)) continue;
    set.add(`https://github.com/${owner}/${repo}`);
  }
  return set;
}
