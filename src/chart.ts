import type { Candle, MarketData } from './sources/types';
import { cssFont, digitBottom, digitMid, digitTop } from './fonts';
import { formatInterval, type CandleWidth, type ChartFont } from './settings';
import LOGO_SVG from '../assets/icon.svg?raw';

export const SCREEN_W = 576;
export const SCREEN_H = 288;

// The G2 renders 16 levels of green; we draw in greyscale and let png.ts quantize.
export const FG = '#ffffff';
export const MID = '#a0a0a0';
export const DIM = '#505050';
export const FAINT = '#282828';
// Volume bars sit a step below the candles so they read as background context.
const VOL_UP = '#686868';
const VOL_DOWN = '#404040';
/** Line height of the market list under the charts. */
const LIST_LINE_H = 18;
const LIST_PX = 13;
/** Space between a market's name, price and volume, and between markets on a line. */
const CELL_GAP = 5;
const ITEM_GAP = 18;
export const TIME_AXIS_H = 14;

/** The font of the render in progress; `renderScreen` sets it, so helpers needn't pass it along. */
let chartFont: ChartFont = 'atkinson';

/** `px` is the size in SF Pro / Roboto terms; each font is scaled to match its digit height. */
function font(px: number, bold = false): string {
  return cssFont(chartFont, px, bold);
}

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
  /** Data source name, shown in the bottom-left corner. */
  source: string;
  /** Must be loaded (`loadFont`) before rendering. */
  font: ChartFont;
}

interface PanelStyle {
  pad: number;
  headerH: number;
  titleFont: string;
  /** Price and time axis labels; also the high/low and volume labels in the plot. */
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
  chartFont = model.font;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const chartArea: Rect = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };
  if (model.charts.length === 0) {
    // No charts: the market list gets the whole screen, between the corners
    // the other screens use: the time top-left, the source top-right and the
    // logo bottom-right.
    const top: Rect = { x: 0, y: 0, w: SCREEN_W, h: TIME_AXIS_H };
    const listBottom = SCREEN_H - (LOGO_INK.bottom - LOGO_INK.top) - 6;
    drawMarketList(ctx, model.ticker, { x: 0, y: top.h, w: SCREEN_W, h: listBottom - top.h }, true);
    drawCorner(ctx, top, font(12), 4, formatStamp(model.updated), 'left');
    drawCorner(ctx, top, font(12), 4, model.source, 'right');
    drawLogo(ctx, SCREEN_W - 4, SCREEN_H - 2);
    ctx.restore();
    return DEFAULT_AXIS_W;
  }
  if (model.ticker.length) {
    ctx.font = font(LIST_PX);
    const h = flowLines(ctx, model.ticker, SCREEN_W - 12).length * LIST_LINE_H + 4;
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

  // Label only the bottom row; panels above line up with it.
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  const columns = geoms.filter((_, i) => rects[i]!.y + rects[i]!.h === bottom);
  // Time labels' digits start 4px down the axis row, clear of the tick marks.
  const labelBaseline = timeAxis.y + 4 + Math.round(digitTop(style.axisFont));
  // The logo fills the corner under the last price axis, beside the volume
  // strip, its lowest point level with the bottom of the time labels. Where
  // the corner is too short, it rises past the strip, and that panel skips
  // any price label it would cover.
  const corner = columns.at(-1)!;
  const logoBottom = labelBaseline + digitBottom(style.axisFont) + 1;
  const logoRight = SCREEN_W - style.pad;
  const logo: Rect = {
    x: logoRight - (LOGO_INK.right - LOGO_INK.left),
    y: logoBottom - (LOGO_INK.bottom - LOGO_INK.top),
    w: LOGO_INK.right - LOGO_INK.left,
    h: LOGO_INK.bottom - LOGO_INK.top,
  };
  const showLogo = logo.x >= corner.plot.x + corner.plot.w + 4 && logo.y >= corner.plot.y + 4;

  // The fetch time goes in the top-left panel's header and the source in the top-right's.
  const stamp = formatStamp(model.updated);
  model.charts.forEach((m, i) => {
    const r = rects[i]!;
    const top = r.y === chartArea.y;
    const corners = { time: top && r.x === 0 ? stamp : undefined, source: top && r.x + r.w === SCREEN_W ? model.source : undefined };
    drawPanel(ctx, m, model.interval, r, style, geoms[i]!, frame, corners, showLogo && geoms[i] === corner ? logo : undefined);
  });

  if (showLogo) {
    // Over a black box, so gridlines don't show between its pixels.
    ctx.fillStyle = '#000';
    ctx.fillRect(logo.x - 1, logo.y - 1, logo.w + 2, logo.h + 2);
    drawLogo(ctx, logoRight, logoBottom);
  }
  drawTimeAxis(ctx, timeAxis, columns, frame, style, (showLogo ? logo.x : logoRight) - 6, labelBaseline);
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
export function layout(n: number, a: Rect): Rect[] {
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
    titleFont: font(compact ? 13 : 17, true),
    axisFont: font(compact ? 10 : 12),
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
  corners: { time?: string; source?: string },
  /** Where the logo goes, if it reaches into this panel: no price label covers it. */
  logo?: Rect,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();

  const { pad, headerH, titleFont, axisFont } = s;

  // Header: "82,142  11:38:48" ...... "Index 82,150" ...... "Kraken  BTC-USDC 5m"
  // Every part has its digits and capitals centred on the same row.
  const cy = r.y + headerH / 2;
  // The small text is centred on the title's drawn digits, not on `cy`, so rounding can't split them.
  const titleY = Math.round(cy + digitMid(titleFont));
  const smallY = Math.round(titleY - digitMid(titleFont) + digitMid(axisFont));
  ctx.textBaseline = 'alphabetic';
  const hasPrice = !data.error && data.candles.length > 0;
  const priceText = hasPrice ? formatPrice(data.last ?? data.candles.at(-1)!.close) : '';
  const intervalText = formatInterval(interval);
  const indexText = hasPrice && data.index !== undefined ? (data.index === null ? '—' : formatPrice(data.index)) : null;
  const width = (text: string, font: string) => {
    ctx.font = font;
    return Math.ceil(ctx.measureText(text).width);
  };
  // The index is always shown. If it doesn't fit, it drops its label, then
  // the time and source make way, and as a last resort it's drawn crowded.
  const time = corners.time, source = corners.source;
  const sides = (withCorners: boolean) =>
    pad + (hasPrice ? width(priceText, titleFont) + 8 : 0) + (withCorners && time ? width(time, axisFont) + 8 : 0)
    + pad + width(intervalText, axisFont) + 5 + width(data.market, titleFont) + 8 + (withCorners && source ? width(source, axisFont) + 8 : 0);
  let showCorners = true, showLabel = true;
  if (indexText !== null) {
    const fits = ([c, l]: readonly [boolean, boolean]) =>
      r.w - sides(c) >= width(indexText, axisFont) + (l ? width(INDEX_LABEL, axisFont) : 0);
    const options = [[true, true], [true, false], [false, true], [false, false]] as const;
    [showCorners, showLabel] = options.find(fits) ?? options.at(-1)!;
  }

  // Right: the source, then the market and candle size.
  ctx.textAlign = 'right';
  let headRight = r.x + r.w - pad;
  const put = (text: string, font: string, color: string, y: number, gap: number) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, headRight, y);
    headRight -= width(text, font) + gap;
  };
  put(intervalText, axisFont, MID, smallY, 5);
  put(data.market, titleFont, FG, titleY, 8);
  if (showCorners && source) put(source, axisFont, MID, smallY, 8);
  // Left: the price, then the time.
  ctx.textAlign = 'left';
  let headLeft = r.x + pad;
  if (hasPrice) {
    ctx.font = titleFont;
    ctx.fillStyle = FG;
    ctx.fillText(priceText, headLeft, titleY);
    headLeft += width(priceText, titleFont) + 8;
  }
  if (showCorners && time) {
    ctx.font = axisFont;
    ctx.fillStyle = MID;
    ctx.fillText(time, headLeft, smallY);
    headLeft += width(time, axisFont) + 8;
  }
  if (indexText !== null) {
    // The index's digits start on the same row as the price's, at the top of the screen.
    const indexY = titleY - digitTop(titleFont) + digitTop(axisFont);
    drawIndex(ctx, indexText, showLabel, headLeft, headRight, r.x + r.w / 2, indexY, axisFont);
  }

  if (!hasPrice) {
    ctx.font = axisFont;
    ctx.fillStyle = MID;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.error ?? 'no data', r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
    return;
  }

  const last = data.candles[data.candles.length - 1]!;

  const { plot, vol, body } = g;
  // Place candles by time, not index, so every panel shares the time scale.
  const visible = data.candles
    .map((c) => ({ c, k: Math.round((frame.lastTime - c.time) / frame.intervalSec) }))
    .filter(({ k }) => k >= 0 && k < g.count);
  if (visible.length === 0) {
    ctx.font = axisFont;
    ctx.fillStyle = MID;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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
  // Four 2px dashes every 45px.
  ctx.setLineDash([2, 9, 2, 9, 2, 9, 2, 10]);
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

    // Volume shaped like its candle, but dim: up filled, down hollow (or
    // filled where it's too small for a hollow).
    const vh = Math.max(1, Math.round(c.volume / (maxVol || 1) * vol.h));
    if (up || body < 3 || vh < 3) {
      ctx.fillStyle = up ? VOL_UP : VOL_DOWN;
      ctx.fillRect(left, vol.y + vol.h - vh, body, vh);
    } else {
      ctx.strokeStyle = VOL_DOWN;
      ctx.strokeRect(left + 0.5, vol.y + vol.h - vh + 0.5, body - 1, vh - 1);
    }

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
  // poke up into the header, or cover the logo (tag's box, plus a row).
  ctx.font = axisFont;
  const half = ctx.measureText('0').actualBoundingBoxAscent / 2 + 3;
  for (const p of gridPrices) {
    const py = y(p);
    if (py < plot.y + 4) continue;
    if (logo && py + half > logo.y && py - half < logo.y + logo.h) continue;
    tag(ctx, formatPrice(p), right, py, 'right', DIM);
  }

  // Last-price marker on the axis.
  ctx.fillStyle = FG;
  ctx.fillRect(plot.x + plot.w + 1, y(last.close), 3, 1);

  // Highest volume, beside its bar, on whichever side has more room.
  ctx.font = axisFont;
  let volLabel: Rect | null = null;
  if (maxVol > 0) {
    const vx = slotLeft(g, maxVolK);
    const onLeft = vx > vol.x + vol.w / 2;
    volLabel = tag(ctx, formatVolume(maxVol), onLeft ? vx - 3 : vx + body + 3, vol.y + vol.h / 2, onLeft ? 'right' : 'left', MID);
  }

  // Session high and low, level with their wick tips, each in the nearest
  // stretch of its rows that nothing reaches (candles, volume bars, the
  // volume label), so it covers none: right beside the tip with a short
  // leader, or further out joined to it by a dotted line (which runs above
  // every candle for the high, below for the low). A label may stick out of
  // the plot to stay level, up to just under the header text or down into
  // the volume strip. With no clear stretch, it goes beside the tip on the
  // chart's inner side, kept inside the plot.
  if (hi > lo && hiK >= 0 && loK >= 0) {
    ctx.font = axisFont;
    const ascent = ctx.measureText('0').actualBoundingBoxAscent;
    const half = Math.ceil((ascent + 2) / 2);
    // Rows each pixel column's candle and volume bar cover.
    const colTop = new Array<number>(plot.w).fill(Infinity), colBottom = new Array<number>(plot.w).fill(-Infinity);
    const volTop = new Array<number>(plot.w).fill(Infinity);
    for (const { c, k } of visible) {
      const left = slotLeft(g, k) - plot.x;
      const vh = Math.max(1, Math.round(c.volume / (maxVol || 1) * vol.h));
      for (let x = Math.max(0, left); x < Math.min(plot.w, left + body); x++) {
        colTop[x] = Math.min(colTop[x]!, y(c.high));
        colBottom[x] = Math.max(colBottom[x]!, y(c.low));
        volTop[x] = Math.min(volTop[x]!, vol.y + vol.h - vh);
      }
    }
    // How far a label's centre may go: its box stays under the header text and above the volume strip's base.
    const minCy = titleY + 6 + ascent / 2, maxCy = vol.y + vol.h - 3 - ascent / 2;
    const extreme = (price: number, k: number) => {
      const wx = slotCenter(g, k), wy = y(price);
      const text = formatPrice(price);
      ctx.font = axisFont;
      // The label's box, as `tag` draws it, plus a pixel's clearance.
      const w = Math.ceil(ctx.measureText(text).width) + 4;
      const place = (cy: number) => {
        const top = Math.floor(cy - ascent / 2) - 3, bottom = top + Math.ceil(ascent) + 5;
        const clear = (x: number) => (colTop[x - plot.x]! > bottom || colBottom[x - plot.x]! < top) && volTop[x - plot.x]! > bottom;
        const fits = (left: number) => {
          if (left < plot.x || left + w > plot.x + plot.w) return false;
          if (volLabel && left < volLabel.x + volLabel.w && left + w > volLabel.x && top < volLabel.y + volLabel.h && bottom > volLabel.y) return false;
          for (let x = left - 1; x <= left + w; x++) if (x >= plot.x && x < plot.x + plot.w && !clear(x)) return false;
          return true;
        };
        // Nearest clear box on either side, starting just past the leader.
        for (let d = 0; d < plot.w; d++) {
          for (const side of [-1, 1] as const) {
            const left = side < 0 ? wx - 6 - d - w : wx + 6 + d;
            if (fits(left)) return { left, side, gap: d };
          }
        }
        return null;
      };
      const cy = Math.min(Math.max(wy, minCy), maxCy);
      const best = place(cy);
      ctx.fillStyle = MID;
      if (best) {
        const { left, side, gap } = best;
        if (gap === 0) {
          ctx.fillRect(side < 0 ? wx - 4 : wx + 2, wy, 3, 1);
        } else {
          const from = side < 0 ? left + w + 1 : wx + 2, to = side < 0 ? wx - 2 : left - 2;
          for (let x = side < 0 ? to : from; side < 0 ? x >= from : x <= to; x += side < 0 ? -3 : 3) ctx.fillRect(x, wy, 1, 1);
        }
        tag(ctx, text, left + 2, cy, 'left', MID);
        return;
      }
      const inside = Math.min(Math.max(wy, plot.y + half), plot.y + plot.h - half);
      const onLeft = wx > plot.x + plot.w / 2;
      ctx.fillRect(onLeft ? wx - 4 : wx + 2, wy, 3, 1);
      tag(ctx, text, wx + (onLeft ? -6 : 6), inside, onLeft ? 'right' : 'left', MID);
    };
    extreme(hi, hiK);
    extreme(lo, loK);
  }

  ctx.restore();
}

const INDEX_LABEL = 'Index ';

/** "Index 81,950" on `baseline`, centred at `cx` but kept between `minX` and `maxX` where it fits. */
function drawIndex(ctx: CanvasRenderingContext2D, value: string, showLabel: boolean, minX: number, maxX: number, cx: number, baseline: number, font: string): void {
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const labelW = showLabel ? Math.ceil(ctx.measureText(INDEX_LABEL).width) : 0;
  const w = labelW + Math.ceil(ctx.measureText(value).width);
  const x = Math.round(Math.max(minX, Math.min(cx - w / 2, maxX - w)));
  if (showLabel) {
    ctx.fillStyle = DIM;
    ctx.fillText(INDEX_LABEL, x, baseline);
  }
  ctx.fillStyle = MID;
  ctx.fillText(value, x + labelW, baseline);
}

function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  columns: Geometry[],
  frame: TimeFrame,
  s: PanelStyle,
  maxRight: number,
  baseline: number,
): void {
  ctx.save();
  ctx.font = s.axisFont;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  const utc = frame.intervalSec >= 86400;
  const step = frame.ticks.length > 1 ? frame.ticks[1]! - frame.ticks[0]! : frame.intervalSec;
  for (const g of columns) {
    const minX = Math.max(g.plot.x, r.x + s.pad), maxX = Math.min(g.plot.x + g.plot.w + 30, maxRight);
    for (const t of frame.ticks) {
      const px = slotCenter(g, Math.round((frame.lastTime - t) / frame.intervalSec));
      const label = formatTime(t, step, utc);
      const half = ctx.measureText(label).width / 2;
      ctx.fillStyle = DIM;
      ctx.fillRect(px, r.y, 1, 3);
      if (px - half < minX || px + half > maxX) continue;
      ctx.fillStyle = MID;
      ctx.fillText(label, px, baseline);
    }
  }
  ctx.restore();
}

/**
 * The app icon (assets/icon.svg), drawn 24px square. It's whole-pixel rects
 * on a 24px grid, so every pixel is fully on or off; a larger master would be
 * scaled, each pixel's opacity the share of it the master covers.
 */
const LOGO_SIZE = 24;
const LOGO_PIXELS = (() => {
  const master = +LOGO_SVG.match(/viewBox="0 0 (\d+) \d+"/)![1]!;
  const rects = [...LOGO_SVG.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)]
    .map(([, x, y, w, h]) => ({ x: +x!, y: +y!, w: +w!, h: +h! }));
  const k = master / LOGO_SIZE;
  const overlap = (a: number, b: number, lo: number, hi: number) => Math.max(0, Math.min(b, hi) - Math.max(a, lo));
  const pixels: { x: number; y: number; a: number }[] = [];
  for (let y = 0; y < LOGO_SIZE; y++) {
    for (let x = 0; x < LOGO_SIZE; x++) {
      const area = rects.reduce((sum, r) => sum + overlap(x * k, (x + 1) * k, r.x, r.x + r.w) * overlap(y * k, (y + 1) * k, r.y, r.y + r.h), 0);
      if (area > 0) pixels.push({ x, y, a: Math.min(1, area / (k * k)) });
    }
  }
  return pixels;
})();
/** The icon's lit pixels' bounds, inside its padding. */
export const LOGO_INK = {
  left: Math.min(...LOGO_PIXELS.map((p) => p.x)),
  top: Math.min(...LOGO_PIXELS.map((p) => p.y)),
  right: Math.max(...LOGO_PIXELS.map((p) => p.x)) + 1,
  bottom: Math.max(...LOGO_PIXELS.map((p) => p.y)) + 1,
};

/** Draws the icon with its lit pixels' bottom-right corner at (`right`, `bottom`). */
/** A little dimmer than labels, so the logo stays in the background. */
const LOGO_COLOR = '#787878';

export function drawLogo(ctx: CanvasRenderingContext2D, right: number, bottom: number): void {
  const x = right - LOGO_INK.right, y = bottom - LOGO_INK.bottom;
  ctx.save();
  ctx.fillStyle = LOGO_COLOR;
  for (const p of LOGO_PIXELS) {
    ctx.globalAlpha = p.a;
    ctx.fillRect(x + p.x, y + p.y, 1, 1);
  }
  ctx.restore();
}

/** Text centred vertically on `cy`, over a black box so lines and bars behind it don't show through. Returns the box. */
function tag(ctx: CanvasRenderingContext2D, text: string, x: number, cy: number, align: 'left' | 'right', color: string): Rect {
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
  return { x: left - 2, y: top, w: w + 4, h };
}

const TIME_STEPS = [
  60, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200,
  86400, 172800, 604800, 1209600, 2592000, 7776000, 15552000,
];

/** Candle open times to label, spaced at least `minPx` apart and aligned to local clock boundaries. */
export function timeTicks(lastTime: number, count: number, intervalSec: number, pitch: number, minPx: number): number[] {
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

export function formatTime(t: number, step: number, utc: boolean): string {
  const d = new Date(t * 1000);
  const timeZone = utc ? 'UTC' : undefined;
  const hh = utc ? d.getUTCHours() : d.getHours();
  const mm = utc ? d.getUTCMinutes() : d.getMinutes();
  if (step >= 86400 || (hh === 0 && mm === 0)) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatStamp(updated: Date): string {
  return updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** `text` in the bottom-left or bottom-right corner of `r`. Returns its inner edge. */
function drawCorner(ctx: CanvasRenderingContext2D, r: Rect, font: string, pad: number, text: string, side: 'left' | 'right'): number {
  const x = side === 'left' ? r.x + pad : r.x + r.w - pad;
  ctx.font = font;
  ctx.textAlign = side;
  ctx.textBaseline = 'top';
  ctx.fillStyle = MID;
  ctx.fillText(text, x, r.y + 2);
  const w = ctx.measureText(text).width;
  return side === 'left' ? x + w : x - w;
}

/** A cell of text; `trend` adds an arrow after it, up or down. */
type Cell = { text: string; color: string; bold?: boolean; trend?: number };

/** Space before a trend arrow, and its width for text `px` tall. */
const ARROW_GAP = 5;
export const arrowWidth = (px: number, scale = 1) => Math.round(px * 0.33 * scale);
/** The lists under the charts' small text takes bigger arrows, to be seen. */
export const LIST_ARROW = 1.3;

/**
 * A simple arrow, up (`dir` > 0) or down, `px` tall like the text it follows,
 * its left edge at `x` and centred on `cy`: a stem with a V head, as the
 * glasses' own "↑" and "↓".
 */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, cy: number, px: number, dir: number, color: string, scale = 1): void {
  const h = Math.round(px * 0.42 * scale), w = arrowWidth(px, scale);
  const mid = x + w / 2, tip = dir > 0 ? cy - h / 2 : cy + h / 2, tail = dir > 0 ? cy + h / 2 : cy - h / 2;
  const back = dir > 0 ? tip + w / 2 : tip - w / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, px / 10);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(mid, tail);
  ctx.lineTo(mid, tip);
  ctx.moveTo(x, back);
  ctx.lineTo(mid, tip);
  ctx.lineTo(x + w, back);
  ctx.stroke();
  ctx.restore();
}

/** Width of a cell's text, and its arrow if any. */
function cellWidth(ctx: CanvasRenderingContext2D, c: Cell, px: number, scale = 1): number {
  ctx.font = cellFont(c, px);
  return ctx.measureText(c.text).width + (c.trend ? ARROW_GAP + arrowWidth(px, scale) : 0);
}

/** Name, price (with which way it moved since the last update) and 24h volume (unlabelled), or 24h change if given; or name and error. */
function marketCells(m: MarketData): Cell[] {
  const last = m.last ?? m.candles.at(-1)?.close;
  if (m.error || last === undefined) return [{ text: m.market, color: MID }, { text: m.error ?? 'no data', color: DIM }];
  const cells: Cell[] = [{ text: m.market, color: MID }, { text: formatPrice(last), color: FG, bold: true, trend: m.trend }];
  if (m.dayChange !== undefined) cells.push({ text: formatChange(m.dayChange), color: MID });
  else if (m.dayVolume !== undefined) cells.push({ text: formatVolume(m.dayVolume), color: MID });
  return cells;
}

function cellFont(c: Cell, px: number): string {
  return font(px, c.bold);
}

/** Markets packed left to right, wrapping onto a new line when the next one doesn't fit in `width`. */
function flowLines(ctx: CanvasRenderingContext2D, items: MarketData[], width: number): Cell[][][] {
  const lines: Cell[][][] = [];
  let lineW = 0;
  for (const m of items) {
    const cells = marketCells(m);
    const w = cells.reduce((sum, c, i) => sum + cellWidth(ctx, c, LIST_PX, LIST_ARROW) + (i ? CELL_GAP : 0), 0);
    if (lines.length && lineW + ITEM_GAP + w <= width) {
      lines.at(-1)!.push(cells);
      lineW += ITEM_GAP + w;
    } else {
      lines.push([cells]);
      lineW = w;
    }
  }
  return lines;
}

/**
 * The markets that aren't charted. Under the charts they flow along each line,
 * wrapping as needed; `full` (no charts) gives one market per line in columns,
 * scaled to fill `r`, with a line graph of each market's candles to the right.
 */
function drawMarketList(ctx: CanvasRenderingContext2D, items: MarketData[], r: Rect, full: boolean): void {
  if (items.length === 0) return;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const x0 = r.x + 6;
  /** Draws `c` at `x` (its right edge, if right-aligned; the arrow goes after it either way), and returns its width. */
  const draw = (c: Cell, x: number, cy: number, px: number, scale = 1) => {
    ctx.font = cellFont(c, px);
    ctx.fillStyle = c.color;
    ctx.fillText(c.text, x, cy);
    const w = ctx.measureText(c.text).width;
    if (c.trend) drawArrow(ctx, (ctx.textAlign === 'right' ? x : x + w) + ARROW_GAP, cy, px, c.trend, c.color, scale);
    return w + (c.trend ? ARROW_GAP + arrowWidth(px, scale) : 0);
  };

  if (!full) {
    let y = r.y + 4;
    for (const line of flowLines(ctx, items, r.w - 12)) {
      const cy = y + LIST_LINE_H / 2 + 1;
      let x = x0;
      for (const cells of line) {
        for (const c of cells) x += draw(c, x, cy, LIST_PX, LIST_ARROW) + CELL_GAP;
        x += ITEM_GAP - CELL_GAP;
      }
      y += LIST_LINE_H;
    }
    ctx.restore();
    return;
  }

  const lineH = Math.min(40, Math.floor((r.h - 8) / items.length));
  const px = Math.max(13, Math.min(24, Math.round(lineH * 0.6)));
  const gap = 24;
  const rows = items.map(marketCells);
  // Columns: name left-aligned, price right-aligned, volume left-aligned beside it.
  const colW = (i: number) => Math.max(...rows.map((row) => {
    if (!row[i] || (i > 0 && row[1]!.color === DIM)) return 0; // Errors span the columns.
    ctx.font = cellFont(row[i]!, px);
    return ctx.measureText(row[i]!.text).width;
  }));
  const priceR = x0 + colW(0) + gap + colW(1);
  // Room after the prices for their arrows, if any has one.
  const arrowW = rows.some((row) => row[1]!.trend) ? ARROW_GAP + arrowWidth(px) : 0;
  const graphX = priceR + arrowW + gap / 2 + colW(2) + gap;
  const graphW = r.x + r.w - 6 - graphX;
  let y = r.y + Math.round((r.h - items.length * lineH) / 2);
  for (const [i, row] of rows.entries()) {
    const cy = y + lineH / 2 + 1;
    if (graphW >= 40) drawLineGraph(ctx, items[i]!.candles, { x: graphX, y: y + 3, w: graphW, h: lineH - 6 });
    draw(row[0]!, x0, cy, px);
    if (row[1]!.color === DIM) {
      draw(row[1]!, x0 + colW(0) + gap, cy, px);
    } else {
      ctx.textAlign = 'right';
      draw(row[1]!, priceR, cy, px);
      ctx.textAlign = 'left';
      if (row[2]) draw(row[2], priceR + arrowW + gap / 2, cy, px);
    }
    y += lineH;
  }
  ctx.restore();
}

/** Closes as an unlabelled line across `r`, bright if the price ended up, dimmer if down. */
function drawLineGraph(ctx: CanvasRenderingContext2D, candles: Candle[], r: Rect): void {
  if (candles.length < 2) return;
  const closes = candles.map((c) => c.close);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const t0 = candles[0]!.time, t1 = candles.at(-1)!.time;
  ctx.save();
  ctx.strokeStyle = closes.at(-1)! >= closes[0]! ? FG : MID;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  candles.forEach((c, i) => {
    const x = r.x + (c.time - t0) / (t1 - t0) * r.w;
    const y = hi === lo ? r.y + r.h / 2 : r.y + (hi - c.close) / (hi - lo) * r.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

export function formatPrice(p: number): string {
  const abs = Math.abs(p);
  const digits = abs >= 10000 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return p.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A 24h change, signed: "+12.3%", "−4.0%". */
export function formatChange(f: number): string {
  const pct = f * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%`;
}

export function formatVolume(v: number): string {
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
