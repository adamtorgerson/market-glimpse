import { describe, expect, it } from 'vitest';
import { sanitize } from '../../src/settings';

describe('gesture controls', () => {
  it('are on by default, including in settings saved before they existed', () => {
    expect(sanitize({}).gestures).toBe(true);
  });

  it('keep being off once turned off', () => {
    expect(sanitize({ gestures: false }).gestures).toBe(false);
    expect(sanitize(sanitize({ gestures: false })).gestures).toBe(false);
  });

  it('ignore anything that isn\'t a boolean', () => {
    expect(sanitize({ gestures: 'no' as never }).gestures).toBe(true);
  });
});
