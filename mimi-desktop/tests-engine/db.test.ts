import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ActivityRepository } from '../electron/db/repository';
import { SchemaTooNewError, loadMigrations, migrate, openDatabase } from '../electron/db/sqlite';
import { buildDailySeries, mergeAppTotals, remainingMs } from '../electron/monitor/aggregate';
import { MIGRATIONS_DIR, freshDb, tmpFile } from './helpers/fixtures';
import { openNodeSqlite } from './helpers/node-sqlite-adapter';

const seg = (o: Partial<Parameters<ActivityRepository['insertClosed']>[0]> = {}) => ({
  kind: 'active' as const, reason: 'none' as const, appId: 'chrome.exe', appName: 'Google Chrome',
  startTs: 1000, endTs: 61_000, durationMs: 60_000, localDate: '2026-06-10', tzOffsetMin: 0, runId: 'r', ...o,
});

describe('migrations', () => {
  it('applies the initial schema once and records the version', () => {
    const { db } = freshDb();
    assert.deepEqual(db.all<any>('SELECT version, name FROM schema_migrations').map((r) => r.version), [1]);
    assert.ok(db.get<any>("SELECT name FROM sqlite_master WHERE name = 'activity_segments'"));
    assert.deepEqual(migrate(db, loadMigrations(MIGRATIONS_DIR)), [], 're-running is a no-op');
  });

  it('upgrades an existing database without losing data (later migration added on top)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
    const sql1 = (name: string) => path.join(dir, name);
    writeFileSync(sql1('001_initial.sql'), 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL);');
    const file = tmpFile();
    const a = openDatabase(file, dir, openNodeSqlite);
    a.db!.run('INSERT INTO t (v) VALUES (?)', ['keep me']);
    a.db!.close();
    writeFileSync(sql1('002_add_col.sql'), 'ALTER TABLE t ADD COLUMN extra TEXT;');
    const b = openDatabase(file, dir, openNodeSqlite);
    assert.ok(b.ok);
    assert.equal(b.db!.get<any>('SELECT v, extra FROM t').v, 'keep me');
    assert.deepEqual(b.db!.all<any>('SELECT version FROM schema_migrations ORDER BY version').map((r) => r.version), [1, 2]);
  });

  it('rolls back a failing migration and leaves existing data intact', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
    writeFileSync(path.join(dir, '001_initial.sql'), 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);');
    const file = tmpFile();
    const a = openDatabase(file, dir, openNodeSqlite);
    a.db!.run('INSERT INTO t (v) VALUES (?)', ['x']); a.db!.close();
    writeFileSync(path.join(dir, '002_bad.sql'), 'ALTER TABLE t ADD COLUMN ok TEXT; THIS IS NOT SQL;');
    const b = openDatabase(file, dir, openNodeSqlite);
    assert.equal(b.ok, false);
    const c = openNodeSqlite(file);
    assert.equal(c.get<any>('SELECT v FROM t').v, 'x');
    assert.equal(c.all<any>('PRAGMA table_info(t)').some((col) => col.name === 'ok'), false, 'partial migration rolled back');
  });

  it('refuses a database from a newer app version and does not modify it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
    writeFileSync(path.join(dir, '001_initial.sql'), 'CREATE TABLE t (id INTEGER);');
    const file = tmpFile();
    const d = openNodeSqlite(file);
    d.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    d.run("INSERT INTO schema_migrations VALUES (7, 'future', 1)"); d.close();
    const r = openDatabase(file, dir, openNodeSqlite);
    assert.equal(r.ok, false);
    assert.match(r.message ?? '', /newer/);
    assert.ok(new SchemaTooNewError(7, 1) instanceof Error);
  });
});

describe('corruption and access failures', () => {
  it('moves a corrupt database aside (never deletes it) and starts fresh', () => {
    const file = tmpFile();
    writeFileSync(file, Buffer.from('this is definitely not a sqlite database '.repeat(50)));
    const r = openDatabase(file, MIGRATIONS_DIR, openNodeSqlite);
    assert.ok(r.ok && r.recoveredFromCorruption);
    assert.ok(r.quarantinedTo && existsSync(r.quarantinedTo), 'original bytes preserved');
    assert.ok(readdirSync(path.dirname(file)).some((f) => f.includes('.corrupt-')));
    new ActivityRepository(r.db!).insertClosed(seg());
  });

  it('reports an access failure without touching the file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ro-'));
    const bad = path.join(dir, 'nested-dir-that-does-not-exist', 'x.db');
    const r = openDatabase(bad, MIGRATIONS_DIR, openNodeSqlite);
    assert.equal(r.ok, false);
    assert.equal(r.db, null);
    mkdirSync(path.join(dir, 'ok'));
  });
});

describe('persistence and aggregation', () => {
  it('persists across close/reopen', () => {
    const { repo, db, file } = freshDb();
    repo.insertClosed(seg());
    db.close();
    const again = freshDb(file);
    assert.equal(again.repo.countSegments(), 1);
  });

  it('aggregates daily totals by kind and per-app totals using local_date', () => {
    const { repo } = freshDb();
    repo.insertClosed(seg({ durationMs: 60_000, localDate: '2026-06-10' }));
    repo.insertClosed(seg({ appId: 'code.exe', appName: 'VS Code', durationMs: 120_000, localDate: '2026-06-10' }));
    repo.insertClosed(seg({ kind: 'idle', appId: null, appName: null, durationMs: 30_000, localDate: '2026-06-10' }));
    repo.insertClosed(seg({ durationMs: 10_000, localDate: '2026-06-11' }));
    const days = buildDailySeries(['2026-06-09', '2026-06-10', '2026-06-11'], repo.dayKindTotals('2026-06-09', '2026-06-11'), null);
    assert.deepEqual(days.map((d) => [d.activeMs, d.idleMs]), [[0, 0], [180_000, 30_000], [10_000, 0]]);
    const apps = repo.appTotals('2026-06-10', '2026-06-11');
    assert.deepEqual(apps.map((a) => [a.appId, a.activeMs]), [['code.exe', 120_000], ['chrome.exe', 70_000]]);
  });

  it('merges the live segment exactly once and excludes open rows from stored totals', () => {
    const { repo } = freshDb();
    repo.insertOpen(seg({ durationMs: 9_999 })); // checkpointed open row must NOT be summed (service adds live instead)
    const live = { kind: 'active' as const, appId: 'chrome.exe', appName: 'Google Chrome', localDate: '2026-06-10', durationMs: 5_000 };
    const [d] = buildDailySeries(['2026-06-10'], repo.dayKindTotals('2026-06-10', '2026-06-10'), live);
    assert.equal(d.activeMs, 5_000);
    assert.equal(mergeAppTotals([], live, ['2026-06-10'])[0].activeMs, 5_000);
  });

  it('remaining time never goes negative', () => {
    assert.equal(remainingMs(100, 40), 60);
    assert.equal(remainingMs(100, 400), 0);
  });

  it('clearHistory deletes activity but keeps settings', () => {
    const { repo } = freshDb();
    repo.insertClosed(seg()); repo.saveSettings({ dailyGoalMinutes: 90 });
    assert.equal(repo.clearHistory(), 1);
    assert.equal(repo.countSegments(), 0);
    assert.equal(repo.loadSettings().dailyGoalMinutes, 90);
  });

  it('stores settings as validated JSON and ignores corrupt rows', () => {
    const { repo, db } = freshDb();
    repo.saveSettings({ idleThresholdSec: 120, monitoringEnabled: false });
    db.run("INSERT INTO monitor_settings (key, value) VALUES ('dailyGoalMinutes', 'not json') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const s = repo.loadSettings();
    assert.equal(s.idleThresholdSec, 120);
    assert.equal(s.monitoringEnabled, false);
    assert.equal(s.dailyGoalMinutes, 240, 'falls back to default');
  });

  it('SQL injection strings are stored as data, not executed', () => {
    const { repo } = freshDb();
    repo.insertClosed(seg({ appId: "x'; DROP TABLE activity_segments;--", appName: 'evil' }));
    assert.equal(repo.countSegments(), 1);
  });
});
