import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitize } from '../../src/settings';

describe('default settings', () => {
  // With nothing saved the app runs on the defaults, and a change is spotted by
  // comparing them with the form's sanitized settings: any difference looked
  // like a new chart, so the first change of anything fetched and showed one.
  it('are what sanitize makes of them, field for field', () => {
    expect(JSON.stringify(sanitize(DEFAULT_SETTINGS))).toBe(JSON.stringify(DEFAULT_SETTINGS));
    expect(JSON.stringify(sanitize({}))).toBe(JSON.stringify(DEFAULT_SETTINGS));
  });
});
