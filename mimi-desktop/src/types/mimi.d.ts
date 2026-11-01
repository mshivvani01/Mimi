export interface MimiAppInfo {
  name: string;
  version: string;
  platform: string;
}

// ---- Phase 01 monitoring types. Mirrors electron/monitor/types.ts (kept in sync by hand: the renderer never imports main-process code).
export type MonitorState = 'running' | 'paused' | 'idle' | 'asleep' | 'locked' | 'unsupported' | 'error' | 'stopped';
export type SegmentKind = 'active' | 'idle' | 'unknown';

export interface MonitorSettings {
  idleThresholdSec: number;
  dailyGoalMinutes: number;
  sampleIntervalSec: number;
  monitoringEnabled: boolean;
  keepRunningWhenClosed: boolean;
}
export interface DayTotals { date: string; activeMs: number; idleMs: number; unknownMs: number }
export interface AppTotal { appId: string; appName: string; activeMs: number }
export interface TimelineBlock { startTs: number; endTs: number; kind: SegmentKind; appName: string | null }

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

export interface MimiMonitorApi {
  getSnapshot: () => Promise<MonitorSnapshot>;
  setPaused: (paused: boolean) => Promise<MonitorSnapshot>;
  updateSettings: (patch: Partial<MonitorSettings>) => Promise<MonitorSnapshot>;
  getInsights: (days: number) => Promise<InsightsResult>;
  clearHistory: () => Promise<{ deleted: number }>;
  quitApp: () => Promise<boolean>;
}

declare global {
  interface Window {
    /** Present only inside Electron (exposed by electron/preload.ts). */
    mimi?: { getAppInfo: () => Promise<MimiAppInfo>; monitor?: MimiMonitorApi };
  }
}
