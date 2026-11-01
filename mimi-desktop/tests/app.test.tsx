import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';
import { greetingFor } from '../src/components/Dashboard';
import { formatDuration, goalProgress } from '../src/lib/format';
import type { InsightsResult, MimiMonitorApi, MonitorSnapshot } from '../src/types/mimi';

const day = (date: string, activeMs = 0, idleMs = 0) => ({ date, activeMs, idleMs, unknownMs: 0 });
function snapshot(over: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    state: 'running', stateDetail: null, currentApp: { appId: 'chrome.exe', appName: 'Google Chrome' },
    today: day('2026-06-10', 90 * 60_000, 5 * 60_000), goalMs: 240 * 60_000,
    settings: { idleThresholdSec: 60, dailyGoalMinutes: 240, sampleIntervalSec: 3, monitoringEnabled: true, keepRunningWhenClosed: true },
    database: { ok: true, message: null, recoveredFromCorruption: false }, unsavedSegments: 0, droppedSegments: 0, generatedAt: 0, ...over,
  };
}
function insights(over: Partial<InsightsResult> = {}): InsightsResult {
  return {
    days: [day('2026-06-09', 3600_000, 600_000), day('2026-06-10', 5400_000, 300_000)],
    apps: [{ appId: 'chrome.exe', appName: 'Google Chrome', activeMs: 7200_000 }, { appId: 'code.exe', appName: 'Visual Studio Code', activeMs: 1800_000 }],
    timeline: [{ startTs: new Date(2026, 5, 10, 9).getTime(), endTs: new Date(2026, 5, 10, 10).getTime(), kind: 'active', appName: 'Google Chrome' }],
    timelineDate: '2026-06-10', hasAnyData: true, ...over,
  };
}
function fakeApi(over: Partial<MimiMonitorApi> = {}): MimiMonitorApi {
  return {
    getSnapshot: vi.fn().mockResolvedValue(snapshot()),
    getInsights: vi.fn().mockResolvedValue(insights()),
    setPaused: vi.fn().mockResolvedValue(snapshot({ state: 'paused' })),
    updateSettings: vi.fn().mockResolvedValue(snapshot()),
    clearHistory: vi.fn().mockResolvedValue({ deleted: 3 }),
    quitApp: vi.fn().mockResolvedValue(true),
    ...over,
  };
}
const install = (api: MimiMonitorApi | undefined) => { window.mimi = { getAppInfo: async () => ({ name: 'Mimi', version: '0.1.0', platform: 'win32' }), monitor: api }; };

beforeEach(() => window.localStorage.clear());
afterEach(() => { delete window.mimi; });

describe('dashboard data integration (fake bridge; renderer logic only)', () => {
  it('shows measured values from the monitoring bridge, not demo data', async () => {
    install(fakeApi());
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Active screen time today').textContent).toBe('1h 30m'));
    expect(screen.getByTestId('monitor-status').textContent).toContain('Monitoring');
    expect(screen.getByTestId('current-app').textContent).toContain('Google Chrome');
    expect(screen.getByTestId('goal-remaining').textContent).toContain('2h 30m left');
    expect(screen.queryAllByText('Demo data').length).toBe(0);
  });

  it('shows an honest empty state for a brand-new install', async () => {
    install(fakeApi({
      getSnapshot: vi.fn().mockResolvedValue(snapshot({ today: day('2026-06-10'), currentApp: null })),
      getInsights: vi.fn().mockResolvedValue(insights({ hasAnyData: false, apps: [], timeline: [], days: [day('2026-06-10')] })),
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Nothing recorded yet/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
    await waitFor(() => expect(screen.getByText('Nothing measured yet')).toBeTruthy());
  });

  it('shows no numbers outside Electron instead of inventing them', () => {
    install(undefined);
    render(<App />);
    expect(screen.getByText(/no numbers are shown/)).toBeTruthy();
    expect(screen.queryByLabelText('Active screen time today')).toBeNull();
  });

  it('reports paused / unsupported states truthfully', async () => {
    install(fakeApi({ getSnapshot: vi.fn().mockResolvedValue(snapshot({ state: 'paused', currentApp: null })) }));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('monitor-status').textContent).toContain('Paused'));
  });

  it('Insights shows app breakdown, active vs idle and timeline from real data', async () => {
    install(fakeApi());
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
    await waitFor(() => expect(screen.getByText('Visual Studio Code')).toBeTruthy());
    expect(screen.getByText('Active versus idle')).toBeTruthy();
    expect(screen.getByRole('img', { name: /measured activity by time of day/ })).toBeTruthy();
  });
});

describe('Settings controls call the monitoring bridge', () => {
  async function openSettings(api: MimiMonitorApi) {
    install(api);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(screen.getByLabelText('Count me as idle after')).toBeTruthy());
  }

  it('pauses monitoring through the bridge', async () => {
    const api = fakeApi(); await openSettings(api);
    fireEvent.click(screen.getByRole('switch', { name: 'Track active screen time' }));
    await waitFor(() => expect(api.setPaused).toHaveBeenCalledWith(true));
  });

  it('sends idle threshold and daily goal changes', async () => {
    const api = fakeApi(); await openSettings(api);
    fireEvent.change(screen.getByLabelText('Count me as idle after'), { target: { value: '300' } });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ idleThresholdSec: 300 }));
    fireEvent.change(screen.getByLabelText('Daily screen-time goal'), { target: { value: '360' } });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ dailyGoalMinutes: 360 }));
  });

  it('requires an explicit confirmation before clearing history, and cancel does nothing', async () => {
    const api = fakeApi(); await openSettings(api);
    fireEvent.click(screen.getByRole('button', { name: /Clear activity history/ }));
    expect(api.clearHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.clearHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Clear activity history/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    await waitFor(() => expect(api.clearHistory).toHaveBeenCalledTimes(1));
  });

  it('surfaces a rejected setting instead of pretending it worked', async () => {
    const api = fakeApi({ updateSettings: vi.fn().mockRejectedValue(new Error('idleThresholdSec must be a whole number')) });
    await openSettings(api);
    fireEvent.change(screen.getByLabelText('Count me as idle after'), { target: { value: '30' } });
    await waitFor(() => expect(screen.getByText(/That didn't work/)).toBeTruthy());
  });

  it('states what is and is not collected', async () => {
    await openSettings(fakeApi());
    expect(screen.getByText(/no screenshots|takes no screenshots/i)).toBeTruthy();
    expect(screen.getByText(/not your attention/)).toBeTruthy();
  });

  it('still shows the not-yet-active labels for later-phase features', async () => {
    await openSettings(fakeApi());
    expect(screen.getAllByText('Not active yet').length).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('greets by time of day', () => {
    expect(greetingFor(8)).toBe('Good morning');
    expect(greetingFor(14)).toBe('Good afternoon');
    expect(greetingFor(20)).toBe('Good evening');
  });
  it('formats durations without rounding up', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(59_000)).toBe('<1m');
    expect(formatDuration(61 * 60_000)).toBe('1h 01m');
    expect(formatDuration(-5)).toBe('0m');
  });
  it('clamps goal progress', () => {
    expect(goalProgress(500, 100)).toBe(100);
    expect(goalProgress(50, 0)).toBe(0);
    expect(goalProgress(25, 100)).toBe(25);
  });
});
