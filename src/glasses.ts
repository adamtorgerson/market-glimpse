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
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import type { Vec } from './lookup';
import type { Tile } from './png';

const CAPTURE_ID = 1;
const CAPTURE_NAME = 'capture';
const LABEL_ID = 2;
const LABEL_NAME = 'label';
const TILE_ID_BASE = 3;
// Corner text on the loading screen: app name, data source, time.
const CORNER_ID_BASE = 7;
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

/** What the loading screen shows: a centred message plus three corners. */
export interface LoadingScreen {
  message: string;
  topLeft: string;
  bottomLeft: string;
  bottomRight: string;
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
  /** The screen `loading` last put up, kept behind the tiles by `show`. */
  private loadingScreen: LoadingScreen | null = null;
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
      if (type === OsEventTypeList.SYSTEM_EXIT_EVENT || type === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
        // Our page is gone; recreate it on the next draw.
        this.pageCreated = false;
      }
    });
  }

  blank(): Promise<void> {
    return this.serial(() => this.setPage([], []));
  }

  loading(screen: LoadingScreen): Promise<void> {
    this.loadingScreen = screen;
    return this.serial(() => this.setPage([], [], screen));
  }

  /** Just a centred message, e.g. calibration prompts. */
  message(text: string): Promise<void> {
    return this.serial(() => this.setPage([], [], { message: text, topLeft: '', bottomLeft: '', bottomRight: '' }));
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

  /** `keepLoading`: leave the loading screen behind the tiles, so it stays up until they cover it. */
  show(tiles: Tile[], keepLoading = false): Promise<void> {
    return this.serial(async () => {
      const images = tiles.map((t, i) => new ImageContainerProperty({
        xPosition: t.x,
        yPosition: t.y,
        width: t.w,
        height: t.h,
        containerID: TILE_ID_BASE + i,
        containerName: `tile-${i}`,
        // In front of the loading screen's text (z 0–4).
        zOrderIndex: 5 + i,
      }));
      await this.setPage(images, tiles, keepLoading ? this.loadingScreen ?? undefined : undefined);
    });
  }

  private async setPage(images: ImageContainerProperty[], tiles: Tile[], screen?: LoadingScreen): Promise<void> {
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
    const texts = [capture];
    if (screen) {
      // Text renders from each container's top-left, so containers are placed
      // by the text's estimated width to centre or right-align it.
      const widthOf = (t: string) => Math.ceil(t.length * LABEL_CHAR_W);
      const corners: [string, number, number][] = [
        [screen.topLeft, CORNER_PAD, 0],
        [screen.bottomLeft, CORNER_PAD, 288 - CORNER_H],
        [screen.bottomRight, 576 - CORNER_PAD - widthOf(screen.bottomRight), 288 - CORNER_H],
      ];
      corners.forEach(([text, x, y], i) => {
        if (!text) return;
        texts.push(new TextContainerProperty({
          xPosition: Math.max(0, x),
          yPosition: y,
          width: Math.min(576 - Math.max(0, x), widthOf(text) + 20),
          height: CORNER_H,
          containerID: CORNER_ID_BASE + i,
          containerName: `corner-${i}`,
          content: text,
          isEventCapture: 0,
          zOrderIndex: 1 + i,
        }));
      });
      texts.push(new TextContainerProperty({
        xPosition: Math.round(288 - widthOf(screen.message) / 2),
        yPosition: LABEL_Y,
        width: LABEL_W,
        height: LABEL_H,
        containerID: LABEL_ID,
        containerName: LABEL_NAME,
        content: screen.message,
        isEventCapture: 0,
        zOrderIndex: 4,
      }));
    }
    const fields = {
      containerTotalNum: texts.length + images.length,
      textObject: texts,
      ...(images.length ? { imageObject: images } : {}),
    };

    if (!this.pageCreated) {
      const res = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(fields));
      // A startup page may already exist (e.g. after a WebView reload); fall back to rebuild.
      this.pageCreated = res === StartUpPageCreateResult.success || (await this.bridge.rebuildPageContainer(new RebuildPageContainer(fields)));
      if (!this.pageCreated) throw new Error(`Could not create glasses page (${res})`);
    } else if (!(await this.bridge.rebuildPageContainer(new RebuildPageContainer(fields)))) {
      throw new Error('Could not rebuild glasses page');
    }

    // Each tile shows as soon as it lands, and there's no way to hold them back
    // and reveal all four together: a page takes at most 4 images, text
    // containers have no background to cover them, and a rebuild clears them.
    // So send all four at once rather than waiting for each to be
    // acknowledged, to keep the gap between the first and last tile short.
    // Any the bridge rejects are retried one at a time.
    const upload = (i: number) => this.bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: TILE_ID_BASE + i,
      containerName: `tile-${i}`,
      imageData: tiles[i]!.png,
    }));
    const results = await Promise.all(tiles.map((_, i) => upload(i).catch(() => null)));
    for (let i = 0; i < tiles.length; i++) {
      if (results[i] !== null && ImageRawDataUpdateResult.isSuccess(results[i]!)) continue;
      const res = await upload(i);
      if (!ImageRawDataUpdateResult.isSuccess(res)) throw new Error(`Image upload failed: ${res}`);
    }
  }

  /** Bridge page operations must not interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
}
