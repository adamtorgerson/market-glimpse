import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import type { Tile } from './png';

const CAPTURE_ID = 1;
const CAPTURE_NAME = 'capture';
const LABEL_ID = 2;
const LABEL_NAME = 'label';
const TILE_ID_BASE = 3;
// Text renders from the container's top-left, so the box is placed to centre
// "Loading…" (~80px wide) rather than centred itself.
const LABEL_X = 248;
const LABEL_Y = 130;
const LABEL_W = 120;
const LABEL_H = 30;

/**
 * Thin wrapper over the Even Hub bridge.
 *
 * The page alternates between two layouts:
 *  - "blank": one empty text container. Nothing lit = display effectively off,
 *    while the app stays alive so the refresh timer keeps running.
 *  - "loading": the same, plus a small centred text container with a message,
 *    shown while the chart is fetched, drawn and encoded.
 *  - "chart": up to 4 image tiles (each max 288x144) covering the 576x288 screen,
 *    in front of the loading message, plus the empty text container behind
 *    them to receive touch events.
 */
export class Glasses {
  private pageCreated = false;
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

  loading(message = 'Loading…'): Promise<void> {
    return this.serial(() => this.setPage([], [], message));
  }

  show(tiles: Tile[]): Promise<void> {
    return this.serial(async () => {
      const images = tiles.map((t, i) => new ImageContainerProperty({
        xPosition: t.x,
        yPosition: t.y,
        width: t.w,
        height: t.h,
        containerID: TILE_ID_BASE + i,
        containerName: `tile-${i}`,
        zOrderIndex: 2 + i,
      }));
      // Keep the loading message behind the tiles so it stays up until they cover it.
      await this.setPage(images, tiles, 'Loading…');
    });
  }

  private async setPage(images: ImageContainerProperty[], tiles: Tile[], message?: string): Promise<void> {
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
    if (message) {
      texts.push(new TextContainerProperty({
        xPosition: LABEL_X,
        yPosition: LABEL_Y,
        width: LABEL_W,
        height: LABEL_H,
        containerID: LABEL_ID,
        containerName: LABEL_NAME,
        content: message,
        isEventCapture: 0,
        zOrderIndex: 1,
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

    // The link is slow; send tiles one at a time. Each tile shows as soon as it
    // lands, and there's no way to hide them until all four are in: text
    // containers have no background to cover them, and a rebuild clears them.
    for (let i = 0; i < tiles.length; i++) {
      const res = await this.bridge.updateImageRawData(new ImageRawDataUpdate({
        containerID: TILE_ID_BASE + i,
        containerName: `tile-${i}`,
        imageData: tiles[i]!.png,
      }));
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
