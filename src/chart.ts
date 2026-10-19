import type { Candle, MarketData } from './kraken';
import { formatInterval, type CandleWidth } from './settings';

export const SCREEN_W = 576;
export const SCREEN_H = 288;

// The G2 renders 16 levels of green; we draw in greyscale and let png.ts quantize.
const FG = '#ffffff';
const MID = '#a0a0a0';
const DIM = '#505050';
const FAINT = '#282828';
// Volume bars sit a step below the candles so they read as background context.
const VOL_UP = '#686868';
const VOL_DOWN = '#404040';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Line height of the market list under the charts. */
const LIST_LINE_H = 18;
const TIME_AXIS_H = 14;

interface Rect { x: number; y: number; w: number; h: number }

export interface ScreenModel {
  charts: MarketData[];
  /** Monitored markets that aren't charted; listed one per line. */
  ticker: MarketData[];
  /** Candle size in minutes. */
  interval: number;
  candleWidth: CandleWidth;
  /** When the data was fetched; stamped in the bottom-right corner. */
  updated: Date;
}

interface PanelStyle {
  pad: number;
  headerH: number;
  titleFont: string;
  axisFont: string;
}

interface Geometry {
  plot: Rect;
  vol: Rect;
  /** Slot width (body + gap) and candle body width, in px. */
  pitch: number;
  body: number;
  /** Number of candle slots that fit across the plot. */
  count: number;
}

/**
 * Everything that has to agree across panels so they share one time scale:
 * every panel has the same width, so with a common price-axis width and the same
 * latest-candle time, slot k from the right sits at the same x in every column.
 */
interface TimeFrame {
  intervalSec: number;
  lastTime: number;
  ticks: number[];
}

/** Rough price-axis width, used until a real render has measured one. */
export const DEFAULT_AXIS_W = 52;

/** Returns the measured price-axis width, for `candleCapacity`. */
export function renderScreen(ctx: CanvasRenderingContext2D, model: ScreenModel): number {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const chartArea: Rect = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };
  if (model.charts.length === 0) {
    // No charts: the market list gets the whole screen, above the timestamp.
    const stampRow: Rect = { x: 0, y: SCREEN_H - TIME_AXIS_H, w: SCREEN_W, h: TIME_AXIS_H };
    drawMarketList(ctx, model.ticker, { ...chartArea, h: stampRow.y }, true);
    drawStamp(ctx, stampRow, `12px ${FONT}`, 4, model.updated);
    ctx.restore();
    return DEFAULT_AXIS_W;
  }
  if (model.ticker.length) {
    const h = model.ticker.length * LIST_LINE_H + 4;
    chartArea.h -= h;
    drawMarketList(ctx, model.ticker, { x: 0, y: chartArea.h, w: SCREEN_W, h }, false);
  }
  chartArea.h -= TIME_AXIS_H;
  const timeAxis: Rect = { x: 0, y: chartArea.y + chartArea.h, w: SCREEN_W, h: TIME_AXIS_H };

  const rects = layout(model.charts.length, chartArea);
  const style = panelStyle(rects[0]!.h < 200);

  ctx.font = style.axisFont;
  const axisW = Math.ceil(Math.max(
    ctx.measureText('000.0K').width,
    ...model.charts.map((m) => m.candles.length ? ctx.measureText(formatPrice(m.candles.at(-1)!.close)).width : 0),
  )) + 8;
  const geoms = rects.map((r) => panelGeometry(r, style, axisW, model.candleWidth));

  const intervalSec = model.interval * 60;
  const latest = Math.max(...model.charts.map((m) => m.candles.at(-1)?.time ?? -Infinity));
  const lastTime = Number.isFinite(latest) ? latest : Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
  const g0 = geoms[0]!;
  const frame: TimeFrame = {
    intervalSec,
    lastTime,
    ticks: timeTicks(lastTime, g0.count, intervalSec, g0.pitch, rects[0]!.w < 400 ? 48 : 60),
  };

  model.charts.forEach((m, i) => drawPanel(ctx, m, model.interval, rects[i]!, style, geoms[i]!, frame));

  // Label only the bottom row; panels above line up with it.
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  const columns = geoms.filter((_, i) => rects[i]!.y + rects[i]!.h === bottom);
  drawTimeAxis(ctx, timeAxis, columns, frame, style, model.updated);
  ctx.restore();
  return axisW;
}

/** How many candles fit across each chart for a given number of charts and candle width. */
export function candleCapacity(nCharts: number, width: CandleWidth, axisW = DEFAULT_AXIS_W): number {
  const area: Rect = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H - TIME_AXIS_H };
  const r = layout(Math.min(4, Math.max(1, nCharts)), area)[0]!;
  return panelGeometry(r, panelStyle(r.h < 200), axisW, width).count;
}

/** 1: full screen. 2–3: stacked full-width rows. 4: quadrants. */
function layout(n: number, a: Rect): Rect[] {
  if (n <= 3) {
    return Array.from({ length: n }, (_, i) => {
      const y0 = Math.round(a.y + (a.h * i) / n), y1 = Math.round(a.y + (a.h * (i + 1)) / n);
      return { x: a.x, y: y0, w: a.w, h: y1 - y0 };
    });
  }
  const halfW = a.w / 2;
  const top = { y: a.y, h: Math.floor(a.h / 2) };
  const bot = { y: a.y + top.h, h: a.h - top.h };
  return [
    { x: a.x, w: halfW, ...top }, { x: a.x + halfW, w: halfW, ...top },
    { x: a.x, w: halfW, ...bot }, { x: a.x + halfW, w: halfW, ...bot },
  ];
}

function panelStyle(compact: boolean): PanelStyle {
  return {
    pad: 4,
    headerH: compact ? 18 : 24,
    titleFont: `600 ${compact ? 13 : 17}px ${FONT}`,
    axisFont: `${compact ? 10 : 12}px ${FONT}`,
  };
}

/** Price plot with a right-hand axis, and a volume strip (~10%) underneath. */
function panelGeometry(r: Rect, s: PanelStyle, axisW: number, width: CandleWidth): Geometry {
  const area: Rect = {
    x: r.x + s.pad,
    y: r.y + s.headerH + 2,
    w: r.w - s.pad * 2 - axisW,
    h: r.h - s.headerH - 2 - s.pad,
  };
  const volGap = 2;
  const volH = Math.max(6, Math.round(area.h * 0.1));
  const plot: Rect = { ...area, h: area.h - volH - volGap };
  const vol: Rect = { ...area, y: plot.y + plot.h + volGap, h: volH };
  const body = width === 'wide' ? (plot.w >= 400 ? 6 : 4) : width === 'narrow' ? 3 : 2;
  const pitch = body + (width === 'wide' ? 2 : 1);
  return { plot, vol, pitch, body, count: Math.max(2, Math.floor(plot.w / pitch)) };
}

/** Left edge of the candle body in slot k (0 = latest, at the right). */
function slotLeft(g: Geometry, k: number): number {
  return g.plot.x + g.plot.w - (k + 1) * g.pitch + (g.pitch - g.body);
}

function slotCenter(g: Geometry, k: number): number {
  return slotLeft(g, k) + Math.floor(g.body / 2);
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  data: MarketData,
  interval: number,
  r: Rect,
  s: PanelStyle,
  g: Geometry,
  frame: TimeFrame,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();

  const { pad, headerH, titleFont, axisFont } = s;

  // Header: "BTC-USDC 5m" ............ "82,142.82 +0.41%"
  ctx.textBaseline = 'middle';
  ctx.font = titleFont;
  ctx.fillStyle = FG;
  ctx.textAlign = 'left';
  const title = data.market;
  ctx.fillText(title, r.x + pad, r.y + headerH / 2);
  const titleW = ctx.measureText(title).width;
  ctx.font = axisFont;
  ctx.fillStyle = MID;
  ctx.fillText(formatInterval(interval), r.x + pad + titleW + 5, r.y + headerH / 2 + 1);

  if (data.error || data.candles.length === 0) {
    ctx.font = axisFont;
    ctx.fillStyle = MID;
    ctx.textAlign = 'center';
    ctx.fillText(data.error ?? 'no data', r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
    return;
  }

  const last = data.candles[data.candles.length - 1]!;
  const change = change24h(data.candles);
  ctx.textAlign = 'right';
  const changeText = change === null ? '' : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`;
  ctx.font = axisFont;
  ctx.fillStyle = MID;
  ctx.fillText(changeText, r.x + r.w - pad, r.y + headerH / 2 + 1);
  const changeW = changeText ? ctx.measureText(changeText).width + 6 : 0;
  ctx.font = titleFont;
  ctx.fillStyle = FG;
  ctx.fillText(formatPrice(last.close), r.x + r.w - pad - changeW, r.y + headerH / 2);

  const { plot, vol, body } = g;
  // Place candles by time, not index, so every panel shares the time scale.
  const visible = data.candles
    .map((c) => ({ c, k: Math.round((frame.lastTime - c.time) / frame.intervalSec) }))
    .filter(({ k }) => k >= 0 && k < g.count);
  if (visible.length === 0) {
    ctx.font = axisFont;
    ctx.fillStyle = MID;
    ctx.textAlign = 'center';
    ctx.fillText('no recent trades', r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
    return;
  }

  let lo = Infinity, hi = -Infinity, loK = -1, hiK = -1;
  for (const { c, k } of visible) {
    if (c.low < lo) { lo = c.low; loK = k; }
    if (c.high > hi) { hi = c.high; hiK = k; }
  }
  if (hi === lo) { hi += hi * 0.001 || 1; lo -= lo * 0.001 || 1; }
  const y = (p: number) => Math.round(plot.y + (hi - p) / (hi - lo) * (plot.h - 1));

  ctx.font = axisFont;
  ctx.lineWidth = 1;
  ctx.strokeStyle = FAINT;
  ctx.setLineDash([2, 3]);
  // Vertical grid at the shared time ticks.
  for (const t of frame.ticks) {
    const px = slotCenter(g, Math.round((frame.lastTime - t) / frame.intervalSec)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.y + plot.h);
    ctx.stroke();
  }
  // Horizontal grid at nice price steps, running across the axis column to the
  // right edge; the price labels are drawn over the lines after the candles.
  const right = r.x + r.w - pad;
  const gridPrices = niceTicks(lo, hi, plot.h < 120 ? 4 : 5);
  for (const p of gridPrices) {
    const py = y(p) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.x, py);
    ctx.lineTo(right, py);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Volume strip.
  let maxVol = 0, maxVolK = 0;
  for (const { c, k } of visible) if (c.volume > maxVol) { maxVol = c.volume; maxVolK = k; }
  ctx.fillStyle = FAINT;
  ctx.fillRect(vol.x, vol.y + vol.h, vol.w, 1);

  for (const { c, k } of visible) {
    const left = slotLeft(g, k);
    const up = c.close >= c.open;

    const vh = Math.max(1, Math.round(c.volume / (maxVol || 1) * vol.h));
    ctx.fillStyle = up ? VOL_UP : VOL_DOWN;
    ctx.fillRect(left, vol.y + vol.h - vh, body, vh);

    const mid = slotCenter(g, k);
    const yo = y(c.open), yc = y(c.close);
    const top = Math.min(yo, yc), bottom = Math.max(yo, yc);
    ctx.fillStyle = up ? FG : MID;
    // Wick: drawn as rects so it stays a crisp single pixel.
    ctx.fillRect(mid, y(c.high), 1, top - y(c.high));
    ctx.fillRect(mid, bottom + 1, 1, y(c.low) - bottom);
    // Filled bright body for up candles, hollow dimmer body for down. Below 3px
    // there's no room for a hollow centre, so down candles are just filled dimmer.
    if (up || body < 3) {
      ctx.fillRect(left, top, body, Math.max(1, bottom - top + 1));
    } else {
      ctx.strokeStyle = MID;
      ctx.strokeRect(left + 0.5, top + 0.5, body - 1, Math.max(1, bottom - top));
    }
  }

  // Price labels sit on their gridlines at the right edge. Skip any that would
  // poke up into the header.
  for (const p of gridPrices) {
    const py = y(p);
    if (py < plot.y + 4) continue;
    tag(ctx, formatPrice(p), right, py, 'right', DIM);
  }

  // Last-price marker on the axis.
  ctx.fillStyle = FG;
  ctx.fillRect(plot.x + plot.w + 1, y(last.close), 3, 1);

  // Highest volume, beside its bar, on whichever side has more room.
  if (maxVol > 0) {
    const vx = slotLeft(g, maxVolK);
    const onLeft = vx > vol.x + vol.w / 2;
    tag(ctx, formatVolume(maxVol), onLeft ? vx - 3 : vx + body + 3, vol.y + vol.h / 2, onLeft ? 'right' : 'left', MID);
  }

  // Session high and low, with a short leader from the wick tip.
  if (hi > lo && hiK >= 0 && loK >= 0) {
    ctx.font = axisFont;
    const half = Math.ceil((ctx.measureText('0').actualBoundingBoxAscent + 2) / 2);
    const extreme = (price: number, k: number) => {
      const wx = slotCenter(g, k), wy = y(price);
      const onLeft = wx > plot.x + plot.w / 2;
      const dir = onLeft ? -1 : 1;
      ctx.fillStyle = MID;
      ctx.fillRect(onLeft ? wx - 4 : wx + 2, wy, 3, 1);
      const cy = Math.min(Math.max(wy, plot.y + half), plot.y + plot.h - half);
      tag(ctx, formatPrice(price), wx + dir * 6, cy, onLeft ? 'right' : 'left', MID);
    };
    extreme(hi, hiK);
    extreme(lo, loK);
  }

  ctx.restore();
}

function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  columns: Geometry[],
  frame: TimeFrame,
  s: PanelStyle,
  updated: Date,
): void {
  ctx.save();
  ctx.font = s.axisFont;
  ctx.textBaseline = 'top';

  const stampLeft = drawStamp(ctx, r, s.axisFont, s.pad, updated) - 6;

  ctx.font = s.axisFont;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  const utc = frame.intervalSec >= 86400;
  const step = frame.ticks.length > 1 ? frame.ticks[1]! - frame.ticks[0]! : frame.intervalSec;
  for (const g of columns) {
    const minX = g.plot.x, maxX = Math.min(g.plot.x + g.plot.w + 30, stampLeft);
    for (const t of frame.ticks) {
      const px = slotCenter(g, Math.round((frame.lastTime - t) / frame.intervalSec));
      const label = formatTime(t, step, utc);
      const half = ctx.measureText(label).width / 2;
      ctx.fillStyle = DIM;
      ctx.fillRect(px, r.y, 1, 3);
      if (px - half < minX || px + half > maxX) continue;
      ctx.fillStyle = MID;
      ctx.fillText(label, px, r.y + 2);
    }
  }
  ctx.restore();
}

/** Text centred vertically on `cy`, over a black box so lines and bars behind it don't show through. */
function tag(ctx: CanvasRenderingContext2D, text: string, x: number, cy: number, align: 'left' | 'right', color: string): void {
  const m = ctx.measureText(text);
  const w = Math.ceil(m.width);
  const top = Math.floor(cy - m.actualBoundingBoxAscent / 2) - 2;
  const h = Math.ceil(m.actualBoundingBoxAscent) + 4;
  const left = align === 'right' ? x - w : x;
  ctx.fillStyle = '#000';
  ctx.fillRect(left - 2, top, w + 4, h);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, cy);
}

const TIME_STEPS = [
  60, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200,
  86400, 172800, 604800, 1209600, 2592000, 7776000, 15552000,
];

/** Candle open times to label, spaced at least `minPx` apart and aligned to local clock boundaries. */
function timeTicks(lastTime: number, count: number, intervalSec: number, pitch: number, minPx: number): number[] {
  const step = TIME_STEPS.find((st) => st % intervalSec === 0 && (st / intervalSec) * pitch >= minPx);
  if (!step) return [];
  const first = lastTime - (count - 1) * intervalSec;
  // Align ticks to local time when that still lands on candle boundaries (not e.g. UTC+5:30 with 1h candles).
  const tzOff = new Date(lastTime * 1000).getTimezoneOffset() * 60;
  const tz = step < 86400 && tzOff % intervalSec === 0 ? tzOff : 0;
  const out: number[] = [];
  for (let t = Math.ceil((first - tz) / step) * step + tz; t <= lastTime; t += step) out.push(t);
  return out;
}

function formatTime(t: number, step: number, utc: boolean): string {
  const d = new Date(t * 1000);
  const timeZone = utc ? 'UTC' : undefined;
  const hh = utc ? d.getUTCHours() : d.getHours();
  const mm = utc ? d.getUTCMinutes() : d.getMinutes();
  if (step >= 86400 || (hh === 0 && mm === 0)) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Frame timestamp, right-aligned in `r`. Returns its left edge. */
function drawStamp(ctx: CanvasRenderingContext2D, r: Rect, font: string, pad: number, updated: Date): number {
  const stamp = updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const x = r.x + r.w - pad;
  ctx.font = font;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = FG;
  ctx.fillText(stamp, x, r.y + 2);
  return x - ctx.measureText(stamp).width;
}

/**
 * One market per line, in columns: market, price, 24h change, 24h volume.
 * Under the charts it uses small fixed lines; `full` scales it to fill `r`.
 */
function drawMarketList(ctx: CanvasRenderingContext2D, items: MarketData[], r: Rect, full: boolean): void {
  if (items.length === 0) return;
  ctx.save();
  const lineH = full ? Math.min(40, Math.floor((r.h - 8) / items.length)) : LIST_LINE_H;
  const px = full ? Math.max(13, Math.min(24, Math.round(lineH * 0.6))) : 13;
  const font = `${px}px ${FONT}`;
  const gap = full ? 24 : 16;
  const x0 = r.x + 6, xEnd = r.x + r.w - 6;
  let y = full ? r.y + Math.round((r.h - items.length * lineH) / 2) : r.y + 4;
  if (!full) {
    ctx.fillStyle = DIM;
    ctx.fillRect(r.x, r.y, r.w, 1);
  }

  // [market, price, change, volume] per row, with each cell's colour.
  const rows = items.map((m): [string, string][] => {
    const last = m.candles.at(-1);
    if (m.error || !last) return [[m.market, MID], [m.error ?? 'no data', DIM], ['', DIM], ['', DIM]];
    const ch = change24h(m.candles);
    const base = m.market.split('-')[0];
    return [
      [m.market, MID],
      [formatPrice(last.close), FG],
      [ch === null ? '' : `${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(2)}%`, MID],
      [m.dayVolume === undefined ? '' : `Vol ${formatVolume(m.dayVolume)} ${base}`, MID],
    ];
  });

  ctx.font = font;
  ctx.textBaseline = 'middle';
  const colW = [0, 1, 2].map((i) => {
    ctx.font = i === 1 ? `600 ${px}px ${FONT}` : font;
    // Error rows span the columns, so they don't set widths.
    return Math.max(...rows.map((row) => row[1]![1] === DIM && i > 0 ? 0 : ctx.measureText(row[i]![0]).width));
  });
  // Market left-aligned; price, change and volume right-aligned.
  const priceR = x0 + colW[0]! + gap + colW[1]!;
  const changeR = priceR + gap + colW[2]!;
  for (const row of rows) {
    const cy = y + lineH / 2 + 1;
    const cells: [number, CanvasTextAlign][] = row[1]![1] === DIM
      ? [[x0, 'left'], [x0 + colW[0]! + gap, 'left'], [0, 'left'], [0, 'left']]
      : [[x0, 'left'], [priceR, 'right'], [changeR, 'right'], [xEnd, 'right']];
    row.forEach(([text, color], i) => {
      if (!text) return;
      ctx.fillStyle = color;
      ctx.textAlign = cells[i]![1];
      ctx.font = i === 1 && color === FG ? `600 ${px}px ${FONT}` : font;
      ctx.fillText(text, cells[i]![0], cy);
    });
    y += lineH;
  }
  ctx.restore();
}

/** Change from the close ~24h ago (or the oldest candle we have) to the latest close. */
function change24h(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1]!;
  const cutoff = Date.now() / 1000 - 86400;
  let ref = candles[0]!.open;
  for (let i = candles.length - 2; i >= 0; i--) {
    if (candles[i]!.time <= cutoff) { ref = candles[i]!.close; break; }
  }
  return ref ? last.close / ref - 1 : null;
}

export function formatPrice(p: number): string {
  const abs = Math.abs(p);
  const digits = abs >= 10000 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return p.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  // Tiny volumes would round to "0.0", so keep two significant figures instead.
  return v >= 0.05 || v === 0 ? v.toFixed(1) : v.toPrecision(2);
}

function niceTicks(lo: number, hi: number, target: number): number[] {
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}
