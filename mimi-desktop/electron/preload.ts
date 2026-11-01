import { contextBridge, ipcRenderer } from 'electron';

// The only surface the renderer can reach: a fixed set of narrowly-scoped, validated-in-main invoke calls.
// There is no generic send/invoke passthrough, no SQL, and no filesystem access.
const CLEAR_CONFIRMATION = 'DELETE_ACTIVITY_HISTORY';

contextBridge.exposeInMainWorld('mimi', {
  getAppInfo: (): Promise<{ name: string; version: string; platform: string }> => ipcRenderer.invoke('mimi:get-app-info'),
  monitor: {
    getSnapshot: () => ipcRenderer.invoke('mimi:monitor:get-snapshot'),
    setPaused: (paused: boolean) => ipcRenderer.invoke('mimi:monitor:set-paused', paused),
    updateSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('mimi:monitor:update-settings', patch),
    getInsights: (days: number) => ipcRenderer.invoke('mimi:monitor:get-insights', days),
    clearHistory: () => ipcRenderer.invoke('mimi:monitor:clear-history', CLEAR_CONFIRMATION),
    quitApp: () => ipcRenderer.invoke('mimi:app:quit'),
  },
});
