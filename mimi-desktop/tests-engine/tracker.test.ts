import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localDateString } from '../electron/monitor/timeutil';
import { CHROME, CODE, FakeClock, NOON, active, failed, makeTracker, sec } from './helpers/fixtures';

/** Drive the tracker with a sample every `step` ms for `total` ms. */
function run(clock: FakeClock, tracker: ReturnType<typeof makeTracker>['tracker'], total: number, make: () => ReturnType<typeof active> | typeof failed, step = sec(3)) {
  for (let t = 0; t < total; t += step) {
    clock.advance(step);
    tracker.sample(make());
  }
}
const rows = (_repo: unknown, db: ReturnType<typeof makeTracker>['db']) =>
  db.all<any>('SELECT * FROM activity_segments ORDER BY start_ts, id');

describe('active duration', () => {
  it('attributes continuous foreground time to the app, using real elapsed time', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(30), () => active(CHROME));
    tracker.stop();
    const r = rows(null as any, db);
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, 'active');
    assert.equal(r[0].app_id, 'chrome.exe');
    assert.equal(r[0].duration_ms, sec(30));
    assert.equal(r[0].end_ts - r[0].start_ts, r[0].duration_ms);
    assert.equal(r[0].is_open, 0);
  });

  it('does not depend on the number of samples (irregular sample spacing gives the same total)', () => {
    const a = new FakeClock(NOON); const b = new FakeClock(NOON);
    const A = makeTracker({ clock: a }); const B = makeTracker({ clock: b });
    A.tracker.sample(active(CHROME)); B.tracker.sample(active(CHROME));
    run(a, A.tracker, sec(30), () => active(CHROME), sec(1));
    run(b, B.tracker, sec(30), () => active(CHROME), sec(10));
    A.tracker.stop(); B.tracker.stop();
    assert.equal(rows(null as any, A.db)[0].duration_ms, rows(null as any, B.db)[0].duration_ms);
  });
});

describe('foreground application changes', () => {
  it('splits segments per app with no overlap and no gap', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(12), () => active(CHROME));
    run(clock, tracker, sec(9), () => active(CODE));
    tracker.stop();
    const r = rows(null as any, db);
    assert.deepEqual(r.map((x) => x.app_id), ['chrome.exe', 'code.exe']);
    assert.equal(r[0].end_ts, r[1].start_ts, 'no gap and no overlap');
    for (let i = 1; i < r.length; i++) assert.ok(r[i].start_ts >= r[i - 1].end_ts);
  });
});

describe('idle threshold transitions', () => {
  it('ends active time at the last input, records idle, and resumes at the returning input', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock, cfg: { idleThresholdMs: sec(60) } });
    tracker.sample(active(CHROME, 0));
    // 30 s of use then the user stops touching input (idle counter grows with real time)
    let idle = 0;
    run(clock, tracker, sec(30), () => active(CHROME, 0));
    for (let i = 0; i < 40; i++) { clock.advance(sec(3)); idle += sec(3); tracker.sample(active(CHROME, idle)); }
    // user comes back: idle counter resets, small value
    clock.advance(sec(3)); tracker.sample(active(CHROME, sec(1)));
    run(clock, tracker, sec(9), () => active(CHROME, 0));
    tracker.stop();
    const r = rows(null as any, db);
    assert.deepEqual(r.map((x) => x.kind), ['active', 'idle', 'active']);
    // contiguous, never overlapping
    assert.equal(r[0].end_ts, r[1].start_ts);
    assert.equal(r[1].end_ts, r[2].start_ts);
    // idle starts at the last input (30s of use + the 3s step after it is NOT idle-counted before threshold)
    assert.ok(r[1].duration_ms >= sec(100) && r[1].duration_ms <= sec(125), `idle=${r[1].duration_ms}`);
    const activeTotal = r[0].duration_ms + r[2].duration_ms;
    assert.ok(activeTotal < sec(60), 'idle time is not counted as active');
  });

  it('never counts idle time as active even when idle starts before the segment began', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock, cfg: { idleThresholdMs: sec(60) } });
    clock.advance(sec(3));
    tracker.sample(active(CHROME, sec(500))); // already idle at the first sample
    clock.advance(sec(3));
    tracker.sample(active(CHROME, sec(503)));
    tracker.stop();
    const r = rows(null as any, db);
    assert.ok(r.every((x) => x.kind === 'idle'));
    assert.ok(r.reduce((s, x) => s + x.duration_ms, 0) <= sec(6) + 1);
  });
});

describe('pause / resume', () => {
  it('creates no records while paused and resumes with a fresh segment', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(12), () => active(CHROME));
    tracker.pause();
    const before = rows(null as any, db).length;
    run(clock, tracker, sec(300), () => active(CODE));
    assert.equal(rows(null as any, db).length, before, 'no new rows while paused');
    assert.equal(tracker.currentLive(), null);
    tracker.resume();
    tracker.sample(active(CODE));
    run(clock, tracker, sec(9), () => active(CODE));
    tracker.stop();
    const r = rows(null as any, db);
    assert.deepEqual(r.map((x) => x.app_id), ['chrome.exe', 'code.exe']);
    assert.ok(r[1].start_ts - r[0].end_ts >= sec(299), 'paused interval is a gap, not usage');
  });
});

describe('sleep, lock and stalls', () => {
  it('does not accumulate time while asleep, even if the monotonic clock excludes sleep', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(12), () => active(CHROME));
    tracker.suspend();
    clock.sleepWithoutMono(sec(3600));
    tracker.resumeFromSleep();
    clock.advance(sec(3));
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(9), () => active(CHROME));
    tracker.stop();
    const total = rows(null as any, db).reduce((s, x) => s + x.duration_ms, 0);
    assert.ok(total < sec(40), `total=${total}`);
  });

  it('does not accumulate time while locked', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(9), () => active(CHROME));
    tracker.lock();
    clock.advance(sec(1800));
    tracker.sample(active(CHROME)); // ignored while locked
    tracker.unlock();
    clock.advance(sec(3)); tracker.sample(active(CHROME));
    run(clock, tracker, sec(6), () => active(CHROME));
    tracker.stop();
    const total = rows(null as any, db).reduce((s, x) => s + x.duration_ms, 0);
    assert.ok(total < sec(30), `total=${total}`);
  });

  it('conservatively refuses to credit a long gap between samples (stall / undetected sleep)', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock, cfg: { maxGapMs: sec(15) } });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(9), () => active(CHROME));
    clock.advance(sec(600)); // nothing sampled for 10 minutes
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(6), () => active(CHROME));
    tracker.stop();
    const total = rows(null as any, db).reduce((s, x) => s + x.duration_ms, 0);
    assert.ok(total < sec(30), `total=${total}`);
  });
});

describe('clock changes', () => {
  it('keeps historical durations correct when the system clock jumps forward', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(30), () => active(CHROME));
    clock.jumpWall(sec(7200)); // user sets the clock 2h ahead
    run(clock, tracker, sec(30), () => active(CHROME));
    tracker.stop();
    const r = rows(null as any, db);
    const total = r.reduce((s, x) => s + x.duration_ms, 0);
    assert.ok(total >= sec(55) && total <= sec(65), `total=${total}`);
    for (const x of r) assert.equal(x.end_ts - x.start_ts, x.duration_ms, 'stored timestamps stay consistent with duration');
  });

  it('handles the clock moving backwards without negative or overlapping durations', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(30), () => active(CHROME));
    clock.jumpWall(-sec(3600));
    run(clock, tracker, sec(30), () => active(CHROME));
    tracker.stop();
    const r = rows(null as any, db);
    assert.ok(r.every((x) => x.duration_ms >= 0));
    assert.ok(r.reduce((s, x) => s + x.duration_ms, 0) <= sec(65));
  });
});

describe('midnight rollover', () => {
  it('splits a session at local midnight and assigns each half to its own local date', () => {
    const start = new Date(2026, 5, 10, 23, 59, 30).getTime();
    const clock = new FakeClock(start);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(60), () => active(CHROME), sec(2));
    tracker.stop();
    const r = rows(null as any, db);
    assert.equal(r.length, 2);
    assert.equal(r[0].local_date, '2026-06-10');
    assert.equal(r[1].local_date, '2026-06-11');
    assert.equal(r[0].end_ts, new Date(2026, 5, 11, 0, 0, 0).getTime());
    assert.equal(r[1].start_ts, r[0].end_ts);
    assert.ok(Math.abs(r[0].duration_ms - sec(30)) <= sec(2));
    assert.ok(Math.abs(r[0].duration_ms + r[1].duration_ms - sec(60)) <= sec(2));
    assert.equal(localDateString(r[1].start_ts), r[1].local_date);
  });
});

describe('native failures', () => {
  it('tolerates brief failures without breaking the session', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock, cfg: { failureThreshold: 3 } });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(6), () => active(CHROME));
    clock.advance(sec(3)); tracker.sample(failed);
    clock.advance(sec(3)); tracker.sample(failed);
    run(clock, tracker, sec(6), () => active(CHROME));
    tracker.stop();
    assert.equal(rows(null as any, db).filter((x) => x.kind === 'unknown').length, 0);
  });

  it('marks sustained failure as UNKNOWN (not active) and recovers afterwards', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock, cfg: { failureThreshold: 3 } });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(6), () => active(CHROME));
    run(clock, tracker, sec(30), () => failed);
    run(clock, tracker, sec(9), () => active(CHROME));
    tracker.stop();
    const r = rows(null as any, db);
    assert.ok(r.some((x) => x.kind === 'unknown' && x.reason === 'detection-failed'));
    const unknownMs = r.filter((x) => x.kind === 'unknown').reduce((s, x) => s + x.duration_ms, 0);
    assert.ok(unknownMs >= sec(20));
    for (let i = 1; i < r.length; i++) assert.ok(r[i].start_ts >= r[i - 1].end_ts, 'no overlap');
  });

  it('records no-foreground-window as unknown rather than inventing an app', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(null));
    run(clock, tracker, sec(9), () => active(null));
    tracker.stop();
    const r = rows(null as any, db);
    assert.ok(r.every((x) => x.kind === 'unknown' && x.reason === 'no-foreground' && x.app_id === null));
  });
});

describe('session closure and crash recovery', () => {
  it('closes the in-flight segment on stop (idempotent) and leaves nothing open', () => {
    const clock = new FakeClock(NOON);
    const { tracker, db } = makeTracker({ clock });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(9), () => active(CHROME));
    tracker.stop(); tracker.stop();
    assert.equal(db.all<any>('SELECT * FROM activity_segments WHERE is_open = 1').length, 0);
  });

  it('recovers a segment left open by a crash at its last checkpoint, without inventing time', () => {
    const clock = new FakeClock(NOON);
    const { tracker, repo, db } = makeTracker({ clock, cfg: { checkpointMs: sec(10) } });
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(31), () => active(CHROME));
    // crash: no stop(). A row is still open in the database.
    assert.equal(db.all<any>('SELECT * FROM activity_segments WHERE is_open = 1').length, 1);
    const res = repo.recoverOpenSegments();
    assert.equal(res.recovered, 1);
    const r = rows(null as any, db);
    assert.equal(r[0].is_open, 0);
    assert.equal(r[0].recovered, 1);
    assert.ok(r[0].duration_ms >= sec(20) && r[0].duration_ms <= sec(31), `dur=${r[0].duration_ms}`);
    assert.equal(r[0].end_ts - r[0].start_ts, r[0].duration_ms);
  });

  it('a restarted tracker after recovery does not duplicate or overlap sessions', () => {
    const clock = new FakeClock(NOON);
    const first = makeTracker({ clock, cfg: { checkpointMs: sec(10) } });
    first.tracker.sample(active(CHROME));
    run(clock, first.tracker, sec(20), () => active(CHROME));
    first.repo.recoverOpenSegments();
    clock.advance(sec(5));
    const second = makeTracker({ clock, file: first.file });
    second.tracker.sample(active(CHROME));
    run(clock, second.tracker, sec(9), () => active(CHROME));
    second.tracker.stop();
    const r = rows(null as any, second.db);
    for (let i = 1; i < r.length; i++) assert.ok(r[i].start_ts >= r[i - 1].end_ts, 'no overlap after restart');
    assert.equal(r.filter((x) => x.is_open === 1).length, 0);
  });

  it('the database refuses a second open segment (duplicate monitoring loops cannot double-record)', () => {
    const clock = new FakeClock(NOON);
    const { repo } = makeTracker({ clock });
    const seg = { kind: 'active' as const, reason: 'none' as const, appId: 'a.exe', appName: 'A', startTs: 1, endTs: 1, durationMs: 0, localDate: '2026-06-10', tzOffsetMin: 0, runId: 'r' };
    repo.insertOpen(seg);
    assert.throws(() => repo.insertOpen(seg));
  });

  it('queues writes when the database fails and flushes them when it recovers', () => {
    const clock = new FakeClock(NOON);
    const { tracker, repo, db } = makeTracker({ clock });
    const realClose = repo.close.bind(repo); const realInsertClosed = repo.insertClosed.bind(repo);
    let broken = true;
    repo.close = (...a) => { if (broken) throw new Error('disk full'); return realClose(...a); };
    repo.insertClosed = (...a) => { if (broken) throw new Error('disk full'); return realInsertClosed(...a); };
    tracker.sample(active(CHROME));
    run(clock, tracker, sec(9), () => active(CHROME));
    run(clock, tracker, sec(9), () => active(CODE)); // closes chrome while DB "broken"
    assert.ok(tracker.unsavedCount >= 1);
    broken = false;
    run(clock, tracker, sec(6), () => active(CODE));
    tracker.stop();
    assert.equal(tracker.unsavedCount, 0);
    assert.equal(db.all<any>('SELECT * FROM activity_segments WHERE app_id = ?', ['chrome.exe']).length, 1);
  });
});
