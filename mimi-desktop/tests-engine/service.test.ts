import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActivityRepository } from '../electron/db/repository';
import { identifyApp } from '../electron/monitor/app-identity';
import { MonitorService, type Timers } from '../electron/monitor/service';
import { ValidationError, validateClearConfirmation, validateInsightsDays, validateSettingsPatch, sanitizeStoredSettings } from '../electron/monitor/validation';
import { WindowsSampler, type WinApi, type Sampler } from '../electron/monitor/windows-sampler';
import type { Sample } from '../electron/monitor/types';
import { DEFAULT_MONITOR_SETTINGS } from '../electron/monitor/types';
import { CHROME, FakeClock, NOON, freshDb, sec } from './helpers/fixtures';

class ManualTimers implements Timers {
  scheduled: { fn: () => void; ms: number }[] = [];
  cleared = 0;
  setTimeout(fn: () => void, ms: number) { const h = { fn, ms }; this.scheduled.push(h); return h; }
  clearTimeout(h: unknown) { this.cleared++; this.scheduled = this.scheduled.filter((x) => x !== h); }
}
class FakeSampler implements Sampler {
  next: Sample = { ok: true, foreground: CHROME, idleMs: 0 };
  reason: string | null = null; calls = 0;
  unavailableReason() { return this.reason; }
  sample() { this.calls++; return this.next; }
}
function makeService(over: { sampler?: FakeSampler; file?: string } = {}) {
  const clock = new FakeClock(NOON);
  const sampler = over.sampler ?? new FakeSampler();
  const timers = new ManualTimers();
  const { repo, db, file } = freshDb(over.file);
  const svc = new MonitorService({ repo, database: { ok: true, message: null, recoveredFromCorruption: false }, sampler, clock, timers, runId: 'run' });
  svc.start();
  const step = (ms = sec(3)) => { clock.advance(ms); svc.tick(); };
  return { svc, clock, sampler, timers, repo, db, file, step };
}

describe('service integration (fake OS sampler; NOT a Windows integration test)', () => {
  it('records real usage, reports it in the snapshot, and merges the live segment once', () => {
    const { svc, step, db } = makeService();
    svc.tick();
    for (let i = 0; i < 10; i++) step();
    const snap = svc.getSnapshot();
    assert.equal(snap.state, 'running');
    assert.equal(snap.currentApp?.appName, 'Google Chrome');
    assert.equal(snap.today.activeMs, sec(30));
    svc.stop();
    assert.equal(svc.getSnapshot().today.activeMs, sec(30), 'same total after the segment is closed (no double count)');
    assert.equal(db.all<any>('SELECT * FROM activity_segments').length, 1);
  });

  it('runs a single loop even if start() is called repeatedly', () => {
    const { svc, timers } = makeService();
    svc.start(); svc.start(); svc.start();
    assert.equal(timers.scheduled.length, 1);
    svc.stop();
    assert.equal(timers.scheduled.length, 0);
    svc.start();
    assert.equal(timers.scheduled.length, 1);
  });

  it('keeps recording when no window exists: service has no window dependency', () => {
    const { svc, step, timers } = makeService();
    svc.start();
    timers.scheduled[0].fn(); // loop fires with zero BrowserWindows anywhere
    for (let i = 0; i < 4; i++) step();
    assert.ok(svc.getSnapshot().today.activeMs > 0);
    assert.ok(timers.scheduled.length >= 1, 'loop re-armed itself');
    svc.stop();
  });

  it('pausing stops new active records and persists; resuming records again', () => {
    const { svc, step, db, sampler } = makeService();
    svc.tick(); step(); step();
    svc.setPaused(true);
    const rowsAtPause = db.all<any>('SELECT * FROM activity_segments').length;
    for (let i = 0; i < 20; i++) step();
    assert.equal(db.all<any>('SELECT * FROM activity_segments').length, rowsAtPause);
    assert.equal(svc.getSnapshot().state, 'paused');
    assert.equal(svc.getSnapshot().currentApp, null);
    void sampler;
    svc.setPaused(false);
    svc.tick(); step(); step();
    assert.equal(svc.getSnapshot().state, 'running');
    assert.ok(db.all<any>('SELECT * FROM activity_segments').length > rowsAtPause);
    svc.stop();
  });

  it('persists settings and applies them after a restart (paused state included)', () => {
    const a = makeService();
    a.svc.updateSettings({ idleThresholdSec: 120, dailyGoalMinutes: 90 });
    a.svc.setPaused(true);
    a.svc.stop();
    const clock = new FakeClock(NOON);
    const repo = new ActivityRepository(a.db);
    const b = new MonitorService({ repo, database: { ok: true, message: null, recoveredFromCorruption: false }, sampler: new FakeSampler(), clock, timers: new ManualTimers() });
    b.start();
    assert.equal(b.getSettings().idleThresholdSec, 120);
    assert.equal(b.getSnapshot().goalMs, 90 * 60_000);
    assert.equal(b.getSnapshot().state, 'paused');
    b.stop();
  });

  it('applies the idle threshold to the running tracker immediately', () => {
    const { svc, sampler, step } = makeService();
    svc.updateSettings({ idleThresholdSec: 30 });
    svc.tick();
    sampler.next = { ok: true, foreground: CHROME, idleMs: sec(45) };
    step(); step();
    assert.equal(svc.getSnapshot().state, 'idle');
  });

  it('recovers crashed (open) segments on start', () => {
    const a = makeService();
    a.svc.tick(); for (let i = 0; i < 10; i++) a.step(); // crash: no stop()
    assert.equal(a.db.all<any>('SELECT * FROM activity_segments WHERE is_open = 1').length, 1);
    const b = new MonitorService({ repo: new ActivityRepository(a.db), database: { ok: true, message: null, recoveredFromCorruption: false }, sampler: new FakeSampler(), clock: new FakeClock(NOON + sec(60)), timers: new ManualTimers() });
    b.start();
    assert.equal(a.db.all<any>('SELECT * FROM activity_segments WHERE is_open = 1').length, 0);
    b.stop();
  });

  it('reports sleep and lock states and records nothing meanwhile', () => {
    const { svc, step, db } = makeService();
    svc.tick(); step();
    svc.onSuspend(); assert.equal(svc.getSnapshot().state, 'asleep');
    const n = db.all<any>('SELECT * FROM activity_segments').length;
    for (let i = 0; i < 10; i++) step();
    assert.equal(db.all<any>('SELECT * FROM activity_segments').length, n);
    svc.onResume(); svc.onLock(); assert.equal(svc.getSnapshot().state, 'locked');
    svc.onUnlock(); assert.equal(svc.getSnapshot().state, 'running');
  });

  it('reports "unsupported" and records nothing when the OS sampler is unavailable (no mock data)', () => {
    const sampler = new FakeSampler(); sampler.reason = 'not Windows';
    const { svc, step, db } = makeService({ sampler });
    svc.tick(); step(); step();
    assert.equal(sampler.calls, 0);
    assert.equal(svc.getSnapshot().state, 'unsupported');
    assert.equal(db.all<any>('SELECT * FROM activity_segments').length, 0);
  });

  it('reports a database error and never records when the database could not be opened', () => {
    const svc = new MonitorService({ repo: null, database: { ok: false, message: 'locked', recoveredFromCorruption: false }, sampler: new FakeSampler(), clock: new FakeClock(NOON), timers: new ManualTimers() });
    const clock = (svc as any).clock as FakeClock;
    svc.tick(); clock.advance(sec(3)); svc.tick();
    const s = svc.getSnapshot();
    assert.equal(s.state, 'error');
    assert.equal(s.today.activeMs > 0, true, 'live in-memory time can be shown, but it is flagged as error and unsaved');
    assert.ok(s.unsavedSegments > 0);
  });

  it('rejects invalid settings and leaves current settings unchanged', () => {
    const { svc } = makeService();
    for (const bad of [{ idleThresholdSec: 1 }, { idleThresholdSec: '60' }, { dailyGoalMinutes: 0 }, { dailyGoalMinutes: 1.5 }, { nope: 1 }, {}, null, [], { idleThresholdSec: NaN }, { monitoringEnabled: 'yes' }]) {
      assert.throws(() => svc.updateSettings(bad), ValidationError);
    }
    assert.deepEqual(svc.getSettings(), DEFAULT_MONITOR_SETTINGS);
  });

  it('clearHistory removes stored history, resets today to zero and keeps settings', () => {
    const { svc, step, repo } = makeService();
    svc.updateSettings({ dailyGoalMinutes: 60 });
    svc.tick(); for (let i = 0; i < 5; i++) step();
    svc.clearHistory();
    assert.equal(repo.countSegments(), 0);
    assert.equal(svc.getSnapshot().today.activeMs, 0);
    assert.equal(svc.getSettings().dailyGoalMinutes, 60);
    step(); step();
    assert.ok(svc.getSnapshot().today.activeMs > 0, 'monitoring continues after clearing');
  });

  it('insights: zero-filled days, app breakdown, timeline, and honest empty state', () => {
    const { svc, step } = makeService();
    assert.equal(svc.getInsights(7).hasAnyData, false);
    assert.equal(svc.getInsights(7).days.length, 7);
    svc.tick(); for (let i = 0; i < 6; i++) step();
    const ins = svc.getInsights(7);
    assert.equal(ins.hasAnyData, true);
    assert.equal(ins.days[6].activeMs, sec(18));
    assert.deepEqual(ins.apps.map((a) => a.appId), ['chrome.exe']);
    assert.equal(ins.timeline.length, 1);
  });

  it('never throws when the sampler throws', () => {
    const sampler = new FakeSampler();
    sampler.sample = () => { throw new Error('native crash'); };
    const { svc } = makeService({ sampler });
    assert.doesNotThrow(() => svc.tick());
  });
});

describe('validation helpers', () => {
  it('validates insights range and clear confirmation', () => {
    assert.equal(validateInsightsDays(7), 7);
    for (const bad of [0, 91, 1.5, '7', null]) assert.throws(() => validateInsightsDays(bad), ValidationError);
    assert.throws(() => validateClearConfirmation('yes'), ValidationError);
    assert.doesNotThrow(() => validateClearConfirmation('DELETE_ACTIVITY_HISTORY'));
  });
  it('accepts a valid patch and sanitises stored garbage', () => {
    assert.deepEqual(validateSettingsPatch({ idleThresholdSec: 90, monitoringEnabled: false }), { idleThresholdSec: 90, monitoringEnabled: false });
    assert.equal(sanitizeStoredSettings({ ...DEFAULT_MONITOR_SETTINGS, idleThresholdSec: -5 }).idleThresholdSec, 60);
  });
});

describe('app identity (privacy)', () => {
  it('keeps only the lower-cased file name, never the directory', () => {
    const a = identifyApp('C:\\Users\\alice\\AppData\\Local\\Programs\\Foo Bar\\foo-bar.exe');
    assert.equal(a.appId, 'foo-bar.exe');
    assert.equal(a.appName, 'Foo Bar');
    assert.ok(!JSON.stringify(a).toLowerCase().includes('alice'));
    assert.equal(identifyApp('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe').appName, 'Google Chrome');
    assert.equal(identifyApp(null).appId, 'unidentified');
    assert.equal(identifyApp('').appId, 'unidentified');
  });
});

describe('WindowsSampler with a faked native API (mock, NOT real Windows)', () => {
  const api = (o: Partial<WinApi> = {}): WinApi => ({ idleMs: () => 1234, foregroundExe: () => 'C:\\x\\chrome.exe', ...o });
  it('is unavailable (not faked) on non-Windows platforms', () => {
    const s = new WindowsSampler('linux');
    assert.match(s.unavailableReason() ?? '', /only implemented for Windows/);
    assert.equal(s.sample().ok, false);
  });
  it('maps native results to samples without exposing the path', () => {
    const s = new WindowsSampler('win32', () => api());
    assert.equal(s.unavailableReason(), null);
    assert.deepEqual(s.sample(), { ok: true, foreground: { appId: 'chrome.exe', appName: 'Google Chrome' }, idleMs: 1234 });
  });
  it('reports no foreground window, unidentified processes, and native failures distinctly', () => {
    assert.deepEqual((new WindowsSampler('win32', () => api({ foregroundExe: () => 'none' })).sample() as any).foreground, null);
    assert.equal((new WindowsSampler('win32', () => api({ foregroundExe: () => null })).sample() as any).foreground.appId, 'unidentified');
    assert.equal(new WindowsSampler('win32', () => api({ idleMs: () => null })).sample().ok, false);
    assert.equal(new WindowsSampler('win32', () => api({ foregroundExe: () => { throw new Error('ffi'); } })).sample().ok, false);
  });
  it('degrades to unavailable if koffi fails to load', () => {
    const s = new WindowsSampler('win32', () => { throw new Error('Cannot find module koffi'); });
    assert.match(s.unavailableReason() ?? '', /koffi/);
  });
});
