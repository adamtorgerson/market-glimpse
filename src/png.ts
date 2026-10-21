import { deflate } from 'pako';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile extends Rect {
  png: Uint8Array;
}

/** Smallest image container the glasses accept, in each dimension. */
const MIN_SIDE = 20;

/**
 * Slice a canvas into tiles of up to `tileW`×`tileH`, each encoded as a
 * 16-level greyscale PNG. The glasses display 4-bit grey, so quantizing here
 * keeps the upload small.
 *
 * Each tile is cropped to the part that isn't black, since every pixel sent
 * costs decoding on the phone and Bluetooth time, and an all-black tile is
 * left out. Black needs no image: the screen is black where nothing is drawn.
 * `cover` lists areas that must be drawn over even if black (e.g. the loading
 * text, which should be covered by the chart).
 */
export function encodeTiles(canvas: HTMLCanvasElement, tileW: number, tileH: number, cover: Rect[] = []): Tile[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const tiles: Tile[] = [];
  for (let y = 0; y < canvas.height; y += tileH) {
    for (let x = 0; x < canvas.width; x += tileW) {
      const levels = gray4Levels(ctx.getImageData(x, y, tileW, tileH).data);
      const covered = cover.map((r) => ({ x: r.x - x, y: r.y - y, w: r.w, h: r.h }));
      const box = contentBox(levels, tileW, tileH, covered);
      if (!box) continue;
      const png = encodePng4(crop(levels, tileW, box), box.w, box.h);
      tiles.push({ x: x + box.x, y: y + box.y, w: box.w, h: box.h, png });
    }
  }
  return tiles;
}

/** RGBA -> one grey level (0–15) per pixel. */
export function gray4Levels(px: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(px.length / 4);
  for (let i = 0; i < out.length; i++) {
    const lum = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!;
    out[i] = Math.round(lum / 17);
  }
  return out;
}

/**
 * Bounding box of the non-black pixels and the `cover` areas within a w×h
 * tile, grown to the minimum container size; null if there's nothing to draw.
 */
function contentBox(levels: Uint8Array, w: number, h: number, cover: Rect[]): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!levels[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  for (const r of cover) {
    const rx0 = Math.max(0, r.x), ry0 = Math.max(0, r.y);
    const rx1 = Math.min(w, r.x + r.w) - 1, ry1 = Math.min(h, r.y + r.h) - 1;
    if (rx0 > rx1 || ry0 > ry1) continue;
    x0 = Math.min(x0, rx0);
    y0 = Math.min(y0, ry0);
    x1 = Math.max(x1, rx1);
    y1 = Math.max(y1, ry1);
  }
  if (x1 < 0) return null;
  const [bx, bw] = grow(x0, x1 - x0 + 1, w);
  const [by, bh] = grow(y0, y1 - y0 + 1, h);
  return { x: bx, y: by, w: bw, h: bh };
}

/** Widen [start, start+len) to at least MIN_SIDE, staying within [0, max). */
function grow(start: number, len: number, max: number): [number, number] {
  if (len >= MIN_SIDE) return [start, len];
  len = Math.min(MIN_SIDE, max);
  return [Math.max(0, Math.min(start, max - len)), len];
}

function crop(levels: Uint8Array, stride: number, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const from = (r.y + y) * stride + r.x;
    out.set(levels.subarray(from, from + r.w), y * r.w);
  }
  return out;
}

// ── PNG ─────────────────────────────────────────────────────────────────

/**
 * Encode grey levels (0–15, one per pixel) as a 4-bit indexed PNG with a
 * 16-grey palette. Rows are unfiltered, which suits palette images, and
 * deflated at `level` (0 = stored uncompressed, for the speed test).
 */
export function encodePng4(levels: Uint8Array, w: number, h: number, level: 0 | 9 = 9): Uint8Array {
  const rowBytes = Math.ceil(w / 2);
  const raw = new Uint8Array(h * (rowBytes + 1));
  for (let y = 0; y < h; y++) {
    const row = y * (rowBytes + 1); // raw[row] = 0: filter type None
    for (let x = 0; x < w; x++) {
      raw[row + 1 + (x >> 1)]! |= levels[y * w + x]! << (x & 1 ? 0 : 4);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([4, 3, 0, 0, 0], 8); // bit depth 4, colour type 3 (indexed), deflate, no filter, no interlace
  const plte = new Uint8Array(16 * 3);
  for (let i = 0; i < 16; i++) plte.fill(i * 17, i * 3, i * 3 + 3);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflate(raw, { level })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Speed-test images and transport ─────────────────────────────────────

/** Random grey levels, which no compressor can shrink. */
export function noiseLevels(w: number, h: number): Uint8Array {
  return Uint8Array.from({ length: w * h }, () => Math.floor(Math.random() * 16));
}

/** Two pixels per byte, first pixel in the high nibble. */
export function packGray4(levels: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(levels.length / 2));
  for (let i = 0; i < levels.length; i++) out[i >> 1]! |= levels[i]! << (i & 1 ? 0 : 4);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
