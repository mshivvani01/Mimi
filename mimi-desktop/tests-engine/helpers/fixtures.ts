import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActivityRepository } from '../../electron/db/repository';
import { openDatabase, type SqlDb } from '../../electron/db/sqlite';
import { ActivityTracker } from '../../electron/monitor/tracker';
import { DEFAULT_TRACKER_CONFIG, type Clock, type ForegroundApp, type Sample, type TrackerConfig } from '../../electron/monitor/types';
import { openNodeSqlite } from './node-sqlite-adapter';

export const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'electron', 'db', 'migrations');

export class FakeClock implements Clock {
  constructor(public wallMs: number, public monoMs = 1_000_000) {}
  wall() { return this.wallMs; }
  mono() { return this.monoMs; }
  /** Normal passage of time: both clocks advance. */
  advance(ms: number) { this.wallMs += ms; this.monoMs += ms; }
  /** Wall clock changed by the user/NTP, monotonic unaffected. */
  jumpWall(ms: number) { this.wallMs += ms; }
  /** Machine slept: wall time passes, monotonic clock does not (worst case for a clock that excludes sleep). */
  sleepWithoutMono(ms: number) { this.wallMs += ms; }
}

export const CHROME: ForegroundApp = { appId: 'chrome.exe', appName: 'Google Chrome' };
export const CODE: ForegroundApp = { appId: 'code.exe', appName: 'Visual Studio Code' };
export const active = (fg: ForegroundApp | null, idleMs = 0): Sample => ({ ok: true, foreground: fg, idleMs });
export const failed: Sample = { ok: false, error: 'boom' };

export function tmpFile(name = 'mimi.db'): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'mimi-test-')), name);
}

export function freshDb(file = tmpFile()): { db: SqlDb; repo: ActivityRepository; file: string } {
  const r = openDatabase(file, MIGRATIONS_DIR, openNodeSqlite);
  if (!r.db) throw new Error(r.message ?? 'db open failed');
  return { db: r.db, repo: new ActivityRepository(r.db), file };
}

export function makeTracker(opts: { clock: FakeClock; cfg?: Partial<TrackerConfig>; file?: string }) {
  const { db, repo, file } = freshDb(opts.file);
  const tracker = new ActivityTracker(repo, opts.clock, 'test-run', { ...DEFAULT_TRACKER_CONFIG, ...opts.cfg });
  return { tracker, repo, db, file };
}

/** Local noon on a fixed date: far from any midnight/DST boundary. */
export const NOON = new Date(2026, 5, 10, 12, 0, 0, 0).getTime();
export const sec = (n: number) => n * 1000;
