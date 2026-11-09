import type { Hlc } from './model';

// "<ms, 15 digits>-<counter, 6 hex>-<deviceId>": fixed-width parts make string order equal clock order.
const MS_WIDTH = 15;
const COUNTER_WIDTH = 6;

function parse(h: Hlc): { ms: number; counter: number } {
  return {
    ms: Number(h.slice(0, MS_WIDTH)),
    counter: parseInt(h.slice(MS_WIDTH + 1, MS_WIDTH + 1 + COUNTER_WIDTH), 16),
  };
}

function format(ms: number, counter: number, deviceId: string): Hlc {
  return `${String(ms).padStart(MS_WIDTH, '0')}-${counter.toString(16).padStart(COUNTER_WIDTH, '0')}-${deviceId}`;
}

/** Next clock value for a local write. Never goes backwards, even if `now` does. */
export function tick(prev: Hlc | null, now: number, deviceId: string): Hlc {
  if (prev === null) return format(now, 0, deviceId);
  const p = parse(prev);
  return now > p.ms ? format(now, 0, deviceId) : format(p.ms, p.counter + 1, deviceId);
}

/** Advance the local clock past a clock seen in a remote op. */
export function observe(local: Hlc | null, remote: Hlc): Hlc {
  return local !== null && local > remote ? local : remote;
}
