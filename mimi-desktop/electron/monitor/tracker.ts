import {
  DEFAULT_TRACKER_CONFIG,
  type Clock,
  type ForegroundApp,
  type Sample,
  type SegmentKind,
  type SegmentReason,
  type SegmentRecord,
  type SegmentStore,
  type TrackerConfig,
} from './types';
import { localDateString, nextLocalMidnight, tzOffsetMinutes } from './timeutil';

interface OpenSegment {
  key: string;
  kind: SegmentKind;
  reason: SegmentReason;
  appId: string | null;
  appName: string | null;
  startWall: number;
  startMono: number;
  /** Monotonic time of the last sample that confirmed this state. Duration never extends past this on its own. */
  lastConfirmMono: number;
  lastCheckpointMono: number;
  localDate: string;
  tzOffsetMin: number;
  dbId: number | null;
}

type PendingOp =
  | { op: 'close'; id: number; endTs: number; durationMs: number }
  | { op: 'insertClosed'; rec: SegmentRecord };

const MAX_PENDING = 200;

/**
 * Turns periodic samples into non-overlapping, timestamped segments.
 *
 * Time rules:
 *  - Durations come from the monotonic clock; wall-clock time is only stored for display/reconstruction
 *    (endTs = startTs + durationMs, so stored rows are internally consistent even after a clock change).
 *  - A segment only extends to the last sample that confirmed it; a long gap between samples is never credited.
 *  - Idle time is attributed back to the last input (now - idleMs), never to active time.
 *  - Paused / locked / asleep intervals produce no rows at all (they are "not measured", not idle).
 *  - Segments are split at local midnight, and when the time zone offset or the system clock changes.
 */
export class ActivityTracker {
  private cur: OpenSegment | null = null;
  private lastSample: { mono: number; wall: number } | null = null;
  /** No new segment may start before this monotonic time (end of the previous segment / resume time). */
  private floorMono: number;
  private failures = 0;
  private firstFailureMono = 0;
  private paused = false;
  private asleep = false;
  private locked = false;
  private pending: PendingOp[] = [];
  private dropped = 0;

  constructor(
    private readonly store: SegmentStore,
    private readonly clock: Clock,
    private readonly runId: string,
    private cfg: TrackerConfig = DEFAULT_TRACKER_CONFIG,
  ) {
    this.floorMono = clock.mono();
  }

  // ---------- configuration / introspection ----------

  setConfig(patch: Partial<TrackerConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }
  get config(): TrackerConfig {
    return this.cfg;
  }
  get isPaused(): boolean {
    return this.paused;
  }
  get isAsleep(): boolean {
    return this.asleep;
  }
  get isLocked(): boolean {
    return this.locked;
  }
  get unsavedCount(): number {
    return this.pending.length + (this.cur && this.cur.dbId === null ? 1 : 0);
  }
  get droppedCount(): number {
    return this.dropped;
  }

  /** The in-progress segment (for live display). Duration only counts up to the last confirming sample. */
  currentLive(): {
    kind: SegmentKind;
    appId: string | null;
    appName: string | null;
    localDate: string;
    startTs: number;
    durationMs: number;
  } | null {
    const c = this.cur;
    if (!c) return null;
    return {
      kind: c.kind,
      appId: c.appId,
      appName: c.appName,
      localDate: c.localDate,
      startTs: c.startWall,
      durationMs: Math.max(0, c.lastConfirmMono - c.startMono),
    };
  }

  // ---------- sampling ----------

  sample(s: Sample): void {
    if (this.paused || this.asleep || this.locked) return;
    const mono = this.clock.mono();
    const wall = this.clock.wall();
    this.flushPending();

    // 1. Sanity checks on elapsed time since the previous sample.
    if (this.lastSample && this.cur) {
      const dm = mono - this.lastSample.mono;
      const dw = wall - this.lastSample.wall;
      if (dm > this.cfg.maxGapMs) {
        // Process stalled or the machine slept without us hearing about it: credit nothing for the gap.
        this.closeCur(this.cur.lastConfirmMono);
        this.floorMono = mono;
      } else if (Math.abs(dw - dm) > this.cfg.clockJumpToleranceMs) {
        // System clock changed. Close at the last confirmed monotonic point; the next segment gets fresh wall times.
        this.closeCur(this.cur.lastConfirmMono);
      }
    } else if (this.lastSample && !this.cur) {
      if (mono - this.lastSample.mono > this.cfg.maxGapMs) this.floorMono = Math.max(this.floorMono, mono);
    }
    if (this.cur && tzOffsetMinutes(wall) !== this.cur.tzOffsetMin) this.closeCur(this.cur.lastConfirmMono);
    this.splitAtMidnight(mono, wall);
    this.lastSample = { mono, wall };

    // 2. Native failure handling.
    if (!s.ok) {
      if (this.failures === 0) this.firstFailureMono = mono;
      this.failures++;
      if (this.failures >= this.cfg.failureThreshold && this.cur?.kind !== 'unknown') {
        const lastGood = this.cur ? this.cur.lastConfirmMono : this.floorMono;
        this.closeCur(Math.min(mono, lastGood));
        const start = Math.max(this.floorMono, Math.min(this.firstFailureMono, mono));
        this.open('unknown:detection-failed', 'unknown', 'detection-failed', null, start, mono, wall);
      } else if (this.cur?.kind === 'unknown') {
        this.confirm(mono);
      }
      return;
    }
    this.failures = 0;

    // 3. Classify.
    if (s.idleMs >= this.cfg.idleThresholdMs) {
      if (this.cur?.kind === 'idle') {
        this.confirm(mono);
        return;
      }
      // Idle began at the last input, but never before the current segment/floor, and never absurdly far back.
      const lastInput = mono - s.idleMs;
      const lower = Math.max(this.floorMono, this.cur ? this.cur.startMono : -Infinity);
      const idleStart = Math.min(mono, Math.max(lastInput, lower));
      this.closeCur(idleStart);
      this.open('idle', 'idle', 'input-idle', null, idleStart, mono, wall);
      return;
    }

    const key = keyFor(s.foreground);
    if (this.cur && this.cur.key === key) {
      this.confirm(mono);
      return;
    }
    // Active (or unknown/no-foreground) segment begins. Coming back from idle starts at the input moment.
    let boundary = mono;
    if (this.cur?.kind === 'idle') {
      boundary = Math.max(mono - s.idleMs, this.cur.startMono, mono - this.cfg.maxGapMs);
    }
    this.closeCur(boundary);
    const start = Math.max(boundary, this.floorMono);
    if (s.foreground) {
      const unidentified = s.foreground.appId === 'unidentified';
      this.open(key, 'active', unidentified ? 'unidentified-app' : 'none', s.foreground.appId, start, mono, wall, s.foreground);
    } else {
      this.open(key, 'unknown', 'no-foreground', null, start, mono, wall);
    }
  }

  // ---------- lifecycle events ----------

  pause(): void {
    this.endNow();
    this.paused = true;
  }
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.restartClockState();
  }
  suspend(): void {
    this.endNow();
    this.asleep = true;
  }
  resumeFromSleep(): void {
    this.asleep = false;
    this.restartClockState();
  }
  lock(): void {
    this.endNow();
    this.locked = true;
  }
  unlock(): void {
    this.locked = false;
    this.restartClockState();
  }
  /** App is quitting or monitoring is stopping: persist what we know, once. */
  stop(): void {
    this.endNow();
    this.flushPending();
  }
  /** Drop the in-progress segment and any queued writes without saving (used when history is cleared). */
  discardAll(): void {
    this.cur = null;
    this.pending = [];
    this.lastSample = null;
    this.floorMono = this.clock.mono();
  }

  // ---------- internals ----------

  private restartClockState(): void {
    this.lastSample = null;
    this.failures = 0;
    this.floorMono = this.clock.mono();
  }

  /** Close at "now", but never credit more than maxGap beyond the last confirming sample. */
  private endNow(): void {
    if (!this.cur) return;
    const mono = this.clock.mono();
    this.closeCur(Math.min(mono, this.cur.lastConfirmMono + this.cfg.maxGapMs));
  }

  private splitAtMidnight(mono: number, wall: number): void {
    // Loop: if the process was suspended-by-stall across several days, only the confirmed span is closed anyway.
    let guard = 0;
    while (this.cur && localDateString(wall) !== this.cur.localDate && guard++ < 4) {
      const c = this.cur;
      const midnightWall = nextLocalMidnight(c.startWall);
      const midnightMono = c.startMono + (midnightWall - c.startWall);
      if (midnightMono >= mono) break; // clock says another day but the monotonic span disagrees; wait for clock-jump logic
      const boundary = Math.max(c.startMono, Math.min(midnightMono, c.lastConfirmMono + this.cfg.maxGapMs));
      const { key, kind, reason, appId, appName } = c;
      this.closeCur(boundary);
      // Re-open the same state at the exact midnight so each row belongs to a single local date.
      const startMono = Math.max(boundary, this.floorMono);
      const startWall = midnightWall;
      this.cur = this.newSegment(key, kind, reason, appId, appName, startMono, startWall, mono);
      this.persistOpen(this.cur);
    }
  }

  private newSegment(
    key: string, kind: SegmentKind, reason: SegmentReason, appId: string | null, appName: string | null,
    startMono: number, startWall: number, nowMono: number,
  ): OpenSegment {
    return {
      key, kind, reason, appId, appName, startWall, startMono,
      lastConfirmMono: Math.max(startMono, nowMono),
      lastCheckpointMono: nowMono,
      localDate: localDateString(startWall),
      tzOffsetMin: tzOffsetMinutes(startWall),
      dbId: null,
    };
  }

  private open(
    key: string, kind: SegmentKind, reason: SegmentReason, appId: string | null, startMono: number,
    nowMono: number, nowWall: number, app?: ForegroundApp,
  ): void {
    const startWall = nowWall - (nowMono - startMono);
    this.cur = this.newSegment(key, kind, reason, appId, app?.appName ?? null, startMono, startWall, nowMono);
    this.persistOpen(this.cur);
  }

  private confirm(mono: number): void {
    const c = this.cur;
    if (!c) return;
    c.lastConfirmMono = Math.max(c.lastConfirmMono, mono);
    if (mono - c.lastCheckpointMono >= this.cfg.checkpointMs) {
      c.lastCheckpointMono = mono;
      this.checkpoint(c);
    }
  }

  private persistOpen(c: OpenSegment): void {
    try {
      const dur = Math.max(0, c.lastConfirmMono - c.startMono);
      c.dbId = this.store.insertOpen(this.toRecord(c, dur));
    } catch {
      c.dbId = null; // retried at the next checkpoint
    }
  }

  private checkpoint(c: OpenSegment): void {
    const dur = Math.max(0, c.lastConfirmMono - c.startMono);
    try {
      if (c.dbId === null) c.dbId = this.store.insertOpen(this.toRecord(c, dur));
      else this.store.checkpoint(c.dbId, c.startWall + dur, dur);
    } catch {
      /* stays in memory; next checkpoint retries */
    }
  }

  private closeCur(endMono: number): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    const dur = Math.max(0, endMono - c.startMono);
    this.floorMono = Math.max(this.floorMono, c.startMono + dur);
    if (dur <= 0) {
      if (c.dbId !== null) this.safe(() => this.store.remove(c.dbId as number), { op: 'close', id: c.dbId, endTs: c.startWall, durationMs: 0 });
      return;
    }
    const endTs = c.startWall + dur;
    if (c.dbId !== null) {
      const id = c.dbId;
      this.safe(() => this.store.close(id, endTs, dur), { op: 'close', id, endTs, durationMs: dur });
    } else {
      const rec = this.toRecord(c, dur);
      this.safe(() => void this.store.insertClosed(rec), { op: 'insertClosed', rec });
    }
  }

  private safe(fn: () => void, fallback: PendingOp): void {
    try {
      fn();
    } catch {
      this.enqueue(fallback);
    }
  }

  private enqueue(op: PendingOp): void {
    this.pending.push(op);
    while (this.pending.length > MAX_PENDING) {
      this.pending.shift();
      this.dropped++;
    }
  }

  private flushPending(): void {
    while (this.pending.length > 0) {
      const op = this.pending[0];
      try {
        if (op.op === 'close') {
          if (op.durationMs <= 0) this.store.remove(op.id);
          else this.store.close(op.id, op.endTs, op.durationMs);
        } else {
          this.store.insertClosed(op.rec);
        }
      } catch {
        return; // database still unavailable; keep the queue
      }
      this.pending.shift();
    }
  }

  private toRecord(c: OpenSegment, durationMs: number): SegmentRecord {
    return {
      kind: c.kind, reason: c.reason, appId: c.appId, appName: c.appName,
      startTs: c.startWall, endTs: c.startWall + durationMs, durationMs,
      localDate: c.localDate, tzOffsetMin: c.tzOffsetMin, runId: this.runId,
    };
  }
}

function keyFor(fg: ForegroundApp | null): string {
  return fg ? `active:${fg.appId}` : 'unknown:no-foreground';
}
