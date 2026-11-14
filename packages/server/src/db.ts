// The server's SQLite database (node:sqlite, built into Node 22), kept in DATA_DIR on a volume. Each feature owns its
// tables: it calls db.migrate('feature', [step1, step2, ...]) at start-up, and steps not yet applied run in order,
// once, inside a transaction. Add a step to change a table; never edit one that has shipped.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type Row = Record<string, SQLInputValue>;
export type Params = SQLInputValue[];

export class Db {
  readonly sql: DatabaseSync;

  /** path ':memory:' gives a throwaway database (tests). */
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.sql.exec('CREATE TABLE IF NOT EXISTS migrations (feature TEXT PRIMARY KEY, step INTEGER NOT NULL)');
  }

  migrate(feature: string, steps: readonly string[]): void {
    const done = (this.get<{ step: number }>('SELECT step FROM migrations WHERE feature = ?', feature)?.step ?? 0);
    for (let i = done; i < steps.length; i++) {
      this.tx(() => {
        this.sql.exec(steps[i]!);
        this.run('INSERT INTO migrations (feature, step) VALUES (?, ?) ON CONFLICT(feature) DO UPDATE SET step = excluded.step', feature, i + 1);
      });
    }
  }

  get<T = Row>(query: string, ...params: Params): T | undefined {
    return this.sql.prepare(query).get(...params) as T | undefined;
  }

  all<T = Row>(query: string, ...params: Params): T[] {
    return this.sql.prepare(query).all(...params) as T[];
  }

  run(query: string, ...params: Params): { changes: number; lastInsertRowid: number } {
    const r = this.sql.prepare(query).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  tx<T>(fn: () => T): T {
    this.sql.exec('BEGIN');
    try {
      const out = fn();
      this.sql.exec('COMMIT');
      return out;
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    }
  }

  /** Writes a consistent copy of the database to path (VACUUM INTO), for backups. */
  backup(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    this.sql.prepare('VACUUM INTO ?').run(path);
  }

  close(): void {
    this.sql.close();
  }
}

export function now(): number {
  return Date.now();
}
