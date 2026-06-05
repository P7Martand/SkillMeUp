import { describe, it, expect } from 'vitest';
import { parseMarketplaceJson, parsePluginJson, manifestPluginNames } from './manifest';

describe('parseMarketplaceJson', () => {
  it('returns plugin entries with normalized source paths', () => {
    const json = JSON.stringify({
      name: 'mp',
      plugins: [
        { name: 'a', source: './plugins/a', description: 'A' },
        { name: 'b', source: 'skills/b' }
      ]
    });
    const mp = parseMarketplaceJson(json);
    expect(mp).not.toBeNull();
    expect(mp!.plugins.map((p) => p.name)).toEqual(['a', 'b']);
    expect(mp!.plugins[0].source).toBe('plugins/a');
  });

  it('returns null on invalid JSON', () => {
    expect(parseMarketplaceJson('{ not json')).toBeNull();
  });
});

describe('parsePluginJson', () => {
  it('parses name/description/version', () => {
    const pj = parsePluginJson(JSON.stringify({ name: 'x', description: 'd', version: '1.0.0' }));
    expect(pj).toEqual({ name: 'x', description: 'd', version: '1.0.0', author: undefined, commands: undefined, agents: undefined, skills: undefined });
  });

  it('returns null on invalid JSON', () => {
    expect(parsePluginJson('nope')).toBeNull();
  });
});

describe('manifestPluginNames', () => {
  it('handles string arrays and object arrays', () => {
    expect(manifestPluginNames(['a', 'b'])).toEqual(['a', 'b']);
    expect(manifestPluginNames([{ name: 'a' }, { name: '' }])).toEqual(['a']);
    expect(manifestPluginNames(undefined)).toBeUndefined();
  });
});
