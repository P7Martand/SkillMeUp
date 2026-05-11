import { parseGitHubUrl, resolveDefaultBranch, tryFetchRaw, RepoRef } from '../util/githubFetcher';
import { Catalog, emptyCatalog } from './types';
import { fetchMarketplace } from './marketplaceFetcher';
import { log } from '../util/logger';

/**
 * Detect what kind of source a bare GitHub URL is and fetch accordingly.
 * - has SKILL.md at root → single skill (treat as repo with one skill)
 * - has plugin.json at root → single plugin
 * - otherwise → treat as marketplace (will scan skills/ and plugins/ folders)
 */
export async function fetchGenericRepo(url: string): Promise<Catalog> {
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

  const hasSkill = !!(await tryFetchRaw(ref, 'SKILL.md'));
  const hasPlugin =
    !!(await tryFetchRaw(ref, 'plugin.json')) ||
    !!(await tryFetchRaw(ref, '.claude-plugin/plugin.json'));

  log(`generic ${ref.owner}/${ref.repo}: skill=${hasSkill} plugin=${hasPlugin}`);

  // marketplaceFetcher already handles all three shapes — let it do the work.
  return fetchMarketplace(url);
}
