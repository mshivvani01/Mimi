import type { SqlDb } from './sqlite';
import {
  DEFAULT_MONITOR_SETTINGS,
  type AppTotal,
  type MonitorSettings,
  type SegmentKind,
  type SegmentRecord,
  type SegmentStore,
  type TimelineBlock,
} from '../monitor/types';

export interface DayKindRow { local_date: string; kind: SegmentKind; total: number }

/** All SQL lives here, always parameterised. Implements the tracker's SegmentStore port. */
export class ActivityRepository implements SegmentStore {
  constructor(private readonly db: SqlDb) {}

  // ----- SegmentStore -----
  insertOpen(seg: SegmentRecord): number {
    return this.insert(seg, 1);
  }
  insertClosed(seg: SegmentRecord): number {
    return this.insert(seg, 0);
  }
  private insert(seg: SegmentRecord, open: 0 | 1): number {
    return this.db.run(
      `INSERT INTO activity_segments
         (kind, reason, app_id, app_name, start_ts, end_ts, duration_ms, local_date, tz_offset_min, is_open, recovered, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [seg.kind, seg.reason, seg.appId, seg.appName, seg.startTs, seg.endTs, seg.durationMs, seg.localDate, seg.tzOffsetMin, open, seg.runId],
    ).lastInsertRowid;
  }
  checkpoint(id: number, endTs: number, durationMs: number): void {
    this.db.run('UPDATE activity_segments SET end_ts = ?, duration_ms = ? WHERE id = ? AND is_open = 1', [endTs, durationMs, id]);
  }
  close(id: number, endTs: number, durationMs: number): void {
    this.db.run('UPDATE activity_segments SET end_ts = ?, duration_ms = ?, is_open = 0 WHERE id = ?', [endTs, durationMs, id]);
  }
  remove(id: number): void {
    this.db.run('DELETE FROM activity_segments WHERE id = ?', [id]);
  }

  // ----- crash recovery -----
  /**
   * Close segments left open by a crash / power loss. Their end is the last checkpoint already stored
   * (we never extend them, so no time is invented). Zero-length leftovers are removed.
   */
  recoverOpenSegments(): { recovered: number; removed: number } {
    return this.db.transaction(() => {
      const removed = this.db.run('DELETE FROM activity_segments WHERE is_open = 1 AND duration_ms <= 0').changes;
      const recovered = this.db.run('UPDATE activity_segments SET is_open = 0, recovered = 1 WHERE is_open = 1').changes;
      return { recovered, removed };
    });
  }

  // ----- aggregates (closed segments only; the service merges the live segment) -----
  dayKindTotals(fromDate: string, toDate: string): DayKindRow[] {
    return this.db.all<DayKindRow>(
      `SELECT local_date, kind, SUM(duration_ms) AS total FROM activity_segments
       WHERE is_open = 0 AND local_date BETWEEN ? AND ? GROUP BY local_date, kind`,
      [fromDate, toDate],
    );
  }
  appTotals(fromDate: string, toDate: string, limit = 50): AppTotal[] {
    return this.db
      .all<{ app_id: string; app_name: string; total: number }>(
        `SELECT app_id, MAX(app_name) AS app_name, SUM(duration_ms) AS total FROM activity_segments
         WHERE is_open = 0 AND kind = 'active' AND app_id IS NOT NULL AND local_date BETWEEN ? AND ?
         GROUP BY app_id ORDER BY total DESC LIMIT ?`,
        [fromDate, toDate, limit],
      )
      .map((r) => ({ appId: r.app_id, appName: r.app_name ?? r.app_id, activeMs: r.total }));
  }
  timeline(date: string, limit = 2000): TimelineBlock[] {
    return this.db
      .all<{ start_ts: number; end_ts: number; kind: SegmentKind; app_name: string | null }>(
        'SELECT start_ts, end_ts, kind, app_name FROM activity_segments WHERE is_open = 0 AND local_date = ? ORDER BY start_ts LIMIT ?',
        [date, limit],
      )
      .map((r) => ({ startTs: r.start_ts, endTs: r.end_ts, kind: r.kind, appName: r.app_name }));
  }
  countSegments(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity_segments')?.n ?? 0;
  }
  /** Delete all activity history (settings are kept). */
  clearHistory(): number {
    return this.db.transaction(() => this.db.run('DELETE FROM activity_segments').changes);
  }

  // ----- settings -----
  loadSettings(): MonitorSettings {
    const out: Record<string, unknown> = { ...DEFAULT_MONITOR_SETTINGS };
    for (const row of this.db.all<{ key: string; value: string }>('SELECT key, value FROM monitor_settings')) {
      if (!(row.key in DEFAULT_MONITOR_SETTINGS)) continue;
      try {
        const v = JSON.parse(row.value);
        if (typeof v === typeof (DEFAULT_MONITOR_SETTINGS as unknown as Record<string, unknown>)[row.key]) out[row.key] = v;
      } catch {
        /* ignore corrupt value; default stays */
      }
    }
    return out as unknown as MonitorSettings;
  }
  saveSettings(patch: Partial<MonitorSettings>): void {
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        this.db.run('INSERT INTO monitor_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
      }
    });
  }
}
