import type { SqlDb } from '../../electron/db/sqlite';

/** Test-only SQLite driver using Node's built-in node:sqlite (same SQL as production better-sqlite3). */
export function openNodeSqlite(file: string): SqlDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (f: string) => any };
  const db = new DatabaseSync(file);
  let depth = 0;
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: (sql, params = []) => db.prepare(sql).all(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    transaction: <T>(fn: () => T): T => {
      const name = `sp${depth}`;
      if (depth === 0) db.exec('BEGIN'); else db.exec(`SAVEPOINT ${name}`);
      depth++;
      try {
        const r = fn();
        depth--;
        if (depth === 0) db.exec('COMMIT'); else db.exec(`RELEASE ${name}`);
        return r;
      } catch (e) {
        depth--;
        if (depth === 0) db.exec('ROLLBACK'); else db.exec(`ROLLBACK TO ${name}`);
        throw e;
      }
    },
    close: () => db.close(),
  };
}
