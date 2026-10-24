// Writes assets/icon-24.png from assets/icon.svg (24x24, whole-pixel rects) for
// the Even Hub store listing, which validates it on upload: 1-bit, every pixel
// #f4f4f4 at full opacity or fully transparent, and every lit pixel part of a
// 2x2 block of lit pixels. Stored as greyscale with alpha. Run with
// `npm run icon`.
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const SIZE = 24;
const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)]
  .map(([, x, y, w, h]) => ({ x: +x, y: +y, w: +w, h: +h }));
if (!svg.includes(`viewBox="0 0 ${SIZE} ${SIZE}"`) || !rects.length) {
  throw new Error(`assets/icon.svg needs viewBox="0 0 ${SIZE} ${SIZE}" and pixel rects`);
}
const lit = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE
  && rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

// The upload rejects any lit pixel that no 2x2 block of lit pixels covers.
const block = (x, y) => lit(x, y) && lit(x + 1, y) && lit(x, y + 1) && lit(x + 1, y + 1);
const loose = [];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (lit(x, y) && !(block(x - 1, y - 1) || block(x, y - 1) || block(x - 1, y) || block(x, y))) loose.push(`${x},${y}`);
  }
}
if (loose.length) throw new Error(`Lit pixels outside any 2x2 block: ${loose.join(' ')}`);

// Grey + alpha rows, each led by filter type 0 (none).
const row = 1 + SIZE * 2;
const raw = Buffer.alloc(row * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (lit(x, y)) raw.set([0xf4, 0xff], y * row + 1 + x * 2);
  }
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 4; // greyscale with alpha
writeFileSync(new URL('../assets/icon-24.png', import.meta.url), Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]));
