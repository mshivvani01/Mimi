import { useEffect, useState } from 'react';
import { Card, Toggle } from './ui';
import { Mascot } from './Mascot';
import { POSES, POSE_LABELS, type PoseName } from '../mascot/poses';
import type { MimiSettings } from '../lib/settings';
import type { MimiAppInfo, MonitorSettings } from '../types/mimi';
import type { MonitorData } from '../lib/useMonitor';
import { formatDuration } from '../lib/format';

const INTERVALS = [15, 20, 30, 45, 60, 90];
const IDLE_CHOICES = [30, 60, 120, 300, 600];
const GOAL_CHOICES = [60, 120, 180, 240, 300, 360, 480, 600, 720];

function withCurrent(choices: number[], current: number | undefined): number[] {
  return current !== undefined && !choices.includes(current) ? [...choices, current].sort((a, b) => a - b) : choices;
}
const idleLabel = (sec: number) => (sec < 60 ? `${sec} seconds` : sec === 60 ? '1 minute' : `${sec / 60} minutes`);

export function Settings({ settings, onChange, monitor }: { settings: MimiSettings; onChange: (next: MimiSettings) => void; monitor: MonitorData }) {
  const set = <K extends keyof MimiSettings>(key: K, value: MimiSettings[K]) => onChange({ ...settings, [key]: value });
  const [previewPose, setPreviewPose] = useState<PoseName>('master');
  const [info, setInfo] = useState<MimiAppInfo | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { api, snapshot, refresh } = monitor;
  const ms = snapshot?.settings;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      setMessage(ok ?? null);
    } catch (e) {
      setMessage(`That didn't work: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    await refresh();
  };
  const patch = (p: Partial<MonitorSettings>) => api && run(() => api.updateSettings(p));

  useEffect(() => {
    window.mimi?.getAppInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  return (
    <div className="page">
      <h1 className="page__title">Settings</h1>
      <p className="notice">Screen-time monitoring is live and its settings are saved in Mimi's local database. Reminders, the floating mascot, and Windows startup are not active yet (later phases).</p>
      {message && <p className="notice" role="status">{message}</p>}

      <Card title="Monitoring" badge={api ? 'Active' : 'Needs desktop app'} tone="lavender">
        {!api || !ms ? (
          <p className="muted">{api ? 'Loading...' : 'Monitoring settings are only available inside the Mimi desktop app.'}</p>
        ) : (
          <>
            <Toggle id="monitoring" label="Track active screen time" hint="Measures computer activity and which app is in front. Turn off to pause; nothing is recorded while paused." checked={ms.monitoringEnabled} onChange={(v) => run(() => api.setPaused(!v))} />
            <div className="row">
              <div className="row__text">
                <label htmlFor="idle-threshold">Count me as idle after</label>
                <p>No keyboard or mouse input for this long is idle time, not screen time.</p>
              </div>
              <select id="idle-threshold" value={ms.idleThresholdSec} onChange={(e) => patch({ idleThresholdSec: Number(e.target.value) })}>
                {withCurrent(IDLE_CHOICES, ms.idleThresholdSec).map((v) => <option key={v} value={v}>{idleLabel(v)}</option>)}
              </select>
            </div>
            <div className="row">
              <div className="row__text"><label htmlFor="daily-goal">Daily screen-time goal</label></div>
              <select id="daily-goal" value={ms.dailyGoalMinutes} onChange={(e) => patch({ dailyGoalMinutes: Number(e.target.value) })}>
                {withCurrent(GOAL_CHOICES, ms.dailyGoalMinutes).map((v) => <option key={v} value={v}>{formatDuration(v * 60_000)}</option>)}
              </select>
            </div>
            <Toggle id="keep-running" label="Keep Mimi running when I close the window" hint="Monitoring continues in the background until you quit Mimi. There is no tray icon yet (Phase 02), so use the Quit button below." checked={ms.keepRunningWhenClosed} onChange={(v) => patch({ keepRunningWhenClosed: v })} />
            <div className="row">
              <div className="row__text"><p>Stop Mimi and monitoring completely.</p></div>
              <button type="button" className="btn btn--soft" onClick={() => void api.quitApp()}>Quit Mimi</button>
            </div>
          </>
        )}
      </Card>

      <Card title="Privacy and local history" badge="On this computer only" tone="cream">
        <p className="muted">Mimi records only the app's name (like "chrome.exe"), start and end times, and active or idle status. It takes no screenshots, records no keystrokes, and reads no window titles, documents, or web pages. Everything stays in a database on this computer and is never sent anywhere. Mimi measures computer activity, not your attention or what you are doing.</p>
        {api && (
          confirmClear ? (
            <div className="row" role="alertdialog" aria-label="Confirm clearing history">
              <div className="row__text"><p><strong>Delete all recorded activity history?</strong> This cannot be undone. Your settings are kept.</p></div>
              <button type="button" className="btn btn--danger" onClick={async () => { await run(() => api.clearHistory(), 'Your activity history was cleared.'); setConfirmClear(false); }}>Yes, delete it</button>
              <button type="button" className="btn btn--soft" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          ) : (
            <div className="row">
              <div className="row__text"><p>Remove everything Mimi has recorded about your computer use.</p></div>
              <button type="button" className="btn btn--soft" onClick={() => setConfirmClear(true)}>Clear activity history...</button>
            </div>
          )
        )}
      </Card>

      <Card title="Reminders" badge="Not active yet" tone="blue">
        <div className="row">
          <div className="row__text"><label htmlFor="break-every">Break reminder every</label></div>
          <select id="break-every" value={settings.breakReminderMinutes} onChange={(e) => set('breakReminderMinutes', Number(e.target.value))}>
            {INTERVALS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div className="row">
          <div className="row__text"><label htmlFor="water-every">Water reminder every</label></div>
          <select id="water-every" value={settings.waterReminderMinutes} onChange={(e) => set('waterReminderMinutes', Number(e.target.value))}>
            {INTERVALS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
      </Card>

      <Card title="Quiet hours" badge="Not active yet" tone="blush">
        <Toggle id="quiet" label="Keep Mimi quiet at night" checked={settings.quietHoursEnabled} onChange={(v) => set('quietHoursEnabled', v)} />
        <div className="row">
          <div className="row__text"><label htmlFor="quiet-start">From</label></div>
          <input id="quiet-start" type="time" value={settings.quietStart} disabled={!settings.quietHoursEnabled} onChange={(e) => set('quietStart', e.target.value)} />
          <div className="row__text"><label htmlFor="quiet-end">Until</label></div>
          <input id="quiet-end" type="time" value={settings.quietEnd} disabled={!settings.quietHoursEnabled} onChange={(e) => set('quietEnd', e.target.value)} />
        </div>
      </Card>

      <Card title="Mascot and startup" badge="Not active yet" tone="mint">
        <Toggle id="mascot-visible" label="Show Mimi on my desktop" hint="A separate floating window is planned." checked={settings.mascotVisible} onChange={(v) => set('mascotVisible', v)} />
        <Toggle id="startup" label="Open Mimi when I sign in to Windows" hint="Windows startup is not set up in this version." checked={settings.launchAtStartup} onChange={(v) => set('launchAtStartup', v)} />
      </Card>

      <Card title="Mascot preview" tone="cream">
        <div className="gallery">
          <Mascot pose={previewPose} size={190} />
          <div className="chips" role="group" aria-label="Choose a pose">
            {POSES.map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={previewPose === p} title={POSE_LABELS[p]} onClick={() => setPreviewPose(p)}>{p}</button>
            ))}
          </div>
        </div>
        <p className="muted">These poses are placeholder vector drawings, not final artwork.</p>
      </Card>

      <p className="muted about">{info ? `${info.name} ${info.version} on ${info.platform}` : 'Running in a browser (no Electron bridge).'}</p>
    </div>
  );
}
