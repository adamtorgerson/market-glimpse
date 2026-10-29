/**
 * Prediction markets: one, two (stacked) or four (quadrants) charts of each
 * outcome's probability over time on a fixed 0–100% scale, ending at its
 * current price. The glasses have one colour, so the (up to four) lines
 * differ in brightness and dash; a legend on each chart, where it covers the
 * least of the lines, gives each line's price and name beside a sample of its
 * style. Outcomes left out are one more row, "Other", with no line.
 */
import { DIM, drawLogo, FAINT, FG, formatStamp, formatTime, layout, LOGO_INK, MID, SCREEN_H, SCREEN_W, timeTicks } from './chart';
import { cssFont, digitMid, digitTop } from './fonts';
import type { ChartFont } from './settings';
import type { PredictionData } from './sources/prediction';

export interface PredictionModel {
  /** 1, 2 or 4 events (3 stack). */
  charts: PredictionData[];
  /** Events not charted, listed under the charts: title, likeliest outcome and its probability. */
  ticker?: PredictionData[];
  /** Spacing of the history, in minutes. */
  interval: number;
  /** When the data was fetched: the right edge of the charts, and stamped at the top. */
  updated: Date;
  /** Data source name, shown at the top. */
  source: string;
  /** Must be loaded (`loadFont`) before rendering. */
  font: ChartFont;
}

/** Each outcome's line, in the event's order: brightest and solid first. */
const LINES = [
  { color: FG, dash: [] as number[] },
  { color: '#c0c0c0', dash: [8, 4] },
  { color: '#909090', dash: [2, 3] },
  { color: '#808080', dash: [8, 3, 2, 3] },
];

/** Pixels between history points. */
const PITCH = 3;
/** The list of events under the charts: its font size and line height, and the space between cells and between events. */
const LIST_PX = 13;
const LIST_LINE_H = 18;
const CELL_GAP = 5;
const ITEM_GAP = 18;
/** The time labels' row, between the charts and a list under them. */
const LABEL_ROW_H = 18;
const LOGO_W = LOGO_INK.right - LOGO_INK.left;
const LOGO_H = LOGO_INK.bottom - LOGO_INK.top;
/** The bottom row (time labels, corner text, logo) is centred on the logo. */
const ROW_CY = SCREEN_H - 2 - LOGO_H / 2;
/** Charts end this far above the screen's bottom, clear of the logo. */
const CHARTS_H = SCREEN_H - 2 - LOGO_H - 4;
/** Gridlines are 1px dots every GRID_STEP px: a sixth drawn. */
const GRID_STEP = 6;
/** Space kept clear of gridlines on each side of a line. */
const HALO = 5;
/** Lit plot pixels: anything brighter than the gridlines. */
const INK = 0x60;

interface Rect { x: number; y: number; w: number; h: number }

/** Sizes for a full-screen chart, or the smaller ones of 2 or 4. */
interface Style {
  pad: number;
  headerH: number;
  /** The percentage labels left of the plot. */
  axisW: number;
  title: number;
  small: number;
  pct: number;
  /** Legend rows, the box's padding, the line samples' length, and the longest name. */
  rowH: number;
  boxPad: number;
  swatch: number;
  nameMax: number;
  /** Least space between time labels. */
  tickPx: number;
}

const FULL: Style = { pad: 6, headerH: 26, axisW: 34, title: 17, small: 12, pct: 12, rowH: 17, boxPad: 5, swatch: 28, nameMax: 150, tickPx: 60 };
const COMPACT: Style = { pad: 4, headerH: 18, axisW: 28, title: 13, small: 10, pct: 10, rowH: 13, boxPad: 3, swatch: 20, nameMax: 90, tickPx: 48 };

/** Each chart's panel and plot, for `n` charts in the top `h` px. */
function panels(n: number, h = CHARTS_H): { r: Rect; plot: Rect; s: Style }[] {
  const s = n === 1 ? FULL : COMPACT;
  return layout(n, { x: 0, y: 0, w: SCREEN_W, h }).map((r) => {
    // A little space under each plot, before the next panel's header.
    const x = r.x + s.pad + s.axisW, y = r.y + s.headerH + 6;
    return { r, s, plot: { x, y, w: r.x + r.w - s.pad - x, h: r.y + r.h - (n === 1 ? 0 : 6) - y } };
  });
}

/** History points that fit across each of `n` charts, for `PredictionRequest.points`. */
export function predictionCapacity(n: number): number {
  return Math.floor(panels(n)[0]!.plot.w / PITCH) + 1;
}

export function renderPrediction(ctx: CanvasRenderingContext2D, model: PredictionModel): void {
  const font = (px: number, bold = false) => cssFont(model.font, px, bold);
  const n = model.charts.length;
  const s = n === 1 ? FULL : COMPACT;
  const small = font(s.small);
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.textBaseline = 'alphabetic';

  // Events not charted are listed along the bottom, as under the candle
  // charts, clear of the logo; the time labels go in a row of their own
  // between them and the charts. Without a list, the time labels share the
  // logo's row.
  const listFont = font(LIST_PX);
  ctx.font = listFont;
  const lines = flowEvents(ctx, model.ticker ?? [], SCREEN_W - 2 * s.pad - LOGO_W - 8, font);
  const listH = lines.length * LIST_LINE_H;
  const chartsH = listH ? SCREEN_H - 2 - listH - LABEL_ROW_H : CHARTS_H;
  const ps = panels(n, chartsH);
  lines.forEach((line, i) => {
    const y = Math.round(SCREEN_H - 2 - listH + i * LIST_LINE_H + LIST_LINE_H / 2 + digitMid(listFont));
    let x = s.pad;
    for (const cells of line) {
      for (const c of cells) {
        ctx.font = font(LIST_PX, c.bold);
        ctx.fillStyle = c.color;
        ctx.textAlign = 'left';
        ctx.fillText(c.text, x, y);
        x += ctx.measureText(c.text).width + CELL_GAP;
      }
      x += ITEM_GAP - CELL_GAP;
    }
  });

  // Bottom right: the logo, and beside one chart, its 24h volume (several
  // have theirs in their headers): in the time labels' row, if there's a list.
  const one = n === 1 ? model.charts[0]! : null;
  const rowY = listH ? Math.round(chartsH + 5 + digitTop(small)) : Math.round(ROW_CY + digitMid(small));
  drawLogo(ctx, SCREEN_W - s.pad, SCREEN_H - 2);
  let rowRight = listH ? SCREEN_W - s.pad : SCREEN_W - s.pad - LOGO_W - 6;
  if (one?.dayVolume !== undefined) {
    const vol = `24h vol $${compact(one.dayVolume)}`;
    ctx.font = small;
    ctx.fillStyle = DIM;
    ctx.textAlign = 'right';
    ctx.fillText(vol, rowRight, rowY);
    rowRight -= ctx.measureText(vol).width + 10;
  }

  // Every chart runs to the fetch on one time scale; the bottom row of
  // charts labels it.
  const intervalSec = model.interval * 60;
  const end = model.updated.getTime() / 1000;
  const lastSlot = Math.floor(end / intervalSec) * intervalSec;
  const ticks = timeTicks(lastSlot, predictionCapacity(n), intervalSec, PITCH, s.tickPx);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : intervalSec;
  const bottom = Math.max(...ps.map((p) => p.r.y + p.r.h));
  ctx.font = small;
  ctx.textAlign = 'center';
  for (const { r, plot } of ps.filter((p) => p.r.y + p.r.h === bottom)) {
    const axisY = plot.y + plot.h;
    for (const t of ticks) {
      const x = Math.round(plot.x + plot.w - (end - t) / intervalSec * PITCH);
      ctx.fillStyle = DIM;
      ctx.fillRect(x, axisY + 1, 1, 3);
      const label = formatTime(t, step, intervalSec >= 86400);
      const half = ctx.measureText(label).width / 2;
      if (x - half < r.x + s.pad || x + half > Math.min(rowRight, r.x + r.w + 10)) continue;
      ctx.fillStyle = MID;
      ctx.fillText(label, x, rowY);
    }
  }

  // The source and fetch time are always at the top, as on the candle
  // charts: the time in the top-left chart's header, the source in the
  // top-right's (one chart, or two stacked, have both: time, then source).
  const time = formatStamp(model.updated);
  model.charts.forEach((data, i) => {
    const { r, plot } = ps[i]!;
    const top = r.y === 0;
    const corner = [top && r.x === 0 ? time : '', top && r.x + r.w === SCREEN_W ? model.source : ''].filter(Boolean).join('  ');
    const vol = !one && data.dayVolume !== undefined ? `$${compact(data.dayVolume)}` : '';
    drawPanel(ctx, data, r, plot, s, font, end, intervalSec, vol, corner);
  });
  ctx.restore();
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  data: PredictionData,
  r: Rect,
  plot: Rect,
  s: Style,
  font: (px: number, bold?: boolean) => string,
  end: number,
  intervalSec: number,
  /** Right of the title: the 24h volume, if not shown elsewhere, then `corner` (the source and/or time). */
  vol: string,
  corner: string,
): void {
  const small = font(s.small), title = font(s.title, true), pct = font(s.pct, true);
  ctx.save();

  // Header: the question on the left; the volume (dim) and corner text on the right.
  const titleY = Math.round(r.y + s.headerH / 2 + digitMid(title));
  const smallY = Math.round(titleY - digitMid(title) + digitMid(small));
  ctx.font = small;
  ctx.textAlign = 'right';
  let right = r.x + r.w - s.pad;
  for (const [text, color] of [[corner, MID], [vol, DIM]] as const) {
    if (!text) continue;
    ctx.fillStyle = color;
    ctx.fillText(text, right, smallY);
    right -= ctx.measureText(text).width + 8;
  }
  const titleMax = right - 2 - r.x - s.pad;
  ctx.font = title;
  ctx.fillStyle = FG;
  ctx.textAlign = 'left';
  ctx.fillText(fit(ctx, data.title, titleMax), r.x + s.pad, titleY);

  if (data.error || data.outcomes.length === 0) {
    ctx.font = small;
    ctx.fillStyle = MID;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.error ?? 'no data', plot.x + plot.w / 2, plot.y + plot.h / 2);
    ctx.restore();
    return;
  }

  // 0–100%, gridlines every 25: the dimmest grey, a sixth drawn, so they stay behind the lines.
  const yOf = (p: number) => plot.y + (1 - p) * plot.h;
  const xOf = (t: number) => plot.x + plot.w - (end - t) / intervalSec * PITCH;
  ctx.font = small;
  ctx.textAlign = 'right';
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round(yOf(p));
    ctx.fillStyle = FAINT;
    for (let x = plot.x; x < plot.x + plot.w; x += GRID_STEP) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = DIM;
    ctx.fillText(`${p * 100}%`, plot.x - 4, Math.round(y + digitMid(small)));
  }

  // Lines, faintest first so the leading outcome is drawn on top. First a
  // black halo under every line, solid even under dashes, so the gridlines
  // stop short of the data; all halos before any line, so close lines don't
  // cut into each other.
  const outcomes = data.outcomes.map((o, i) => ({ o, style: LINES[i]! }));
  const trace = (o: (typeof outcomes)[number]['o']) => {
    ctx.beginPath();
    const points = [...o.history.filter((h) => h.time < end), { time: end, p: o.price }];
    points.forEach((h, i) => (i === 0 ? ctx.moveTo(xOf(h.time), yOf(h.p)) : ctx.lineTo(xOf(h.time), yOf(h.p))));
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y - 2, plot.w + 1, plot.h + 4);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2 + 2 * HALO;
  for (const { o } of outcomes) {
    trace(o);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (const { o, style } of [...outcomes].reverse()) {
    ctx.strokeStyle = style.color;
    ctx.setLineDash(style.dash);
    trace(o);
    ctx.stroke();
  }
  ctx.restore();

  // The legend, in the outcomes' order (likeliest first, a ladder's rungs in
  // order, a match's home, draw, away), then "Other": priced if exactly one
  // outcome can win, else just counted. A row is a sample of the line's
  // style, the price, the name, and its market's 24h volume, dim at the right.
  const rows: { name: string; price?: number; volume?: number; style?: (typeof LINES)[number] }[] = outcomes
    .map(({ o, style }) => ({ name: o.name, price: o.price, volume: o.dayVolume, style }));
  if (data.other) {
    const { count, price } = data.other;
    rows.push(price === undefined ? { name: `${count} more` } : { name: `${count} other${count === 1 ? '' : 's'}`, price });
  }
  ctx.font = pct;
  const pctW = Math.ceil(Math.max(...rows.map((row) => (row.price === undefined ? 0 : ctx.measureText(formatPct(row.price)).width))));
  ctx.font = small;
  const nameX = s.swatch + 5 + pctW + 5;
  const names = rows.map((row) => fit(ctx, row.name, s.nameMax));
  const vols = rows.map((row) => (row.volume === undefined ? '' : `$${compact(row.volume)}`));
  const volW = Math.ceil(Math.max(0, ...vols.map((v) => ctx.measureText(v).width)));
  const box = {
    w: Math.ceil(s.boxPad * 2 + nameX + Math.max(...names.map((name) => ctx.measureText(name).width)) + (volW ? 8 + volW : 0)),
    h: s.boxPad * 2 + rows.length * s.rowH - 4,
  };
  const at = emptiest(ctx, plot, box.w, box.h);

  ctx.fillStyle = '#000';
  ctx.fillRect(at.x, at.y, box.w, box.h);
  // Where it has to cover a line (small charts), an outline shows it's a key
  // on top, not a gap in the line.
  if (at.covered) {
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(at.x + 0.5, at.y + 0.5, box.w - 1, box.h - 1);
  }
  rows.forEach((row, k) => {
    const x = at.x + s.boxPad, cy = Math.round(at.y + s.boxPad + k * s.rowH + (s.rowH - 4) / 2);
    if (row.style) {
      ctx.strokeStyle = row.style.color;
      ctx.setLineDash(row.style.dash);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.lineTo(x + s.swatch, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.font = pct;
    ctx.fillStyle = row.style?.color ?? MID;
    ctx.textAlign = 'right';
    if (row.price !== undefined) ctx.fillText(formatPct(row.price), x + s.swatch + 5 + pctW, Math.round(cy + digitMid(pct)));
    ctx.font = small;
    ctx.fillStyle = row.style ? MID : DIM;
    ctx.textAlign = 'left';
    ctx.fillText(names[k]!, x + nameX, Math.round(cy + digitMid(small)));
    if (vols[k]) {
      ctx.fillStyle = DIM;
      ctx.textAlign = 'right';
      ctx.fillText(vols[k]!, at.x + box.w - s.boxPad, Math.round(cy + digitMid(small)));
    }
  });
  ctx.restore();
}

/**
 * Where a w×h box inside `plot` covers the fewest lit pixels of the lines
 * drawn so far (`covered` if any); on a tie, the topmost, then the leftmost.
 */
function emptiest(ctx: CanvasRenderingContext2D, plot: Rect, w: number, h: number): { x: number; y: number; covered: boolean } {
  const { x: px, y: py } = plot;
  const pw = Math.round(plot.w), ph = Math.round(plot.h);
  w = Math.min(w, pw);
  h = Math.min(h, ph);
  const img = ctx.getImageData(px, py, pw, ph).data;
  // Summed-area table of lit pixels, (pw+1)×(ph+1).
  const sum = new Uint32Array((pw + 1) * (ph + 1));
  for (let y = 0; y < ph; y++) {
    let row = 0;
    for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4;
      row += Math.max(img[i]!, img[i + 1]!, img[i + 2]!) > INK ? 1 : 0;
      sum[(y + 1) * (pw + 1) + x + 1] = sum[y * (pw + 1) + x + 1]! + row;
    }
  }
  const lit = (x: number, y: number) =>
    sum[(y + h) * (pw + 1) + x + w]! - sum[y * (pw + 1) + x + w]! - sum[(y + h) * (pw + 1) + x]! + sum[y * (pw + 1) + x]!;
  let best = { x: 0, y: 0, n: Infinity };
  for (let y = 0; y + h <= ph; y += 2) {
    for (let x = 0; x + w <= pw; x += 2) {
      const n = lit(x, y);
      if (n < best.n) best = { x, y, n };
    }
  }
  return { x: px + best.x, y: py + best.y, covered: best.n > 0 };
}

type Cell = { text: string; color: string; bold?: boolean };

/** An event under the charts: its title, then its likeliest outcome's probability and name, and its 24h volume; or its error. */
function eventCells(ctx: CanvasRenderingContext2D, d: PredictionData, font: (px: number, bold?: boolean) => string): Cell[] {
  ctx.font = font(LIST_PX);
  // Short, so two events fit on a line.
  const title: Cell = { text: fit(ctx, d.title, 90), color: MID };
  const leader = d.error ? undefined : [...d.outcomes].sort((a, b) => b.price - a.price)[0];
  if (!leader) return [title, { text: d.error ?? 'no data', color: DIM }];
  const cells: Cell[] = [title, { text: formatPct(leader.price), color: FG, bold: true }, { text: fit(ctx, leader.name, 64), color: MID }];
  if (d.dayVolume !== undefined) cells.push({ text: `$${compact(d.dayVolume)}`, color: DIM });
  return cells;
}

/** Events packed left to right, wrapping onto a new line when the next one doesn't fit in `width`. */
function flowEvents(ctx: CanvasRenderingContext2D, items: PredictionData[], width: number, font: (px: number, bold?: boolean) => string): Cell[][][] {
  const lines: Cell[][][] = [];
  let lineW = 0;
  for (const d of items) {
    const cells = eventCells(ctx, d, font);
    const w = cells.reduce((sum, c, i) => {
      ctx.font = font(LIST_PX, c.bold);
      return sum + ctx.measureText(c.text).width + (i ? CELL_GAP : 0);
    }, 0);
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

/** "49%", or "<1%" and ">99%" at the ends, where rounding would say a sure thing. */
function formatPct(p: number): string {
  const n = Math.round(p * 100);
  return n < 1 ? '<1%' : n > 99 ? '>99%' : `${n}%`;
}

function compact(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

/** `text`, cut short with "…" to fit `max` px in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** The full-screen list's rows: as many as Explore finds. */
const LIST_ROWS = 8;

/**
 * Prediction markets as a full-screen list, like the exchanges' market list:
 * one event per row, its title, its likeliest outcome (probability and name,
 * as in the text list),
 * its 24h volume, and a line plot of its top (up to 4)
 * outcomes over the period one chart would show, in the charts' line styles.
 * Each row is scaled to its own lines, as the market list's line graphs are,
 * so small moves show, in a faint box. The time top-left, the source top-right, the logo
 * bottom-right.
 */
export function renderPredictionList(ctx: CanvasRenderingContext2D, model: Omit<PredictionModel, 'charts'> & { items: PredictionData[] }): void {
  const font = (px: number, bold = false) => cssFont(model.font, px, bold);
  const small = font(12), name = font(14), pct = font(14, true), leaderFont = font(13);
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.textBaseline = 'alphabetic';

  const pad = 4;
  const headerH = 14;
  const headerY = Math.round(headerH / 2 + digitMid(small)) + 1;
  ctx.font = small;
  ctx.fillStyle = MID;
  ctx.textAlign = 'left';
  ctx.fillText(formatStamp(model.updated), pad, headerY);
  ctx.textAlign = 'right';
  ctx.fillText(model.source, SCREEN_W - pad, headerY);
  drawLogo(ctx, SCREEN_W - pad, SCREEN_H - 2);

  // Rows between the header and the logo, as on the market list.
  const top = headerH + 4, bottom = SCREEN_H - LOGO_H - 6;
  const rowH = Math.floor((bottom - top) / LIST_ROWS);
  // Title, then the leader: its probability right-aligned in a column wide
  // enough for any (">99%"), then its name; then the 24h volume,
  // right-aligned; the plot takes the rest.
  const titleW = 170, leaderW = 90;
  ctx.font = pct;
  const pctR = pad + titleW + 10 + Math.ceil(ctx.measureText('>99%').width);
  const leaderX = pctR + 6;
  ctx.font = small;
  const volR = leaderX + leaderW + 6 + Math.ceil(ctx.measureText('$888.8M').width);
  const plotX = volR + 10, plotW = SCREEN_W - pad - plotX;
  const end = model.updated.getTime() / 1000;
  const span = (predictionCapacity(1) - 1) * model.interval * 60;
  const xOf = (t: number) => plotX + plotW - (end - t) / span * plotW;

  model.items.slice(0, LIST_ROWS).forEach((d, row) => {
    const y = top + row * rowH;
    const cy = y + rowH / 2;
    ctx.font = name;
    ctx.fillStyle = MID;
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, d.title, titleW), pad, Math.round(cy + digitMid(name)));
    if (d.error || d.outcomes.length === 0) {
      ctx.font = small;
      ctx.fillStyle = DIM;
      ctx.fillText(d.error ?? 'no data', pad + titleW + 10, Math.round(cy + digitMid(small)));
      return;
    }
    const leader = [...d.outcomes].sort((a, b) => b.price - a.price)[0]!;
    ctx.font = pct;
    ctx.fillStyle = FG;
    ctx.textAlign = 'right';
    ctx.fillText(formatPct(leader.price), pctR, Math.round(cy + digitMid(pct)));
    ctx.font = leaderFont;
    ctx.fillStyle = MID;
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, leader.name, leaderW), leaderX, Math.round(cy + digitMid(leaderFont)));
    if (d.dayVolume !== undefined) {
      ctx.font = small;
      ctx.fillStyle = DIM;
      ctx.textAlign = 'right';
      ctx.fillText(`$${compact(d.dayVolume)}`, volR, Math.round(cy + digitMid(small)));
    }

    // Each outcome's history in the period, ending at its current price.
    const series = d.outcomes.map((o) => [...o.history.filter((h) => h.time > end - span && h.time < end), { time: end, p: o.price }]);
    const values = series.flat().map((h) => h.p);
    let lo = Math.min(...values), hi = Math.max(...values);
    // At least 10 points tall, so a flat row isn't noise blown up.
    if (hi - lo < 0.1) {
      const mid = (hi + lo) / 2;
      lo = Math.max(0, mid - 0.05);
      hi = Math.min(1, lo + 0.1);
      lo = hi - 0.1;
    }
    const plotTop = y + 3, plotH = rowH - 6;
    const yOf = (p: number) => plotTop + (hi - p) / (hi - lo) * plotH;
    // A faint box around the plot, just clear of its lines, setting each row's apart.
    ctx.strokeStyle = FAINT;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(plotX - 3 + 0.5, y + 1 + 0.5, plotW + 5, rowH - 3);
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, y + 1, plotW + 1, rowH - 2);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    // Faintest first, so the first outcome's line is on top; dashes scaled to the small plot.
    series.map((points, i) => ({ points, style: LINES[i]! })).reverse().forEach(({ points, style }) => {
      ctx.strokeStyle = style.color;
      ctx.setLineDash(style.dash.map((n) => Math.max(1, Math.round(n / 2))));
      ctx.beginPath();
      points.forEach((h, i) => (i === 0 ? ctx.moveTo(xOf(h.time), yOf(h.p)) : ctx.lineTo(xOf(h.time), yOf(h.p))));
      ctx.stroke();
    });
    ctx.restore();
  });
  ctx.restore();
}
