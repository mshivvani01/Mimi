export interface MimiSettings {
  breakReminderMinutes: number;
  waterReminderMinutes: number;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  mascotVisible: boolean;
  launchAtStartup: boolean;
}

export const DEFAULT_SETTINGS: MimiSettings = {
  breakReminderMinutes: 30,
  waterReminderMinutes: 60,
  quietHoursEnabled: true,
  quietStart: '22:00',
  quietEnd: '07:00',
  mascotVisible: true,
  launchAtStartup: false,
};

export const SETTINGS_KEY = 'mimi.settings.v1';

export function loadSettings(storage: Pick<Storage, 'getItem'> = window.localStorage): MimiSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<MimiSettings>;
    const merged = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof MimiSettings)[]) {
      if (typeof parsed[key] === typeof DEFAULT_SETTINGS[key]) merged[key] = parsed[key];
    }
    return merged as unknown as MimiSettings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: MimiSettings, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings stay in memory for this session */
  }
}
