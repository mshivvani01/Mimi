import { DEFAULT_MONITOR_SETTINGS, type MonitorSettings } from './types';

export const LIMITS = {
  idleThresholdSec: { min: 10, max: 1800 },
  dailyGoalMinutes: { min: 15, max: 1440 },
  sampleIntervalSec: { min: 1, max: 30 },
  insightsDays: { min: 1, max: 90 },
} as const;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function int(name: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ValidationError(`${name} must be a whole number between ${min} and ${max}`);
  }
  return v;
}

/** Validate a settings patch from the renderer. Unknown keys and wrong types are rejected, not ignored. */
export function validateSettingsPatch(raw: unknown): Partial<MonitorSettings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ValidationError('settings patch must be an object');
  const out: Partial<MonitorSettings> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    switch (k) {
      case 'idleThresholdSec': out.idleThresholdSec = int(k, v, LIMITS.idleThresholdSec.min, LIMITS.idleThresholdSec.max); break;
      case 'dailyGoalMinutes': out.dailyGoalMinutes = int(k, v, LIMITS.dailyGoalMinutes.min, LIMITS.dailyGoalMinutes.max); break;
      case 'sampleIntervalSec': out.sampleIntervalSec = int(k, v, LIMITS.sampleIntervalSec.min, LIMITS.sampleIntervalSec.max); break;
      case 'monitoringEnabled':
      case 'keepRunningWhenClosed':
        if (typeof v !== 'boolean') throw new ValidationError(`${k} must be a boolean`);
        out[k] = v;
        break;
      default: throw new ValidationError(`unknown setting "${k}"`);
    }
  }
  if (Object.keys(out).length === 0) throw new ValidationError('settings patch is empty');
  return out;
}

/** Clamp values read back from disk so a hand-edited / corrupt row can never produce a nonsensical config. */
export function sanitizeStoredSettings(s: MonitorSettings): MonitorSettings {
  const clamp = (v: number, min: number, max: number, d: number) => (Number.isInteger(v) && v >= min && v <= max ? v : d);
  return {
    ...s,
    idleThresholdSec: clamp(s.idleThresholdSec, LIMITS.idleThresholdSec.min, LIMITS.idleThresholdSec.max, DEFAULT_MONITOR_SETTINGS.idleThresholdSec),
    dailyGoalMinutes: clamp(s.dailyGoalMinutes, LIMITS.dailyGoalMinutes.min, LIMITS.dailyGoalMinutes.max, DEFAULT_MONITOR_SETTINGS.dailyGoalMinutes),
    sampleIntervalSec: clamp(s.sampleIntervalSec, LIMITS.sampleIntervalSec.min, LIMITS.sampleIntervalSec.max, DEFAULT_MONITOR_SETTINGS.sampleIntervalSec),
  };
}

export function validateInsightsDays(raw: unknown): number {
  return int('days', raw, LIMITS.insightsDays.min, LIMITS.insightsDays.max);
}

export const CLEAR_CONFIRMATION = 'DELETE_ACTIVITY_HISTORY';
export function validateClearConfirmation(raw: unknown): void {
  if (raw !== CLEAR_CONFIRMATION) throw new ValidationError('missing clear-history confirmation');
}
