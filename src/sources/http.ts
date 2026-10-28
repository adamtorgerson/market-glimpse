/**
 * Rules for every public API this app calls:
 *  1. No more than one request every 1.5 seconds (per API).
 *  2. Group calls into as few requests as the API allows.
 *  3. When requesting history, request only as much as will be displayed.
 *
 * `PublicApi` enforces rule 1. Requests run one at a time, each starting at
 * least `MIN_GAP_MS` after the previous one started. Requests still waiting
 * when their signal aborts are dropped without being sent. Rules 2 and 3 are
 * up to each source.
 */
import { byteSize, countNetwork } from '../traffic';

export const MIN_GAP_MS = 1500;

export class PublicApi {
  private queue: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  /** Running average of response times (request sent to body parsed), in ms. */
  private responseMs = 500;

  constructor(private readonly base: string, private readonly minGapMs = MIN_GAP_MS) {}

  /** GET `path` and parse the JSON body. Network and HTTP errors reject. */
  get<T>(path: string, signal: AbortSignal): Promise<T> {
    const run = this.queue.then(async () => {
      signal.throwIfAborted();
      await sleep(this.nextAt - Date.now(), signal);
      const sent = Date.now();
      this.nextAt = sent + this.minGapMs;
      const url = this.base + path;
      const res = await fetch(url, { signal, cache: 'no-store' });
      // Read as bytes to count them; headers aren't visible to the page, so
      // only the URL and the (decompressed) body are counted.
      const bytes = new Uint8Array(await (res.ok ? res.arrayBuffer() : res.arrayBuffer().catch(() => new ArrayBuffer(0))));
      countNetwork(byteSize(url), bytes.length);
      const text = new TextDecoder().decode(bytes);
      if (!res.ok) throw new HttpError(res.status, text);
      const body = JSON.parse(text) as T;
      this.responseMs = average(this.responseMs, Date.now() - sent);
      return body;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Rough ms for `n` requests made one after another from now: wait for the
   * rate limit to allow the first, then each starts once the previous one has
   * both been answered and is MIN_GAP_MS old.
   */
  estimateMs(n: number): number {
    if (n <= 0) return 0;
    const wait = Math.max(0, this.nextAt - Date.now());
    return wait + (n - 1) * Math.max(this.minGapMs, this.responseMs) + this.responseMs;
  }
}

/** A non-2xx response; `body` is kept so sources can tell e.g. "unknown market" apart. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`HTTP ${status}`);
  }
}

/** Exponential moving average, weighted towards recent samples. */
export function average(prev: number, sample: number): number {
  return prev * 0.7 + sample * 0.3;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    const t = setTimeout(done, ms);
    const abort = () => { clearTimeout(t); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function isAbort(e: unknown): boolean {
  return (e as Error)?.name === 'AbortError';
}

/** Short message for a failed request. */
export function describeError(e: unknown): string {
  // Some APIs omit CORS headers on error responses (Kraken), or send none at
  // all, so the browser reports a generic network failure.
  return e instanceof TypeError ? 'offline or blocked' : (e as Error).message || String(e);
}
