import { describe, expect, it } from 'vitest';
import { ALL_SOURCE_IDS, DEFAULT_SETTINGS, nextFavorite, sanitize } from '../src/settings';

describe('favorites', () => {
  const s = (source: string, favorites: string[]) => sanitize({ ...DEFAULT_SETTINGS, source, favorites });

  it('keeps known sources, in the source list order', () => {
    expect(s('kraken', ['polymarket', 'nope', 'okx', 'okx']).favorites).toEqual(['okx', 'polymarket']);
    expect(sanitize({ favorites: 'okx' as never }).favorites).toEqual([]);
  });

  it('goes on to the next favorite after the source, wrapping', () => {
    expect(nextFavorite(s('kraken', ['okx', 'polymarket']))).toBe('okx');
    expect(nextFavorite(s('okx', ['okx', 'polymarket']))).toBe('polymarket');
    expect(nextFavorite(s('polymarket', ['okx', 'polymarket']))).toBe('okx');
    // From a source that isn't a favorite, the next one after it.
    expect(nextFavorite(s(ALL_SOURCE_IDS.at(-1)!, ['okx', 'polymarket']))).toBe('okx');
  });

  it('has none without another favorite', () => {
    expect(nextFavorite(s('kraken', []))).toBeNull();
    expect(nextFavorite(s('kraken', ['kraken']))).toBeNull();
  });
});
