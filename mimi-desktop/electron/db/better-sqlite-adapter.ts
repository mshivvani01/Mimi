import type { SqlDb } from './sqlite';

/** Subset of the better-sqlite3 API that Mimi uses (avoids a hard type dependency at compile time). */
interface BsStatement { run(...p: unknown[]): { changes: number; lastInsertRowid: number | bigint }; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
interface BsDatabase {
  prepare(sql: string): BsStatement;
  exec(sql: string): void;
  pragma(s: string): unknown;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

/** Production SQLite driver: better-sqlite3 (native module; must be rebuilt for Electron, see docs/PHASE-01-STATUS.md). */
export function openBetterSqlite(file: string): SqlDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as new (f: string) => BsDatabase;
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => {
      const r = db.prepare(sql).run(...params);
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, params: unknown[] = []) => db.prepare(sql).get(...params) as T | undefined,
    transaction: <T>(fn: () => T) => db.transaction(fn)(),
    close: () => db.close(),
  };
}
