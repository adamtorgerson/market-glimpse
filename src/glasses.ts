import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  ImuReportPace,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import type { Vec } from './lookup';
import { toBase64, type Rect, type Tile } from './png';
import { textWidth } from './textchart';

const CAPTURE_ID = 1;
const CAPTURE_NAME = 'capture';
const LABEL_ID = 2;
const LABEL_NAME = 'label';
const TILE_ID_BASE = 3;
// Text-only pages (the text chart) use their own IDs from 1.
const TEXT_ID_BASE = 1;
// Corner text on the loading screen, in the order top-left, top-right, bottom-left, bottom-right.
const CORNER_ID_BASE = 7;
// The loading screen's market list, after the corners.
const LIST_ID_BASE = 11;
// Text renders from the container's top-left, so the box is placed to centre
// the message, using the glasses font's rough width per character
// ("Loading… ~4s" is ~118px in the simulator).
const LABEL_CHAR_W = 9.5;
const LABEL_Y = 130;
const LABEL_W = 200;
const LABEL_H = 30;
// Glyphs sit ~6px below a text container's top, and are ~21px tall.
const CORNER_PAD = 4;
const CORNER_H = 30;

/** What the loading screen shows: a message, any of four corners, and optionally a market list. */
export interface LoadingScreen {
  message: string;
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  /**
   * Full-width text containers (at most 2), e.g. names and prices at two
   * brightnesses. With a list, the message moves to the top-left corner,
   * and `topLeft` (e.g. the time) goes dim right after it.
   */
  list?: { y: number; h: number; color: number; content: string }[];
}

/** How long one image took to land, counted from when the batch was sent. */
export interface TileStat extends Rect {
  bytes: number;
  ms: number;
  /** Rejected when sent with the rest, then sent again on its own. */
  retried: boolean;
}

export interface UploadStats {
  /** How the image bytes cross the WebView bridge, or 'text' for a text-only page. */
  encoding: 'bytes' | 'text';
  ms: number;
  tiles: TileStat[];
}

/**
 * Thin wrapper over the Even Hub bridge.
 *
 * The page alternates between two layouts:
 *  - "blank": one empty text container. Nothing lit = display effectively off,
 *    while the app stays alive so the refresh timer keeps running.
 *  - "loading": the same, plus text containers for a centred message and
 *    three corners (app name, data source, time), shown while the chart is
 *    fetched, drawn and encoded.
 *  - "chart": up to 4 image tiles (each max 288x144) covering the 576x288 screen,
 *    plus the empty text container behind them to receive touch events. If
 *    the loading message was up, it stays behind the tiles until they cover it.
 */
export class Glasses {
  private pageCreated = false;
  /** Set once the app is closed on the glasses: nothing may be put on them after that. */
  private closed = false;
  /** The screen `loading` last put up, kept behind the tiles by `show`. */
  private loadingScreen: LoadingScreen | null = null;
  /** True while the page is the loading screen alone, so its list can be updated in place. */
  private loadingUp = false;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(readonly bridge: EvenAppBridge) {}

  /** Resolves to null when not running inside the Even app (e.g. a desktop browser). */
  static async connect(timeoutMs = 3000): Promise<Glasses | null> {
    // The SDK hands back a bridge even in a plain browser, so check for the host's
    // WebView handler, which the Even app (or simulator) may inject shortly after load.
    const deadline = Date.now() + timeoutMs;
    while (!(window as any).flutter_inappwebview?.callHandler) {
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
    const bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, deadline - Date.now()))),
    ]);
    return bridge ? new Glasses(bridge) : null;
  }

  /** Touchpad tap (any source). */
  onTap(cb: () => void): () => void {
    return this.bridge.onEvenHubEvent((e) => {
      const ev = e.textEvent ?? e.sysEvent ?? e.listEvent;
      if (!ev) return;
      // CLICK_EVENT is 0, which protobuf omits on the wire, so it can arrive as undefined.
      const type = ev.eventType ?? OsEventTypeList.CLICK_EVENT;
      if (type === OsEventTypeList.CLICK_EVENT) cb();
    });
  }

  /** The app was closed on the glasses (confirmed exit) or lost them (abnormal exit). */
  onExit(cb: () => void): () => void {
    return this.bridge.onEvenHubEvent((e) => {
      const type = e.sysEvent?.eventType;
      if (type !== OsEventTypeList.SYSTEM_EXIT_EVENT && type !== OsEventTypeList.ABNORMAL_EXIT_EVENT) return;
      // Our page is gone, and the host won't show another: creating one now
      // would put a blank page on the glasses that nothing can close.
      this.closed = true;
      cb();
    });
  }

  /** Touchpad double tap. */
  onDoubleTap(cb: () => void): () => void {
    return this.bridge.onEvenHubEvent((e) => {
      const ev = e.textEvent ?? e.sysEvent ?? e.listEvent;
      if (ev?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) cb();
    });
  }

  /**
   * Leave the app. Mode 1 asks the wearer to confirm on the glasses, as Even
   * Hub review requires for a double tap on the root page; the host then
   * closes the phone-side WebView.
   */
  exit(): Promise<boolean> {
    return this.bridge.shutDownPageContainer(1);
  }

  blank(): Promise<void> {
    return this.serial(() => this.setPage([]));
  }

  loading(screen: LoadingScreen): Promise<void> {
    this.loadingScreen = screen;
    return this.serial(async () => {
      await this.setPage([], screen);
      this.loadingUp = true;
    });
  }

  /**
   * Rewrite the loading screen's list in place, without a page rebuild, if
   * the loading screen is still up and the list keeps its layout. A chart
   * that goes up afterwards keeps the new list behind its tiles.
   */
  updateLoadingList(list: NonNullable<LoadingScreen['list']>): Promise<void> {
    const prev = this.loadingScreen;
    if (!prev?.list || list.length !== prev.list.length || list.some((b, i) => b.y !== prev.list![i]!.y || b.h !== prev.list![i]!.h)) {
      return Promise.resolve();
    }
    this.loadingScreen = { ...prev, list };
    return this.serial(async () => {
      if (!this.loadingUp) return;
      await Promise.all(list.map((b, i) => b.content === prev.list![i]!.content ? true : this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: LIST_ID_BASE + i,
        containerName: `list-${i}`,
        content: b.content || ' ',
      }))));
    });
  }

  /** Just a centred message, e.g. calibration prompts. */
  message(text: string): Promise<void> {
    return this.serial(() => this.setPage([], { message: text, topLeft: '', topRight: '', bottomLeft: '', bottomRight: '' }));
  }

  /** Start or stop the glasses' motion-sensor (IMU) readings. */
  async setImu(on: boolean): Promise<void> {
    if (!(await this.bridge.imuControl(on, ImuReportPace.P500))) throw new Error('Could not switch the motion sensor');
  }

  onImu(cb: (v: Vec) => void): () => void {
    return this.bridge.onEvenHubEvent((e) => {
      const d = e.sysEvent?.eventType === OsEventTypeList.IMU_DATA_REPORT ? e.sysEvent.imuData : undefined;
      if (d) cb([d.x ?? 0, d.y ?? 0, d.z ?? 0]);
    });
  }

  /**
   * `keepLoading`: leave the loading screen behind the tiles, so it stays up
   * until they cover it. The tiles must then include `loadingRects()`.
   */
  show(tiles: Tile[], keepLoading = false): Promise<UploadStats> {
    return this.serial(async () => {
      await this.setPage(tiles, keepLoading ? this.loadingScreen ?? undefined : undefined);
      return this.uploadTiles(tiles);
    });
  }

  /** Where the loading screen's text sits, for the chart's tiles to cover. */
  loadingRects(): Rect[] {
    return this.loadingScreen ? loadingTexts(this.loadingScreen).map(({ x, y, w, h }) => ({ x, y, w, h })) : [];
  }

  /** Run `fn` with nothing else drawing on the glasses, e.g. the speed test. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.serial(fn);
  }

  /** Put up empty image containers at `rects`, for `timeUpload`. Call within `exclusive`. */
  imagePage(rects: Rect[]): Promise<void> {
    return this.setPage(rects);
  }

  /** Send `data` to image container `i`, timed. Call within `exclusive`. */
  async timeUpload(i: number, data: Uint8Array, base64: boolean): Promise<{ ms: number; ok: boolean }> {
    const start = performance.now();
    const res = await this.sendImage(i, data, base64).catch(() => null);
    return { ms: performance.now() - start, ok: succeeded(res) };
  }

  /**
   * A page of only text containers (at most 8), e.g. the text chart, all
   * shown at once by one rebuild. The first receives touch events.
   */
  showText(boxes: { y: number; color: number; content: string }[]): Promise<UploadStats> {
    return this.serial(async () => {
      const start = performance.now();
      await this.applyPage({
        containerTotalNum: boxes.length,
        textObject: boxes.map((b, i) => new TextContainerProperty({
          xPosition: 0,
          yPosition: b.y,
          width: 576,
          height: 288 - b.y,
          containerID: TEXT_ID_BASE + i,
          containerName: `text-${i}`,
          content: b.content || ' ',
          textColor: b.color,
          isEventCapture: i === 0 ? 1 : 0,
          zOrderIndex: i,
        })),
      });
      const ms = performance.now() - start;
      const tiles = boxes.map((b) => ({ x: 0, y: b.y, w: 576, h: 288 - b.y, bytes: new TextEncoder().encode(b.content).length, ms, retried: false }));
      return { encoding: 'text' as const, ms, tiles };
    });
  }

  private async setPage(images: Rect[], screen?: LoadingScreen): Promise<void> {
    this.loadingUp = false;
    const capture = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      containerID: CAPTURE_ID,
      containerName: CAPTURE_NAME,
      content: ' ',
      isEventCapture: 1,
      zOrderIndex: 0,
    });
    const texts = [capture, ...(screen ? loadingTexts(screen) : []).map((t) => new TextContainerProperty({
      xPosition: t.x,
      yPosition: t.y,
      width: t.w,
      height: t.h,
      containerID: t.id,
      containerName: t.name,
      content: t.text,
      ...(t.color !== undefined ? { textColor: t.color } : {}),
      isEventCapture: 0,
      zOrderIndex: t.z,
    }))];
    const imageObject = images.map((r, i) => new ImageContainerProperty({
      xPosition: r.x,
      yPosition: r.y,
      width: r.w,
      height: r.h,
      containerID: TILE_ID_BASE + i,
      containerName: `tile-${i}`,
      // In front of the loading screen's text (z 0–7).
      zOrderIndex: 8 + i,
    }));
    await this.applyPage({
      containerTotalNum: texts.length + imageObject.length,
      textObject: texts,
      ...(imageObject.length ? { imageObject } : {}),
    });
  }

  private async applyPage(fields: ConstructorParameters<typeof RebuildPageContainer>[0]): Promise<void> {
    if (!this.pageCreated) {
      const res = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(fields));
      // A startup page may already exist (e.g. after a WebView reload); fall back to rebuild.
      this.pageCreated = res === StartUpPageCreateResult.success || (await this.bridge.rebuildPageContainer(new RebuildPageContainer(fields)));
      if (!this.pageCreated) throw new Error(`Could not create glasses page (${res})`);
    } else if (!(await this.bridge.rebuildPageContainer(new RebuildPageContainer(fields)))) {
      throw new Error('Could not rebuild glasses page');
    }
  }

  /**
   * Each tile shows as soon as it lands, and there's no way to hold them back
   * and reveal all four together: a page takes at most 4 images, text
   * containers have no background to cover them, and a rebuild clears them.
   * So send them all at once rather than waiting for each to be
   * acknowledged, to keep the gap between the first and last tile short.
   * Any the bridge rejects are retried one at a time.
   */
  private async uploadTiles(tiles: Tile[]): Promise<UploadStats> {
    const start = performance.now();
    const stats: TileStat[] = tiles.map(({ x, y, w, h, png }) => ({ x, y, w, h, bytes: png.length, ms: 0, retried: false }));
    const landed = (i: number, res: ImageRawDataUpdateResult | null) => {
      stats[i]!.ms = performance.now() - start;
      return succeeded(res);
    };
    const ok = await Promise.all(tiles.map((t, i) =>
      this.sendImage(i, t.png).catch(() => null).then((res) => landed(i, res))));
    for (let i = 0; i < tiles.length; i++) {
      if (ok[i]) continue;
      stats[i]!.retried = true;
      const res = await this.sendImage(i, tiles[i]!.png).catch(() => null);
      if (!landed(i, res)) throw new Error(`Image upload failed: ${res}`);
    }
    return { encoding: 'bytes', ms: performance.now() - start, tiles: stats };
  }

  /**
   * Image bytes cross the WebView bridge as JSON: a byte array becomes a list
   * of numbers (~3.6 characters per byte), base64 ~1.33. The Even app on the
   * phone rejects base64 (the simulator takes it), so it's only for the
   * speed test, to see if that changes.
   */
  private sendImage(i: number, data: Uint8Array, base64 = false): Promise<ImageRawDataUpdateResult> {
    return this.bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: TILE_ID_BASE + i,
      containerName: `tile-${i}`,
      imageData: base64 ? toBase64(data) : data,
    }));
  }

  /** Bridge page operations must not interleave, and none run once the app is closed. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const guarded = () => this.closed ? Promise.reject(new Error('App closed on the glasses')) : fn();
    const run = this.queue.then(guarded, guarded);
    this.queue = run.catch(() => {});
    return run;
  }
}

function succeeded(res: ImageRawDataUpdateResult | null): boolean {
  return res !== null && ImageRawDataUpdateResult.isSuccess(res);
}

/**
 * The loading screen's text containers: three corners, the message (centred,
 * or top-right above a list) and the list. Text renders from each container's
 * top-left, so containers are placed by the text's estimated width to centre
 * or right-align it.
 */
function loadingTexts(screen: LoadingScreen): (Rect & { text: string; id: number; name: string; z: number; color?: number })[] {
  const widthOf = (t: string) => Math.ceil(t.length * LABEL_CHAR_W);
  // Right-aligned by the font's measured widths, with slack so the text can't wrap.
  const rightX = (t: string) => 576 - CORNER_PAD - textWidth(t) - 6;
  const list = screen.list ?? [];
  const corners: [string, number, number][] = [
    // Beside the message when that's top-left.
    [screen.topLeft, list.length ? CORNER_PAD + textWidth(screen.message) + 15 : CORNER_PAD, 0],
    [screen.topRight, rightX(screen.topRight), 0],
    [screen.bottomLeft, CORNER_PAD, 288 - CORNER_H],
    [screen.bottomRight, rightX(screen.bottomRight), 288 - CORNER_H],
  ];
  const texts: ReturnType<typeof loadingTexts> = corners.flatMap(([text, x, y], i) => text ? [{
    x: Math.max(0, x),
    y,
    w: Math.min(576 - Math.max(0, x), textWidth(text) + 20),
    h: CORNER_H,
    text,
    id: CORNER_ID_BASE + i,
    name: `corner-${i}`,
    z: 1 + i,
    // Dim, as on the other screens: the time beside the message, and the app name.
    ...((i === 0 && list.length) || i === 3 ? { color: 0 } : {}),
  }] : []);
  texts.push({
    x: list.length ? CORNER_PAD : Math.round(288 - widthOf(screen.message) / 2),
    y: list.length ? 0 : LABEL_Y,
    w: list.length ? textWidth(screen.message) + 20 : LABEL_W,
    h: list.length ? CORNER_H : LABEL_H,
    text: screen.message,
    id: LABEL_ID,
    name: LABEL_NAME,
    z: 5,
  });
  list.forEach((b, i) => texts.push({ x: 0, y: b.y, w: 576, h: b.h, text: b.content || ' ', id: LIST_ID_BASE + i, name: `list-${i}`, z: 6 + i, color: b.color }));
  return texts;
}
