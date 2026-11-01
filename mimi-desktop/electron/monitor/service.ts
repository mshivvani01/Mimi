import { randomUUID } from 'node:crypto';
import { ActivityRepository } from '../db/repository';
import { buildDailySeries, mergeAppTotals } from './aggregate';
import { systemClock, lastNLocalDates, localDateString } from './timeutil';
import { ActivityTracker } from './tracker';
import { sanitizeStoredSettings, validateSettingsPatch } from './validation';
import type { Sampler } from './windows-sampler';
import {
  DEFAULT_MONITOR_SETTINGS,
  DEFAULT_TRACKER_CONFIG,
  type Clock,
  type InsightsResult,
  type MonitorSettings,
  type MonitorSnapshot,
  type MonitorState,
} from './types';

export interface DatabaseStatus { ok: boolean; message: string | null; recoveredFromCorruption: boolean }

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const realTimers: Timers = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.(); // never keeps the process alive by itself
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export interface ServiceOptions {
  repo: ActivityRepository | null; // null when the database could not be opened
  database: DatabaseStatus;
  sampler: Sampler;
  clock?: Clock;
  timers?: Timers;
  runId?: string;
}

/**
 * Owns the sampling loop, tracker and repository. Lives in the Electron main process and has no dependency on any
 * BrowserWindow, so closing the dashboard cannot stop it.
 */
export class MonitorService {
  readonly clock: Clock;
  private readonly timers: Timers;
  private readonly repo: ActivityRepository | null;
  private readonly tracker: ActivityTracker;
  private readonly sampler: Sampler;
  private readonly database: DatabaseStatus;
  private settings: MonitorSettings = { ...DEFAULT_MONITOR_SETTINGS };
  private timer: unknown = null;
  private running = false;
  private tickInFlight = false;
  private ticks = 0;
  private lastIdle = false;
  private lastError: string | null = null;
  private readonly noopStore = {
    insertOpen: () => { throw new Error('database unavailable'); },
    checkpoint: () => { throw new Error('database unavailable'); },
    close: () => { throw new Error('database unavailable'); },
    remove: () => { throw new Error('database unavailable'); },
    insertClosed: () => { throw new Error('database unavailable'); },
  };

  constructor(opts: ServiceOptions) {
    this.clock = opts.clock ?? systemClock;
    this.timers = opts.timers ?? realTimers;
    this.repo = opts.repo;
    this.sampler = opts.sampler;
    this.database = opts.database;
    if (this.repo) {
      try {
        this.settings = sanitizeStoredSettings(this.repo.loadSettings());
      } catch (e) {
        this.lastError = errMsg(e);
      }
    }
    this.tracker = new ActivityTracker(this.repo ?? this.noopStore, this.clock, opts.runId ?? randomUUID(), {
      ...DEFAULT_TRACKER_CONFIG,
      ...this.derivedConfig(),
    });
    // The tracker never caps the unsaved queue below MAX_PENDING; with no database nothing is recorded as active usage.
  }

  private derivedConfig() {
    const interval = this.settings.sampleIntervalSec * 1000;
    return { idleThresholdMs: this.settings.idleThresholdSec * 1000, maxGapMs: Math.max(15_000, interval * 4) };
  }

  /** Recover crashed sessions, then begin the single sampling loop (idempotent: a second call does nothing). */
  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.repo) {
      try {
        this.repo.recoverOpenSegments();
      } catch (e) {
        this.lastError = errMsg(e);
      }
    }
    if (!this.settings.monitoringEnabled) this.tracker.pause();
    this.schedule(0);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.tracker.stop();
  }

  get isRunning(): boolean {
    return this.running;
  }
  get tickCount(): number {
    return this.ticks;
  }

  private schedule(ms: number): void {
    if (!this.running || this.timer !== null) return; // never two loops
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.tick();
      this.schedule(this.settings.sampleIntervalSec * 1000);
    }, ms);
  }

  /** One sample. Exposed for deterministic tests; never throws. */
  tick(): void {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      this.ticks++;
      if (this.sampler.unavailableReason()) return; // nothing is recorded, nothing is invented
      const s = this.sampler.sample();
      this.tracker.sample(s);
      const live = this.tracker.currentLive();
      this.lastIdle = live?.kind === 'idle';
      this.lastError = s.ok ? null : s.error;
    } catch (e) {
      this.lastError = errMsg(e);
    } finally {
      this.tickInFlight = false;
    }
  }

  // ----- power / session events (wired by main.ts to Electron powerMonitor) -----
  onSuspend(): void { this.tracker.suspend(); }
  onResume(): void { this.tracker.resumeFromSleep(); }
  onLock(): void { this.tracker.lock(); }
  onUnlock(): void { this.tracker.unlock(); }

  // ----- user actions -----
  setPaused(paused: boolean): MonitorSnapshot {
    this.applyPatch({ monitoringEnabled: !paused });
    return this.getSnapshot();
  }

  updateSettings(rawPatch: unknown): MonitorSnapshot {
    this.applyPatch(validateSettingsPatch(rawPatch));
    return this.getSnapshot();
  }

  private applyPatch(patch: Partial<MonitorSettings>): void {
    if (this.repo) this.repo.saveSettings(patch); // throws on DB failure: setting is not applied unless it is saved
    this.settings = { ...this.settings, ...patch };
    this.tracker.setConfig(this.derivedConfig());
    if (patch.monitoringEnabled === false) this.tracker.pause();
    if (patch.monitoringEnabled === true) this.tracker.resume();
  }

  clearHistory(): { deleted: number } {
    if (!this.repo) throw new Error('database unavailable');
    this.tracker.discardAll();
    const deleted = this.repo.clearHistory();
    return { deleted };
  }

  // ----- reads -----
  getSettings(): MonitorSettings {
    return { ...this.settings };
  }

  private state(): { state: MonitorState; detail: string | null } {
    const unavailable = this.sampler.unavailableReason();
    if (!this.database.ok) return { state: 'error', detail: this.database.message };
    if (unavailable) return { state: 'unsupported', detail: unavailable };
    if (!this.running) return { state: 'stopped', detail: null };
    if (this.tracker.isPaused) return { state: 'paused', detail: null };
    if (this.tracker.isAsleep) return { state: 'asleep', detail: null };
    if (this.tracker.isLocked) return { state: 'locked', detail: null };
    if (this.lastIdle) return { state: 'idle', detail: null };
    return { state: 'running', detail: this.lastError };
  }

  getSnapshot(): MonitorSnapshot {
    const now = this.clock.wall();
    const today = localDateString(now);
    const live = this.tracker.currentLive();
    let rows: ReturnType<ActivityRepository['dayKindTotals']> = [];
    let dbMessage = this.database.message;
    let dbOk = this.database.ok;
    if (this.repo) {
      try {
        rows = this.repo.dayKindTotals(today, today);
      } catch (e) {
        dbOk = false;
        dbMessage = errMsg(e);
      }
    }
    const [day] = buildDailySeries([today], rows, live);
    const { state, detail } = this.state();
    return {
      state: dbOk ? state : 'error',
      stateDetail: dbOk ? detail : dbMessage,
      currentApp: live && live.kind === 'active' && live.appId ? { appId: live.appId, appName: live.appName ?? live.appId } : null,
      today: day,
      goalMs: this.settings.dailyGoalMinutes * 60_000,
      settings: { ...this.settings },
      database: { ok: dbOk, message: dbMessage, recoveredFromCorruption: this.database.recoveredFromCorruption },
      unsavedSegments: this.tracker.unsavedCount,
      droppedSegments: this.tracker.droppedCount,
      generatedAt: now,
    };
  }

  getInsights(days: number): InsightsResult {
    const now = this.clock.wall();
    const dates = lastNLocalDates(now, days);
    const today = dates[dates.length - 1];
    const live = this.tracker.currentLive();
    if (!this.repo) return { days: buildDailySeries(dates, [], null), apps: [], timeline: [], timelineDate: today, hasAnyData: false };
    const rows = this.repo.dayKindTotals(dates[0], today);
    const series = buildDailySeries(dates, rows, live);
    const apps = mergeAppTotals(this.repo.appTotals(dates[0], today), live, dates);
    const timeline = this.repo.timeline(today);
    if (live && live.localDate === today && live.durationMs > 0) {
      timeline.push({ startTs: live.startTs, endTs: live.startTs + live.durationMs, kind: live.kind, appName: live.appName });
    }
    const hasAnyData = series.some((d) => d.activeMs + d.idleMs + d.unknownMs > 0);
    return { days: series, apps, timeline, timelineDate: today, hasAnyData };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
