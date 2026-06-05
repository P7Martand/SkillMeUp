import { describe, it, expect } from 'vitest';
import { discover } from './discover';
import { GhClient } from './github';

function fakeClient(codeHits: string[], topicHits: string[]): GhClient {
  return {
    async getText() { return null; },
    async listDir() { return []; },
    async getRepoMeta() { return null; },
    async searchCode() { return codeHits.map((fullName) => ({ fullName })); },
    async searchReposByTopic() { return topicHits.map((fullName) => ({ fullName })); }
  };
}

describe('discover', () => {
  it('tags seed repos verified and search hits community', async () => {
    const client = fakeClient(['alice/skills-pack'], ['bob/claude-stuff']);
    const targets = await discover(client, { repos: ['anthropics/skills'] }, { repos: [] });
    const byName = Object.fromEntries(targets.map((t) => [`${t.owner}/${t.repo}`, t.tier]));
    expect(byName['anthropics/skills']).toBe('verified');
    expect(byName['alice/skills-pack']).toBe('community');
    expect(byName['bob/claude-stuff']).toBe('community');
  });

  it('excludes denylisted repos', async () => {
    const client = fakeClient(['spam/bad-repo'], []);
    const targets = await discover(client, { repos: [] }, { repos: ['spam/bad-repo'] });
    expect(targets.find((t) => t.repo === 'bad-repo')).toBeUndefined();
  });

  it('deduplicates: a repo in seeds stays verified even if also found by search', async () => {
    const client = fakeClient(['anthropics/skills'], []);
    const targets = await discover(client, { repos: ['anthropics/skills'] }, { repos: [] });
    const matches = targets.filter((t) => `${t.owner}/${t.repo}` === 'anthropics/skills');
    expect(matches).toHaveLength(1);
    expect(matches[0].tier).toBe('verified');
  });
});
