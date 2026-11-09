import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicApi, describeError, isAbort } from '../../src/sources/http';

/**
 * A fetch that never answers, though it stops when its signal aborts: with
 * the signal's reason, as Chrome's does, or (`webkit`) with an AbortError of
 * its own whatever the reason, as WebKit's does.
 */
function hangingFetch(webkit = false): void {
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_, reject) => {
    init.signal!.addEventListener('abort', () => reject(webkit ? new DOMException('Fetch is aborted', 'AbortError') : init.signal!.reason), { once: true });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PublicApi', () => {
  it.each([false, true])('fails a request that hangs with "timed out", not as a cancellation, and goes on to the next (WebKit: %s)', async (webkit) => {
    vi.useFakeTimers();
    hangingFetch(webkit);
    const api = new PublicApi('https://example.com', 0, 1000);
    const signal = new AbortController().signal;
    const first = api.get('/a', signal).catch((e) => e);
    const second = api.get('/b', signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const e = await first;
    expect(isAbort(e)).toBe(false);
    expect(describeError(e)).toBe('timed out');
    await vi.advanceTimersByTimeAsync(1000);
    expect(describeError(await second)).toBe('timed out');
  });

  it.each([false, true])('still rejects as a cancellation when the caller aborts (WebKit: %s)', async (webkit) => {
    hangingFetch(webkit);
    const api = new PublicApi('https://example.com', 0, 60_000);
    const ctrl = new AbortController();
    const req = api.get('/a', ctrl.signal).catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));
    ctrl.abort();
    expect(isAbort(await req)).toBe(true);
  });
});
