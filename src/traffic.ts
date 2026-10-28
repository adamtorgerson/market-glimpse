/**
 * Bytes sent and received since launch, for the diagnostics: over the network
 * (counted by `PublicApi`) and to and from the glasses (counted at the WebView
 * bridge, which is as close to the glasses as the page can see; the Even app
 * re-encodes messages before they go over Bluetooth).
 */
export interface Counter {
  sent: number;
  received: number;
  /** Requests made, or messages to the host. */
  count: number;
}

export const traffic = {
  network: { sent: 0, received: 0, count: 0 } as Counter,
  glasses: { sent: 0, received: 0, count: 0 } as Counter,
};

let listener: (() => void) | null = null;

/** Call `cb` whenever a count changes. */
export function onTraffic(cb: () => void): void {
  listener = cb;
}

export function countNetwork(sent: number, received: number): void {
  traffic.network.sent += sent;
  traffic.network.received += received;
  traffic.network.count++;
  listener?.();
}

const encoder = new TextEncoder();

/** UTF-8 bytes of a bridge message: as is if a string, else as the JSON it crosses as. */
export function byteSize(v: unknown): number {
  if (v === undefined) return 0;
  return encoder.encode(typeof v === 'string' ? v : JSON.stringify(v) ?? '').length;
}

/**
 * Count what crosses the Even app's WebView bridge: calls out through the
 * host's `evenAppMessage` handler and their replies, and the messages (events)
 * the host pushes to `_listenEvenAppMessage`. Call once the SDK's bridge is
 * up, since it installs the latter.
 */
export function tapBridge(): void {
  const w = window as any;
  const host = w.flutter_inappwebview;
  if (host?.callHandler) {
    const call = host.callHandler.bind(host);
    host.callHandler = async (name: string, ...args: unknown[]) => {
      traffic.glasses.sent += byteSize(args.length === 1 ? args[0] : args);
      traffic.glasses.count++;
      listener?.();
      const reply = await call(name, ...args);
      traffic.glasses.received += byteSize(reply);
      listener?.();
      return reply;
    };
  }
  const push = w._listenEvenAppMessage;
  if (typeof push === 'function') {
    w._listenEvenAppMessage = (...args: unknown[]) => {
      traffic.glasses.received += byteSize(args.length === 1 ? args[0] : args);
      listener?.();
      return push(...args);
    };
  }
}
