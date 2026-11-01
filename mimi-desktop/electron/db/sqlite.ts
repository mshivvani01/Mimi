import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

/** Minimal synchronous SQL port. Implemented by better-sqlite3 in the app and node:sqlite in unit tests. */
export interface SqlDb {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number };
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export class SchemaTooNewError extends Error {
  constructor(public readonly found: number, public readonly supported: number) {
    super(`Database schema version ${found} is newer than this version of Mimi supports (${supported}).`);
    this.name = 'SchemaTooNewError';
  }
}

/** Load NNN_name.sql files from a directory, sorted by version. */
export function loadMigrations(dir: string): Migration[] {
  const out: Migration[] = [];
  for (const file of readdirSync(dir)) {
    const m = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m) continue;
    out.push({ version: Number(m[1]), name: m[2], sql: readFileSync(path.join(dir, file), 'utf8') });
  }
  out.sort((a, b) => a.version - b.version);
  for (let i = 0; i < out.length; i++) {
    if (out[i].version !== i + 1) throw new Error(`Migration versions must be contiguous from 001 (found ${out[i].version} at position ${i + 1})`);
  }
  return out;
}

export function currentVersion(db: SqlDb): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  return db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0;
}

/**
 * Apply pending migrations, each in its own transaction (a failed migration rolls back and leaves existing data untouched).
 * Refuses to run against a database created by a NEWER app version rather than touching it.
 */
export function migrate(db: SqlDb, migrations: Migration[], now: () => number = Date.now): number[] {
  const current = currentVersion(db);
  const latest = migrations.length ? migrations[migrations.length - 1].version : 0;
  if (current > latest) throw new SchemaTooNewError(current, latest);
  const applied: number[] = [];
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, now()]);
    });
    applied.push(m.version);
  }
  return applied;
}

export interface OpenResult {
  db: SqlDb | null;
  ok: boolean;
  message: string | null;
  recoveredFromCorruption: boolean;
  quarantinedTo: string | null;
}

export type DbOpener = (file: string) => SqlDb;

const CORRUPT_RE = /(not a database|malformed|corrupt|disk image|file is encrypted)/i;

/**
 * Open (and migrate) the database. A corrupt file is MOVED aside (never deleted) and a fresh database is created.
 * Access failures (locked, permission denied) and too-new schemas leave the file untouched and return db=null.
 */
export function openDatabase(file: string, migrationsDir: string, opener: DbOpener, now: () => number = Date.now): OpenResult {
  const migrations = loadMigrations(migrationsDir);
  const attempt = (): SqlDb => {
    const db = opener(file);
    try {
      const check = db.get<{ quick_check: string }>('PRAGMA quick_check');
      if (check && check.quick_check !== 'ok') throw new Error(`database disk image is malformed (${check.quick_check})`);
      migrate(db, migrations, now);
      return db;
    } catch (err) {
      try { db.close(); } catch { /* ignore */ }
      throw err;
    }
  };
  try {
    return { db: attempt(), ok: true, message: null, recoveredFromCorruption: false, quarantinedTo: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof SchemaTooNewError) return { db: null, ok: false, message: msg, recoveredFromCorruption: false, quarantinedTo: null };
    if (CORRUPT_RE.test(msg) && existsSync(file)) {
      const aside = `${file}.corrupt-${now()}`;
      try {
        renameSync(file, aside);
        for (const suffix of ['-wal', '-shm']) if (existsSync(file + suffix)) renameSync(file + suffix, aside + suffix);
        const db = attempt();
        return { db, ok: true, message: `The activity database was damaged. It was kept as "${path.basename(aside)}" and a new one was created.`, recoveredFromCorruption: true, quarantinedTo: aside };
      } catch (err2) {
        return { db: null, ok: false, message: `Could not recover the activity database: ${err2 instanceof Error ? err2.message : String(err2)}`, recoveredFromCorruption: false, quarantinedTo: null };
      }
    }
    return { db: null, ok: false, message: `Could not open the activity database: ${msg}`, recoveredFromCorruption: false, quarantinedTo: null };
  }
}
