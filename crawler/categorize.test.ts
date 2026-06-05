import { describe, it, expect } from 'vitest';
import { categorize } from './categorize';

describe('categorize', () => {
  it('maps debugging topics/names', () => {
    expect(categorize(['debugging'], 'skills/x', 'systematic-debugging')).toBe('debugging');
  });
  it('maps testing', () => {
    expect(categorize([], 'skills/test-runner', 'webapp-testing')).toBe('testing');
  });
  it('maps frontend', () => {
    expect(categorize(['react'], 'plugins/ui', 'frontend-design')).toBe('frontend');
  });
  it('maps security', () => {
    expect(categorize([], '', 'security-review')).toBe('security');
  });
  it('falls back to other', () => {
    expect(categorize([], 'skills/misc', 'a-random-skill')).toBe('other');
  });
  it('prioritizes the first matching category by table order', () => {
    // "test" appears before "frontend" cues here; debugging cue present too.
    expect(categorize(['debugging', 'react'], '', 'debug-react')).toBe('debugging');
  });
});
