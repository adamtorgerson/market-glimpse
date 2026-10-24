import { formatPrice, formatTime, formatVolume, SCREEN_H, SCREEN_W, timeTicks } from './chart';
import { formatInterval, type TextWidth } from './settings';
import type { MarketData } from './sources/types';

/**
 * Text candles: one chart drawn in the glasses' own font instead of sent as
 * images, so it goes up in a single page rebuild with no tile-by-tile reveal.
 *
 * The font has one size and few block glyphs, but `l`, `|` and `'` are each a
 * 1px vertical stroke on a 4px advance, so a line of text is a 4px grid of
 * columns. Lines are 27px apart and a glyph's ink covers at most 16px of that,
 * so four copies of each container are offset vertically to fill the gaps and
 * to place stroke ends more finely. Up candles are drawn bright and down
 * candles dim (brightness is per container), which uses all 8 text containers
 * a page allows.
 *
 * Glyph metrics were measured in the simulator (v0.9.5), which uses the
 * firmware's font handling. A container whose text runs past its bottom edge
 * shows a scrollbar, so each one only gets the lines that fit.
 */

const LINE_H = 27;
const CELL = 4;
/** 1px strokes on a 4px advance; ink rows from the top of their line. */
const STROKES = [
  { glyph: 'l', top: 6, bottom: 21 },
  { glyph: '|', top: 8, bottom: 22 },
  { glyph: "'", top: 6, bottom: 9 },
];
/**
 * Blank 4px: Armenian Ա (2 UTF-8 bytes) isn't in the font, so it's drawn as
 * an empty 4px box. Thin space does the same in 3 bytes.
 */
const SKIP_1 = 'Ա';
/** Blank 20px (ideographic space), for 5 cells in one character. */
const SKIP_5 = '　';
/** Vertical offsets of the four copies of each container. */
const PHASES = [0, 7, 14, 20];
const BRIGHT = 4;
const DIM = 0;
/** Each container's text is cut off beyond this many UTF-8 bytes. */
const MAX_BYTES = 999;
/**
 * Candle shapes, in 4px columns: `span` columns of strokes plus a gap. Wide
 * candles are 3 columns, wick in the middle; narrow ones are 2, wick on the
 * right; thin ones are 1.
 */
const STYLES: Record<TextWidth, Style> = {
  'text-wide': { pitch: 4, span: 3 },
  'text-narrow': { pitch: 3, span: 2 },
  'text-thin': { pitch: 2, span: 1 },
};
interface Style {
  pitch: number;
  span: number;
}
/** Rows the candles may use: below the header line, above the footer line. */
const PLOT_TOP = 30;
const PLOT_BOTTOM = 240;
/**
 * Rows of the price keys, each marked by a dotted line through the candle
 * gaps. Each row's dots land in a different container, as dots cost bytes.
 */
const KEY_ROWS = [42, 102, 162, 224];
/** Time keys: offset 20, line 8, ink rows 242–257, just under the plot. */
const TIME_PLACE = { phase: 3, line: 8 };
/** Footer: offset 14, line 9, ink rows 261–281, the lowest line that fits. */
const FOOTER_PLACE = { phase: 2, line: 9 };
/** Least space between time keys, in px. */
const TIME_KEY_GAP = 80;

/** Advance widths of the firmware font, measured in the simulator; other characters are estimated. '1' and '2' are 1px narrower before another of themselves. */
const WIDTHS: Record<string, number> = {
  '1': 8, ':': 4, '.': 5, ',': 5, ' ': 5, '·': 5, "'": 4, '|': 4, '-': 10,
  A: 13, B: 12, C: 11, D: 12, E: 10, F: 10, G: 12, H: 12, I: 5, J: 8, K: 12, L: 9, M: 16,
  N: 12, O: 12, P: 12, Q: 12, R: 12, S: 11, T: 10, U: 12, V: 13, W: 16, X: 13, Y: 13, Z: 12,
  a: 11, b: 11, c: 10, e: 10, g: 11, h: 11, i: 5, k: 9, l: 4, m: 16, n: 11, o: 10, p: 11,
  q: 11, r: 7, s: 10, t: 6, u: 11, v: 11, w: 15, x: 11, y: 11, z: 9,
};

/** One text container: brightness 0–4 and its lines, from `y` down. */
export interface TextBox {
  y: number;
  color: number;
  lines: TextLine[];
}

interface TextLine {
  /** Stroke glyph by 4px column. */
  strokes: Map<number, string>;
  /** Text after the strokes, at `x` px (to the nearest 4px, as spacers are 4px). */
  texts: { x: number; text: string }[];
}

export interface TextChartModel {
  chart: MarketData;
  width: TextWidth;
  ticker: MarketData[];
  interval: number;
  updated: Date;
  source: string;
  /** Shown in the bottom-right corner, e.g. the app's name. */
  name?: string;
}

/** Candles that fit across the screen, for how much history to fetch. */
export function textCandles(width: TextWidth): number {
  const style = STYLES[width];
  return Math.floor(rightmostCol(style) / style.pitch) + 1;
}

/** Containers 0–3 bright, 4–7 dim, each set at the four vertical offsets. */
export function buildTextChart(m: TextChartModel): TextBox[] {
  const boxes: TextBox[] = [BRIGHT, DIM].flatMap((color) => PHASES.map((y) => ({
    y,
    color,
    lines: Array.from({ length: Math.floor((SCREEN_H - y) / LINE_H) }, () => ({ strokes: new Map<number, string>(), texts: [] })),
  })));
  const { chart } = m;
  const last = chart.last ?? chart.candles.at(-1)?.close;
  addHeader(boxes[0]!.lines[0]!, dimLine(boxes, { phase: 0, line: 0 }), m, last === undefined ? '' : formatPrice(last));

  // Bottom line: the other markets' prices on the left, as many as fit, and the name on the right.
  const name = m.name ?? '';
  const others = m.ticker.flatMap((t) => {
    const price = t.last ?? t.candles.at(-1)?.close;
    return price === undefined ? [] : [`${t.market} ${formatPrice(price)}`];
  });
  const sep = '  ·  ';
  while (others.length && textWidth(others.join(sep)) + (name ? HEADER_GAP + textWidth(name) : 0) > SCREEN_W - 8) others.pop();
  const footer = dimLine(boxes, FOOTER_PLACE).texts;
  if (others.length) footer.push({ x: 4, text: others.join(sep) });
  if (name) footer.push({ x: SCREEN_W - 4 - textWidth(name), text: name });

  if (chart.error || chart.candles.length === 0) {
    boxes[0]!.lines[4]!.texts.push({ x: 0, text: chart.error ?? 'no data' });
    return boxes;
  }
  // Drop the oldest candles if a container would run over its byte limit.
  let max = Infinity;
  for (;;) {
    const out = structuredClone(boxes);
    const drawn = drawCandles(out, chart, m.interval, STYLES[m.width], max);
    if (drawn <= 0 || out.every((b) => utf8Length(serializeBox(b)) <= MAX_BYTES)) return out;
    max = drawn - 4;
  }
}

export interface TextListModel {
  items: MarketData[];
  updated: Date;
  source: string;
  /** Shown in the bottom-right corner, e.g. the app's name. */
  name?: string;
  /** Still fetching: a market with no price yet shows '...' rather than 'no data'. */
  pending?: boolean;
  /** Set the rows against the right edge instead of the left. */
  right?: boolean;
}

/** Brightness of the market list's names, volumes and errors. */
const MID = 2;

/**
 * The market list (nothing charted) as text: one market per line, with the
 * name and 24h volume mid-bright and the price bright and right-aligned.
 * Corners as on the other screens: the time top-left, the source top-right,
 * and `name` bottom-right. Columns are lined up by the font's measured widths,
 * so they may be off by a px or two.
 */
export function buildTextList(m: TextListModel): TextBox[] {
  const rows = m.items.length;
  const footerY = SCREEN_H - LINE_H;
  // Centred between the top and bottom lines.
  const y = LINE_H + Math.max(0, Math.round((footerY - LINE_H - rows * LINE_H) / 2));
  const box = (color: number, at: number, n: number): TextBox =>
    ({ y: at, color, lines: Array.from({ length: n }, () => ({ strokes: new Map<number, string>(), texts: [] })) });
  const bright = box(BRIGHT, y, rows);
  const mid = box(MID, y, rows);
  const header = box(DIM, 0, 1);
  const footer = box(DIM, footerY, 1);

  const prices = m.items.map((d) => {
    const last = d.last ?? d.candles.at(-1)?.close;
    return d.error || last === undefined ? null : formatPrice(last);
  });
  const nameR = 4 + Math.max(...m.items.map((d) => textWidth(d.market)));
  const priceR = nameR + 24 + Math.max(0, ...prices.map((p) => (p ? textWidth(p) : 0)));
  m.items.forEach((d, i) => {
    mid.lines[i]!.texts.push({ x: 4, text: d.market });
    const price = prices[i];
    if (!price) {
      mid.lines[i]!.texts.push({ x: nameR + 24, text: d.error ?? (m.pending ? '...' : 'no data') });
      return;
    }
    bright.lines[i]!.texts.push({ x: priceR - textWidth(price), text: price });
    if (d.dayVolume !== undefined) mid.lines[i]!.texts.push({ x: priceR + 16, text: formatVolume(d.dayVolume) });
  });
  if (m.right) {
    // Shift the whole block so its widest row ends 4px from the right edge.
    const end = Math.max(...[bright, mid].flatMap((b) => b.lines.flatMap((l) => l.texts.map((t) => t.x + textWidth(t.text)))));
    const dx = Math.max(0, SCREEN_W - 4 - end);
    for (const b of [bright, mid]) for (const l of b.lines) for (const t of l.texts) t.x += dx;
  }

  const stamp = m.updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  header.lines[0]!.texts.push({ x: 4, text: stamp }, { x: SCREEN_W - 4 - textWidth(m.source), text: m.source });
  if (m.name) footer.lines[0]!.texts.push({ x: SCREEN_W - 4 - textWidth(m.name), text: m.name });
  return [bright, mid, header, footer];
}

/**
 * The loading screen's market list: names and prices so far, laid out like
 * the text list against the right edge, without its footer (the loading
 * screen has corners).
 */
export function buildLoadingList(items: MarketData[]): { y: number; h: number; color: number; content: string }[] {
  const [bright, mid] = buildTextList({ items, updated: new Date(), source: '', pending: true, right: true });
  return [bright!, mid!].map((b) => ({ y: b.y, h: b.lines.length * LINE_H, color: b.color, content: serializeBox(b) }));
}

/** The text a container shows. */
export function serializeBox(box: TextBox): string {
  return box.lines.map((line) => {
    let out = '';
    let at = 0;
    for (const col of [...line.strokes.keys()].sort((a, b) => a - b)) {
      out += skip(col - at / CELL) + line.strokes.get(col);
      at = (col + 1) * CELL;
    }
    for (const t of [...line.texts].sort((a, b) => a.x - b.x)) {
      const cells = Math.max(0, Math.round((t.x - at) / CELL));
      out += skip(cells) + t.text;
      at += cells * CELL + textWidth(t.text);
    }
    return out;
  }).join('\n').replace(/\n+$/, '');
}

/** The phone preview: the same strokes and text, drawn on the canvas. */
export function drawTextChart(ctx: CanvasRenderingContext2D, boxes: TextBox[]): void {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.font = '19px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const box of boxes) {
    // Brightness 0–4 as the glasses show it (measured in the simulator; 3 estimated).
    const v = [131, 179, 197, 226, 255][box.color] ?? 255;
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
    box.lines.forEach((line, k) => {
      const top = box.y + k * LINE_H;
      for (const [col, glyph] of line.strokes) {
        const s = STROKES.find((st) => st.glyph === glyph)!;
        ctx.fillRect(col * CELL, top + s.top, 1, s.bottom - s.top + 1);
      }
      for (const t of line.texts) ctx.fillText(t.text, t.x, top + 21);
    });
  }
  ctx.restore();
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Draws up to `max` candles, newest at the right; returns how many it drew. */
function drawCandles(boxes: TextBox[], data: MarketData, interval: number, style: Style, max: number): number {
  const intervalSec = interval * 60;
  const lastTime = data.candles.at(-1)!.time;
  const { pitch, span } = style;
  const count = Math.min(max, Math.floor(rightmostCol(style) / pitch) + 1);
  const visible = data.candles.filter((c) => (lastTime - c.time) / intervalSec < count);
  let lo = Math.min(...visible.map((c) => c.low));
  let hi = Math.max(...visible.map((c) => c.high));
  if (hi === lo) { hi += hi * 0.001 || 1; lo -= lo * 0.001 || 1; }
  const y = (p: number) => Math.round(PLOT_TOP + (hi - p) / (hi - lo) * (PLOT_BOTTOM - PLOT_TOP));
  const firstCol = rightmostCol(style);

  // Price keys sit at the left edge, over the oldest candles, which leave a
  // clear box around each label. A label's own line takes no strokes (see
  // `stroke`), so no stroke depends on how wide the font draws the label.
  const blocks: Block[] = KEYS.map((key) => {
    const text = formatPrice(priceAt(key.row, lo, hi));
    dimLine(boxes, key.label).texts.push({ x: 0, text });
    const top = PHASES[key.label.phase]! + key.label.line * LINE_H;
    return { right: Math.ceil((textWidth(text) + 2) / CELL), top: top + 4, bottom: top + 23 };
  });
  // Cover rows a–b of a column, around the labels.
  const draw = (group: TextBox[], col: number, a: number, b: number) => {
    let segments = [[a, b] as const];
    for (const k of blocks) {
      if (col > k.right) continue;
      segments = segments.flatMap(([s, e]) => [[s, Math.min(e, k.top - 1)], [Math.max(s, k.bottom + 1), e]] as const).filter(([s, e]) => s <= e);
    }
    for (const [s, e] of segments) stroke(group, col, s, e, blocks);
  };

  for (const c of data.candles) {
    const k = Math.round((lastTime - c.time) / intervalSec);
    if (k < 0 || k >= count) continue;
    const col = firstCol - k * pitch;
    const up = c.close >= c.open;
    const group = up ? boxes.slice(0, 4) : boxes.slice(4);
    const yo = y(c.open), yc = y(c.close), yh = y(c.high), yl = y(c.low);
    const top = Math.min(yo, yc), bottom = Math.max(yo, yc);
    if (span === 1) {
      // Thin: dim wicks; up bodies bright, down bodies hollow (a gap in the
      // line, like the hollow bodies of normal candles).
      if (up) draw(group, col, top, bottom);
      if (yh < top) draw(boxes.slice(4), col, yh, top - 1);
      if (yl > bottom) draw(boxes.slice(4), col, bottom + 1, yl);
      continue;
    }
    if (span === 2) {
      // Narrow: body in both columns, wick in the right one. Down candles are
      // filled too (no room for a hollow body), and dimmer.
      draw(group, col, top, bottom);
      draw(group, col + 1, yh, yl);
      continue;
    }
    // Up: filled body (all three columns). Down: hollow body (outer two), wick outside it.
    draw(group, col, top, bottom);
    draw(group, col + 2, top, bottom);
    if (up) {
      draw(group, col + 1, yh, yl);
    } else {
      if (yh < top) draw(group, col + 1, yh, top - 1);
      if (yl > bottom) draw(group, col + 1, bottom + 1, yl);
    }
  }
  // Dots in two of every nine gaps between candles (4 and 5 apart), from each price key.
  KEYS.forEach((key, i) => {
    const dots = dimLine(boxes, key.dot);
    for (let k = 0, n = 0; k < count; k += n++ % 2 ? 5 : 4) {
      const col = firstCol - k * pitch + span;
      if (col > blocks[i]!.right) dots.strokes.set(col, "'");
    }
  });
  // Time keys: centred under their candles, dropping any that would overlap.
  const ticks = timeTicks(lastTime, count, intervalSec, pitch * CELL, TIME_KEY_GAP);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : intervalSec;
  const times = dimLine(boxes, TIME_PLACE).texts;
  let end = -Infinity;
  for (const t of ticks) {
    const text = formatTime(t, step, intervalSec >= 86400);
    const w = textWidth(text);
    const center = (firstCol - Math.round((lastTime - t) / intervalSec) * pitch + (span - 1) / 2) * CELL;
    const x = Math.min(SCREEN_W - w, Math.max(0, Math.round(center - w / 2)));
    if (x < end + 8) continue;
    times.push({ x, text });
    end = x + w;
  }
  return count;
}

/** Rows `top`–`bottom` from the left edge to column `right`, kept clear of strokes. */
interface Block {
  right: number;
  top: number;
  bottom: number;
}

/** A line of the dim container at `phase`. */
function dimLine(boxes: TextBox[], at: { phase: number; line: number }): TextLine {
  return boxes[4 + at.phase]!.lines[at.line]!;
}

/** The line whose ink centre (`inkMid` rows below its top) is nearest `row`. */
function placeAt(row: number, inkMid: number): { phase: number; line: number; mid: number } {
  const all = PHASES.flatMap((dy, phase) =>
    Array.from({ length: Math.floor((SCREEN_H - dy) / LINE_H) }, (_, line) => ({ phase, line, mid: dy + line * LINE_H + inkMid })));
  return all.reduce((a, b) => (Math.abs(b.mid - row) < Math.abs(a.mid - row) ? b : a));
}

/** Each price key: a `'` dot (ink rows 6–9) at the key's row and its label (digits rows 6–21) level with it. */
const KEYS = KEY_ROWS.map((r) => {
  const dot = placeAt(r, 7.5);
  return { row: dot.mid, dot, label: placeAt(dot.mid, 13.5) };
});

function priceAt(row: number, lo: number, hi: number): number {
  return hi - (row - PLOT_TOP) / (PLOT_BOTTOM - PLOT_TOP) * (hi - lo);
}

/** Every stroke a column can use: [container offset index, line, glyph, ink rows]. */
const PLACES = PHASES.flatMap((dy, phase) =>
  Array.from({ length: Math.ceil((SCREEN_H - dy) / LINE_H) }, (_, line) =>
    STROKES.map((s) => ({ phase, line, glyph: s.glyph, top: dy + line * LINE_H + s.top, bottom: dy + line * LINE_H + s.bottom }))).flat())
  .filter((p) => p.top >= PLOT_TOP && p.bottom <= PLOT_BOTTOM)
  .sort((a, b) => a.top - b.top);

/**
 * Cover rows a–b (inclusive) of column `col` with strokes from the four
 * containers of `group`, working down from the top: each step takes the
 * stroke that covers the most of what's left while overshooting the ends least.
 * Lines with text and the `blocks` take no strokes.
 */
function stroke(group: TextBox[], col: number, a: number, b: number, blocks: Block[]): void {
  let cur = a;
  for (let first = true; cur <= b; first = false) {
    let best: (typeof PLACES)[number] | null = null;
    let bestScore = -Infinity;
    for (const p of PLACES) {
      const line = group[p.phase]!.lines[p.line]!;
      if (p.top > cur + 2 || p.bottom < cur - 2 || line.strokes.has(col) || line.texts.length) continue;
      if (blocks.some((k) => col <= k.right && p.top <= k.bottom && p.bottom >= k.top)) continue;
      const covered = Math.min(p.bottom, b) - Math.max(p.top, cur) + 1;
      const overshoot = Math.max(0, a - p.top) + Math.max(0, p.bottom - b);
      const score = covered - 2 * overshoot - Math.max(0, p.top - cur);
      if (score > bestScore) { best = p; bestScore = score; }
    }
    if (!best || (!first && (bestScore <= 0 || best.bottom < cur))) return;
    group[best.phase]!.lines[best.line]!.strokes.set(col, best.glyph);
    cur = best.bottom + 1;
  }
}

/** Width in px of `s` in the firmware font, to within a px or two. */
/** Estimated width of `s` in the glasses' font, in px. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDTHS[ch] ?? (/[\dA-Z]/.test(ch) ? 12 : 11);
  return w;
}

/** Column of the newest candle's left stroke, leaving a 4px margin on the right. */
function rightmostCol(style: Style): number {
  return Math.floor((SCREEN_W - 4) / CELL) - style.span;
}

/** Least space between header items, in px. */
const HEADER_GAP = 16;

/**
 * The top line, laid out like the image charts' header: the price (bright)
 * then the time on the left, the source then the market and candle size
 * (bright) on the right, and the index price centred between. When crowded,
 * the index drops its label, then goes, then the source, then the time.
 */
function addHeader(bright: TextLine, dim: TextLine, m: TextChartModel, price: string): void {
  let left = 4;
  if (price) {
    bright.texts.push({ x: left, text: price });
    left += textWidth(price) + HEADER_GAP;
  }
  const market = `${m.chart.market} ${formatInterval(m.interval)}`;
  let right = SCREEN_W - 4 - textWidth(market);
  bright.texts.push({ x: right, text: market });
  right -= HEADER_GAP;

  const stamp = m.updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const showTime = left + textWidth(stamp) <= right;
  const showSource = showTime && left + textWidth(stamp) + HEADER_GAP + textWidth(m.source) <= right;
  if (showTime) {
    dim.texts.push({ x: left, text: stamp });
    left += textWidth(stamp) + HEADER_GAP;
  }
  if (showSource) {
    right -= textWidth(m.source);
    dim.texts.push({ x: right, text: m.source });
    right -= HEADER_GAP;
  }

  const { index } = m.chart;
  if (index === undefined) return;
  const value = index === null ? '--' : formatPrice(index);
  const text = [`Index ${value}`, value].find((t) => textWidth(t) <= right - left);
  if (!text) return;
  const w = textWidth(text);
  dim.texts.push({ x: Math.max(left, Math.min(right - w, Math.round(SCREEN_W / 2 - w / 2))), text });
}

function skip(cells: number): string {
  return SKIP_5.repeat(Math.floor(cells / 5)) + SKIP_1.repeat(cells % 5);
}
