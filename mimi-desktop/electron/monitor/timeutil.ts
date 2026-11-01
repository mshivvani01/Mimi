import type { Clock } from './types';

export const systemClock: Clock = {
  wall: () => Date.now(),
  mono: () => performance.now(),
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date (YYYY-MM-DD) for an epoch-ms timestamp, using the current process time zone. */
export function localDateString(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Minutes east of UTC at that instant. */
export function tzOffsetMinutes(ts: number): number {
  return -new Date(ts).getTimezoneOffset() || 0;
}

/** Epoch ms of the next local midnight strictly after ts (DST-safe: built from calendar fields). */
export function nextLocalMidnight(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

/** The N local dates ending at (and including) the date of `ts`, oldest first. */
export function lastNLocalDates(ts: number, n: number): string[] {
  const d = new Date(ts);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(localDateString(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, 12).getTime()));
  }
  return out;
}
