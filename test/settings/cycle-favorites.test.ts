import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, otherFavorites, sanitize } from '../../src/settings';

describe('cycle favorites', () => {
  it('is off by default, including in settings saved before it existed', () => {
    expect(sanitize({}).cycleFavorites).toBe(false);
  });

  it('stays on once turned on', () => {
    expect(sanitize(sanitize({ cycleFavorites: true })).cycleFavorites).toBe(true);
  });

  it('ignores anything that isn\'t a boolean', () => {
    expect(sanitize({ cycleFavorites: 'yes' as never }).cycleFavorites).toBe(false);
  });

  it('tries the other favorites in the source list\'s order from the current one', () => {
    const s = sanitize({ ...DEFAULT_SETTINGS, source: 'okx', favorites: ['kraken', 'okx', 'polymarket'] });
    expect(otherFavorites(s)).toEqual(['polymarket', 'kraken']);
  });
});
