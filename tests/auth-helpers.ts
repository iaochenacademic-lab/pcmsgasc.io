import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { hashSync } from 'bcryptjs';
import type { Env } from '../worker/env';

export function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
  function prepare(sql: string) {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...args: (string | number | null)[]) { values = args; return statement; },
      async first(column?: string) {
        const row = sqlite.prepare(sql).get(...values);
        return row ? (column ? row[column] : row) : null;
      },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} }; },
      run() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(statement.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as Env['DB'];
  return { db, sqlite };
}

// Entirely fabricated credentials; no production data is used by these tests.
export const PASSWORD = 'test-only-long-password';
export const PASSWORD_HASH = hashSync(PASSWORD, 12);
export function seed(db: DatabaseSync, overrides: Record<string, string | number> = {}) {
  const row = { id: 'member-1', student_id: 'ST001', name: '測試同學', class_name: '1A', role: 'member', active: 1, must_change_password: 1, session_version: 1, joined_at: 1, password_hash: PASSWORD_HASH, ...overrides };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO members (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row));
}
