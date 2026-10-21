import type { Glasses } from './glasses';
import { encodePng4, noiseLevels, packGray4 } from './png';

export interface SpeedResult {
  label: string;
  bytes: number;
  /** Median of the successful uploads; null if all were rejected. */
  ms: number | null;
  ok: number;
  tries: number;
}

const W = 288;
const H = 144;
const REPS = 3;

/**
 * Time image uploads that differ in one thing at a time, to find what an
 * upload's time depends on:
 *  - black vs uncompressed black PNG: PNG bytes over the WebView bridge (the
 *    image the phone sends on is the same)
 *  - uncompressed black vs noise PNG: about the same PNG size, but noise
 *    can't be compressed for Bluetooth (the phone LZ4s the image)
 *  - noise vs noise as a byte array: base64 vs a list of numbers on the bridge
 *  - noise vs quarter-size noise: pixel count
 *  - noise PNG vs raw packed 4-bit noise: decoding the PNG on the phone
 *    (raw data may be rejected by older hosts)
 */
export async function runSpeedTest(glasses: Glasses, progress: (done: number, total: number) => void): Promise<SpeedResult[]> {
  const black = new Uint8Array(W * H);
  const noise = noiseLevels(W, H);
  const cases: { label: string; container: 0 | 1; data: Uint8Array; base64: boolean }[] = [
    { label: 'Black PNG', container: 0, data: encodePng4(black, W, H), base64: true },
    { label: 'Black PNG, uncompressed', container: 0, data: encodePng4(black, W, H, 0), base64: true },
    { label: 'Noise PNG', container: 0, data: encodePng4(noise, W, H), base64: true },
    { label: 'Noise PNG, byte array', container: 0, data: encodePng4(noise, W, H), base64: false },
    { label: 'Noise PNG, ¼ size', container: 1, data: encodePng4(noiseLevels(W / 2, H / 2), W / 2, H / 2), base64: true },
    { label: 'Noise, raw 4-bit', container: 0, data: packGray4(noise), base64: true },
  ];
  return glasses.exclusive(async () => {
    await glasses.imagePage([{ x: 0, y: 0, w: W, h: H }, { x: W, y: 0, w: W / 2, h: H / 2 }]);
    const results: SpeedResult[] = [];
    // Round-robin, so a slow patch on the Bluetooth link doesn't land on one case.
    const times: number[][] = cases.map(() => []);
    for (let rep = 0; rep < REPS; rep++) {
      for (const [i, c] of cases.entries()) {
        progress(rep * cases.length + i, REPS * cases.length);
        const { ms, ok } = await glasses.timeUpload(c.container, c.data, c.base64);
        if (ok) times[i]!.push(ms);
      }
    }
    for (const [i, c] of cases.entries()) {
      const t = times[i]!.sort((a, b) => a - b);
      results.push({ label: c.label, bytes: c.data.length, ms: t.length ? t[Math.floor(t.length / 2)]! : null, ok: t.length, tries: REPS });
    }
    return results;
  });
}
