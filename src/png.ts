import UPNG from 'upng-js';

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  png: Uint8Array;
}

/**
 * Slice a canvas into tiles and encode each as a 16-level greyscale indexed PNG.
 * The glasses display 4-bit grey, so quantizing here keeps the upload small and
 * means what the phone preview shows is what the glasses show.
 */
export function encodeTiles(canvas: HTMLCanvasElement, tileW: number, tileH: number): Tile[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const tiles: Tile[] = [];
  for (let y = 0; y < canvas.height; y += tileH) {
    for (let x = 0; x < canvas.width; x += tileW) {
      const img = ctx.getImageData(x, y, tileW, tileH);
      quantizeGray4(img.data);
      const png = new Uint8Array(UPNG.encode([img.data.buffer as ArrayBuffer], tileW, tileH, 16));
      tiles.push({ x, y, w: tileW, h: tileH, png });
    }
  }
  return tiles;
}

/** In place: RGBA -> opaque grey snapped to 16 levels. */
export function quantizeGray4(px: Uint8ClampedArray): void {
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    const v = Math.round(lum / 17) * 17;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
}
