import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from '../src/lib/settings';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, data };
}

describe('settings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips saved values', () => {
    const s = memoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, breakReminderMinutes: 45 }, s);
    expect(loadSettings(s).breakReminderMinutes).toBe(45);
  });
  it('ignores corrupt or wrongly typed data', () => {
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: '{oops' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: '{"mascotVisible":"yes"}' })).mascotVisible).toBe(true);
  });
});
