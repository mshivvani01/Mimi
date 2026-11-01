/** "1h 05m", "7m", "<1m", "0m". Never rounds a non-zero value up to look bigger. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function goalProgress(activeMs: number, goalMs: number): number {
  if (!(goalMs > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((activeMs / goalMs) * 100)));
}

export function weekdayShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
}

export const STATE_LABEL: Record<string, string> = {
  running: 'Monitoring',
  idle: 'Idle (no input)',
  paused: 'Paused by you',
  asleep: 'Computer asleep',
  locked: 'Screen locked',
  unsupported: 'Not available on this system',
  error: 'Database problem',
  stopped: 'Stopped',
};
