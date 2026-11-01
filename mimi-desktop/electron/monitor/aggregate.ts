import type { AppTotal, DayTotals, SegmentKind } from './types';

export interface LiveSegment { kind: SegmentKind; appId: string | null; appName: string | null; localDate: string; durationMs: number }
export interface DayKindRow { local_date: string; kind: SegmentKind; total: number }

/** Build a complete, zero-filled day series from grouped rows, adding the in-progress segment on top. */
export function buildDailySeries(dates: string[], rows: DayKindRow[], live: LiveSegment | null): DayTotals[] {
  const map = new Map<string, DayTotals>(dates.map((d) => [d, { date: d, activeMs: 0, idleMs: 0, unknownMs: 0 }]));
  const add = (date: string, kind: SegmentKind, ms: number) => {
    const day = map.get(date);
    if (!day || !(ms > 0)) return;
    if (kind === 'active') day.activeMs += ms;
    else if (kind === 'idle') day.idleMs += ms;
    else day.unknownMs += ms;
  };
  for (const r of rows) add(r.local_date, r.kind, r.total);
  if (live) add(live.localDate, live.kind, live.durationMs);
  return dates.map((d) => map.get(d) as DayTotals);
}

/** Merge the live active segment into per-app totals, keep top `limit`. */
export function mergeAppTotals(rows: AppTotal[], live: LiveSegment | null, dates: string[], limit = 20): AppTotal[] {
  const map = new Map(rows.map((r) => [r.appId, { ...r }]));
  if (live && live.kind === 'active' && live.appId && dates.includes(live.localDate) && live.durationMs > 0) {
    const e = map.get(live.appId);
    if (e) e.activeMs += live.durationMs;
    else map.set(live.appId, { appId: live.appId, appName: live.appName ?? live.appId, activeMs: live.durationMs });
  }
  return [...map.values()].sort((a, b) => b.activeMs - a.activeMs).slice(0, limit);
}

/** Remaining time toward a goal; never negative. */
export function remainingMs(goalMs: number, activeMs: number): number {
  return Math.max(0, goalMs - activeMs);
}
