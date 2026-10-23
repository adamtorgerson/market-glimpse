import type { ChartFont } from './settings';

interface FontSpec {
  label: string;
  family: string;
  /** Regular and bold files in public/fonts, each with its license beside it. */
  regular: string;
  bold: string;
  /** Height of its digits, in em; a first guess at the size that matches Atkinson. */
  digitH: number;
}

export const FONTS: Record<ChartFont, FontSpec> = {
  atkinson: { label: 'Atkinson Hyperlegible', family: 'Atkinson Hyperlegible', regular: 'AtkinsonHyperlegible-Regular.woff2', bold: 'AtkinsonHyperlegible-Bold.woff2', digitH: 0.68 },
  b612: { label: 'B612', family: 'B612', regular: 'B612-Regular.woff2', bold: 'B612-Bold.woff2', digitH: 0.7585 },
  'dejavu-mono': { label: 'DejaVu Sans Mono', family: 'DejaVu Sans Mono', regular: 'DejaVuSansMono.woff2', bold: 'DejaVuSansMono-Bold.woff2', digitH: 0.7422 },
  hack: { label: 'Hack', family: 'Hack', regular: 'Hack-Regular.woff2', bold: 'Hack-Bold.woff2', digitH: 0.7422 },
  // Shipped unmodified: its license reserves the name for unchanged files.
  terminus: { label: 'Terminus', family: 'Terminus (TTF)', regular: 'TerminusTTF-4.49.3.ttf', bold: 'TerminusTTF-Bold-4.49.3.ttf', digitH: 0.646 },
};

const loading = new Map<ChartFont, Promise<void>>();

/**
 * Loads a font's regular and bold faces once, and Atkinson's, which sizes are
 * matched to. Charts measure text, so draw only after this resolves.
 */
export function loadFont(id: ChartFont): Promise<void> {
  if (id !== 'atkinson') return Promise.all([loadFace(id), loadFace('atkinson')]).then(() => undefined);
  return loadFace(id);
}

function loadFace(id: ChartFont): Promise<void> {
  let p = loading.get(id);
  if (!p) {
    const f = FONTS[id];
    p = Promise.all([['400', f.regular], ['700', f.bold]].map(async ([weight, file]) => {
      const face = new FontFace(f.family, `url(fonts/${file})`, { weight });
      document.fonts.add(await face.load());
    })).then(() => { sizes.clear(); inks.clear(); });
    // A failed load is retried on the next update rather than cached.
    p.catch(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

/** Atkinson is drawn this much larger than the size asked for, for digits as tall as SF Pro's and Roboto's (0.71 em). */
const ATKINSON_SCALE = 0.71 / FONTS.atkinson.digitH;

const sizes = new Map<string, number>();

/**
 * Canvas font string for `px` (in SF Pro / Roboto terms) in `id`. Other fonts
 * get the whole-pixel size whose digits come out as many pixels tall as
 * Atkinson's, measured as the WebView draws them: hinting, rounding and
 * Terminus's built-in bitmaps make each size differ from its outline.
 */
export function cssFont(id: ChartFont, px: number, bold = false): string {
  const key = `${id} ${px} ${bold}`;
  let size = sizes.get(key);
  if (size === undefined) {
    const atkinson = px * ATKINSON_SCALE;
    if (id === 'atkinson') {
      size = atkinson;
    } else {
      const target = inkHeight(fontString('atkinson', atkinson, bold));
      const guess = atkinson * FONTS.atkinson.digitH / FONTS[id].digitH;
      const candidates = [-2, -1, 0, 1, 2].map((d) => Math.round(guess) + d).filter((s) => s > 0);
      const miss = (s: number) => Math.abs(inkHeight(fontString(id, s, bold)) - target);
      size = candidates.reduce((best, s) =>
        miss(s) < miss(best) || (miss(s) === miss(best) && Math.abs(s - guess) < Math.abs(best - guess)) ? s : best);
    }
    sizes.set(key, size);
  }
  return fontString(id, size, bold);
}

function fontString(id: ChartFont, size: number, bold: boolean): string {
  return `${bold ? '700 ' : ''}${+size.toFixed(2)}px "${FONTS[id].family}", monospace`;
}

let probe: CanvasRenderingContext2D | null = null;
const PROBE_BASELINE = 60;
const inks = new Map<string, { top: number; bottom: number }>();

/**
 * Rows of the digits' ink relative to the alphabetic baseline (negative is
 * above), counting pixels over half lit, as charts quantize them. Measured
 * from pixels because browsers' reported glyph bounds vary.
 */
function digitInk(font: string): { top: number; bottom: number } {
  let ink = inks.get(font);
  if (ink) return ink;
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const c = probe.canvas;
  c.width = 400;
  c.height = 80;
  probe.fillStyle = '#000';
  probe.fillRect(0, 0, c.width, c.height);
  probe.fillStyle = '#fff';
  probe.font = font;
  probe.textBaseline = 'alphabetic';
  probe.fillText('0123456789', 4, PROBE_BASELINE);
  const d = probe.getImageData(0, 0, c.width, c.height).data;
  let top = -1, bottom = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4]! > 127) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  ink = top < 0 ? { top: 0, bottom: 0 } : { top: top - PROBE_BASELINE, bottom: bottom - PROBE_BASELINE };
  inks.set(font, ink);
  return ink;
}

function inkHeight(font: string): number {
  const { top, bottom } = digitInk(font);
  return bottom - top + 1;
}

/** How far the top of `font`'s digits sits above its alphabetic baseline, in px (a canvas font string). */
export function digitTop(font: string): number {
  return -digitInk(font).top;
}

/** The row of `font`'s digits' lowest ink, relative to its alphabetic baseline (0 is the row just below it). */
export function digitBottom(font: string): number {
  return digitInk(font).bottom;
}

/** How far the middle of `font`'s digits sits above its alphabetic baseline, in px (a canvas font string). */
export function digitMid(font: string): number {
  const { top, bottom } = digitInk(font);
  return -(top + bottom) / 2;
}
