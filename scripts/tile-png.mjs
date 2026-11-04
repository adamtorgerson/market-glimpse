// Tiles same-sized PNGs into one, keeping transparency: the gaps, and whatever
// is left of the last row, are transparent. For the 8-bit RGBA, non-interlaced
// PNGs the simulator writes; anything else is refused.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BYTES = 4;

function decode(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
  let width = 0, height = 0;
  const data = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8), body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('Only 8-bit RGBA, non-interlaced PNGs can be tiled');
    } else if (type === 'IDAT') {
      data.push(body);
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * BYTES;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], from = y * (stride + 1) + 1, to = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= BYTES ? pixels[to + x - BYTES] : 0;
      const b = y > 0 ? pixels[to + x - stride] : 0;
      const c = x >= BYTES && y > 0 ? pixels[to + x - stride - BYTES] : 0;
      const value = raw[from + x];
      if (filter === 0) pixels[to + x] = value;
      else if (filter === 1) pixels[to + x] = value + a;
      else if (filter === 2) pixels[to + x] = value + b;
      else if (filter === 3) pixels[to + x] = value + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pixels[to + x] = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`Unknown PNG filter ${filter}`);
    }
  }
  return { width, height, pixels };
}

function encode(width, height, pixels) {
  const stride = width * BYTES;
  const raw = Buffer.alloc((stride + 1) * height); // Each row's filter byte stays 0: none.
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** The PNGs left to right and top to bottom, `columns` to a row, `gap` pixels apart. */
export function tilePngs(pngs, { columns, gap }) {
  const tiles = pngs.map(decode);
  const { width, height } = tiles[0];
  if (tiles.some((t) => t.width !== width || t.height !== height)) throw new Error('PNGs to tile must be the same size');
  const across = Math.min(columns, tiles.length), rows = Math.ceil(tiles.length / columns);
  const outW = across * width + (across - 1) * gap, outH = rows * height + (rows - 1) * gap;
  const pixels = Buffer.alloc(outW * outH * BYTES); // All transparent.
  tiles.forEach((tile, i) => {
    const left = (i % columns) * (width + gap), top = Math.floor(i / columns) * (height + gap);
    for (let y = 0; y < height; y++) {
      tile.pixels.copy(pixels, ((top + y) * outW + left) * BYTES, y * width * BYTES, (y + 1) * width * BYTES);
    }
  });
  return encode(outW, outH, pixels);
}
