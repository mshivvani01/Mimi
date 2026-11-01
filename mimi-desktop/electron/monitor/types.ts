/** Shared (main-process) types for the Phase 01 monitoring engine. No Electron imports: unit-testable. */

export type SegmentKind = 'active' | 'idle' | 'unknown';
/** Why a segment has its kind. 'none' for ordinary active time. */
export type SegmentReason = 'none' | 'input-idle' | 'detection-failed' | 'no-foreground' | 'unidentified-app';

export interface ForegroundApp {
  /** Normalised identifier, e.g. "chrome.exe" (lower-case executable name). Never a full path. */
  appId: string;
  /** Friendly display name, e.g. "Google Chrome". */
  appName: string;
}

export type Sample =
  | { ok: true; foreground: ForegroundApp | null; idleMs: number }
  | { ok: false; error: string };

export interface Clock {
  /** Wall-clock epoch milliseconds (can jump: NTP, manual change, DST is not a jump). */
  wall(): number;
  /** Monotonic milliseconds from an arbitrary origin (never goes backwards). */
  mono(): number;
}

export interface SegmentRecord {
  kind: SegmentKind;
  reason: SegmentReason;
  appId: string | null;
  appName: string | null;
  startTs: number;
  endTs: number;
  durationMs: number;
  localDate: string; // YYYY-MM-DD (local calendar date of startTs)
  tzOffsetMin: number; // minutes east of UTC at startTs
  runId: string;
}

/** Persistence port used by the tracker. Implemented by the SQLite repository; mocked in tests. */
export interface SegmentStore {
  insertOpen(seg: SegmentRecord): number;
  checkpoint(id: number, endTs: number, durationMs: number): void;
  close(id: number, endTs: number, durationMs: number): void;
  remove(id: number): void;
  insertClosed(seg: SegmentRecord): number;
}

export interface TrackerConfig {
  idleThresholdMs: number;
  /** A gap between samples larger than this is never credited (process stall / undetected sleep). */
  maxGapMs: number;
  /** How often the open segment's end/duration is written to disk (crash-recovery granularity). */
  checkpointMs: number;
  /** wall-vs-monotonic disagreement above this means the system clock was changed. */
  clockJumpToleranceMs: number;
  /** Consecutive failed samples before the interval is recorded as "unknown". */
  failureThreshold: number;
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  idleThresholdMs: 60_000,
  maxGapMs: 15_000,
  checkpointMs: 15_000,
  clockJumpToleranceMs: 5_000,
  failureThreshold: 3,
};

export type MonitorState =
  | 'running' // sampling and recording
  | 'paused' // user paused
  | 'idle' // running, user input idle beyond threshold
  | 'asleep'
  | 'locked'
  | 'unsupported' // not Windows / native API could not be loaded
  | 'error' // database unavailable
  | 'stopped';

export interface MonitorSettings {
  idleThresholdSec: number;
  dailyGoalMinutes: number;
  sampleIntervalSec: number;
  monitoringEnabled: boolean;
  keepRunningWhenClosed: boolean;
}

export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
  idleThresholdSec: 60,
  dailyGoalMinutes: 240,
  sampleIntervalSec: 3,
  monitoringEnabled: true,
  keepRunningWhenClosed: true,
};

export interface DayTotals {
  date: string;
  activeMs: number;
  idleMs: number;
  unknownMs: number;
}
export interface AppTotal {
  appId: string;
  appName: string;
  activeMs: number;
}
export interface TimelineBlock {
  startTs: number;
  endTs: number;
  kind: SegmentKind;
  appName: string | null;
}

export interface MonitorSnapshot {
  state: MonitorState;
  stateDetail: string | null;
  currentApp: { appId: string; appName: string } | null;
  today: DayTotals;
  goalMs: number;
  settings: MonitorSettings;
  database: { ok: boolean; message: string | null; recoveredFromCorruption: boolean };
  unsavedSegments: number;
  droppedSegments: number;
  generatedAt: number;
}

export interface InsightsResult {
  days: DayTotals[];
  apps: AppTotal[];
  timeline: TimelineBlock[];
  timelineDate: string;
  hasAnyData: boolean;
}
