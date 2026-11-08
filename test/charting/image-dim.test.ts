import { describe, expect, it } from 'vitest';
import { dimLevels, thinLevels } from '../../src/png';
import { sanitize } from '../../src/settings';

describe('image dimming', () => {
  it('leaves levels alone at 0%', () => {
    expect([...dimLevels(Uint8Array.from([0, 1, 8, 15]), 0)]).toEqual([0, 1, 8, 15]);
  });

  it('scales each lit level, keeping black black and lit pixels lit', () => {
    expect([...dimLevels(Uint8Array.from([0, 1, 2, 8, 15]), 20)]).toEqual([0, 1, 2, 6, 12]);
    expect([...dimLevels(Uint8Array.from([0, 1, 2, 8, 15]), 50)]).toEqual([0, 1, 1, 4, 8]);
    expect([...dimLevels(Uint8Array.from([0, 1, 2, 8, 15]), 100)]).toEqual([0, 1, 1, 1, 1]);
  });
});

describe('image thinning', () => {
  const lit = (w: number, h: number) => new Uint8Array(w * h).fill(15);
  const off = (levels: Uint8Array) => levels.filter((l) => l === 0).length;

  it('follows the 8×8 Bayer matrix', () => {
    // Each pixel's threshold, read back by thinning one step at a time.
    const at = new Array<number>(64).fill(-1);
    for (let cut = 1; cut <= 64; cut++) {
      const levels = thinLevels(lit(8, 8), 8, 0, 0, (cut / 64) * 100);
      levels.forEach((l, i) => { if (!l && at[i] === -1) at[i] = cut - 1; });
    }
    expect(at.slice(0, 8)).toEqual([0, 32, 8, 40, 2, 34, 10, 42]);
    expect(at.slice(8, 16)).toEqual([48, 16, 56, 24, 50, 18, 58, 26]);
    expect([...at].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it('turns off the asked share of lit pixels, and leaves black alone', () => {
    for (const p of [0, 10, 50, 90, 100]) expect(off(thinLevels(lit(64, 64), 64, 0, 0, p)) / 4096).toBeCloseTo(p / 100, 1);
    expect(off(thinLevels(new Uint8Array(64), 8, 0, 0, 50))).toBe(64);
  });

  it('is fixed to the screen, so neighbouring tiles meet without a seam', () => {
    const whole = thinLevels(lit(16, 8), 16, 0, 0, 40);
    const left = thinLevels(lit(8, 8), 8, 0, 0, 40);
    const right = thinLevels(lit(8, 8), 8, 8, 0, 40);
    for (let y = 0; y < 8; y++) {
      expect([...whole.subarray(y * 16, y * 16 + 16)]).toEqual([...left.subarray(y * 8, y * 8 + 8), ...right.subarray(y * 8, y * 8 + 8)]);
    }
  });
});

describe('image dimming and thinning settings', () => {
  it('take 0–90 in steps of 10', () => {
    expect(sanitize({ imageDim: 50, imageThin: 30 })).toMatchObject({ imageDim: 50, imageThin: 30 });
    expect(sanitize({ imageDim: 44, imageThin: 75 })).toMatchObject({ imageDim: 40, imageThin: 80 });
    expect(sanitize({ imageDim: 150, imageThin: -5 })).toMatchObject({ imageDim: 90, imageThin: 0 });
    expect(sanitize({ imageDim: 100, imageThin: 100 })).toMatchObject({ imageDim: 90, imageThin: 90 });
    expect(sanitize({ imageDim: 'x' as never })).toMatchObject({ imageDim: 0, imageThin: 0 });
  });
});
