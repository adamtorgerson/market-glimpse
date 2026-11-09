/**
 * Rules for every public API this app calls:
 *  1. No more than one request every 1.5 seconds (per API).
 *  2. Group calls into as few requests as the API allows.
 *  3. When requesting history, request only as much as will be displayed.
 *
 * `PublicApi` enforces rule 1. Requests run one at a time, each starting at
 * least `MIN_GAP_MS` after the previous one started. Requests still waiting
 * when their signal aborts are dropped without being sent. A request not
 * answered within `REQUEST_TIMEOUT_MS` fails with "timed out", so an API that
 * hangs holds up the requests behind it for no longer than that. Rules 2 and
 * 3 are up to each source.
 */
import { byteSize, countNetwork } from '../traffic';

export const MIN_GAP_MS = 1500;
/** How long a request (sent to body read) may take before it fails. */
export const REQUEST_TIMEOUT_MS = 10_000;

export class PublicApi {
  private queue: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  /** Running average of response times (request sent to body parsed), in ms. */
  private responseMs = 500;

  constructor(private readonly base: string, private readonly minGapMs = MIN_GAP_MS, private readonly timeoutMs = REQUEST_TIMEOUT_MS) {}

  /** GET `path` and parse the JSON body. Network and HTTP errors reject. */
  get<T>(path: string, signal: AbortSignal): Promise<T> {
    return this.request(path, undefined, signal, (text) => JSON.parse(text) as T);
  }

  /**
   * GET `path` and return the body as text, for feeds that aren't JSON;
   * otherwise like `get`. Any `headers` must be ones the API's CORS preflight allows.
   */
  getText(path: string, signal: AbortSignal, headers?: Record<string, string>): Promise<string> {
    return this.request(path, undefined, signal, (text) => text, headers);
  }

  /** POST `body` as JSON to `path`, for APIs whose only multi-item endpoint is a POST; otherwise like `get`. */
  post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
    return this.request(path, JSON.stringify(body), signal, (text) => JSON.parse(text) as T);
  }

  private request<T>(path: string, payload: string | undefined, signal: AbortSignal, parse: (text: string) => T, headers?: Record<string, string>): Promise<T> {
    const run = this.queue.then(async () => {
      signal.throwIfAborted();
      await sleep(this.nextAt - Date.now(), signal);
      signal.throwIfAborted();
      const sent = Date.now();
      this.nextAt = sent + this.minGapMs;
      const url = this.base + path;
      // Stopped by the caller's signal, or by the timeout. WebKit rejects
      // either way with its own AbortError, whatever the reason given, so a
      // timeout is told apart by `timedOut`: as an AbortError it would be
      // taken for a cancellation (`isAbort`), and the update dropped.
      const ctrl = new AbortController();
      const stop = () => ctrl.abort(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, this.timeoutMs);
      let res: Response, bytes: Uint8Array;
      try {
        res = await fetch(url, payload === undefined
          ? { signal: ctrl.signal, cache: 'no-store', ...(headers && { headers }) }
          : { signal: ctrl.signal, cache: 'no-store', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        // Read as bytes to count them; headers aren't visible to the page, so
        // only the URL, any body sent and the (decompressed) body received are counted.
        bytes = new Uint8Array(await (res.ok ? res.arrayBuffer() : res.arrayBuffer().catch(() => new ArrayBuffer(0))));
      } catch (e) {
        throw timedOut && !signal.aborted ? new Error('timed out') : e;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      }
      countNetwork(byteSize(url) + byteSize(payload), bytes.length);
      const text = new TextDecoder().decode(bytes);
      if (!res.ok) throw new HttpError(res.status, text);
      const body = parse(text);
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
