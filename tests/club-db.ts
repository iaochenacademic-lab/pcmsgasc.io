import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { Actor, Env } from '../worker/env';

// This adapter executes actual migration SQL, constraints, triggers, and transactions.
// Only the remote D1 transport is replaced; production queries are unmodified.
export function clubDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_club.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string, values: unknown[] = []) => {
    const execute = () => {
      const query = sqlite.prepare(sql);
      const args = values as (string | number | null)[];
      const rows = query.columns().length ? query.all(...args) : [];
      if (!query.columns().length) query.run(...args);
      const changes = Number(sqlite.prepare('SELECT changes() n').get()!.n);
      return { success: true, results: rows, meta: { changes, duration: 0 } };
    };
    return {
      bind: (...args: unknown[]) => prepare(sql, args),
      first: async (column?: string) => { const row = execute().results[0]; return column ? row?.[column] ?? null : row ?? null; },
      all: async () => execute(),
      run: async () => execute(),
      execute,
    };
  };
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  const env = { DB: db, CHECKIN_SECRET: 'synthetic-test-only-checkin-secret' } as Env;
  function member(id: string, overrides: Partial<Actor> = {}): Actor {
    const actor: Actor = { id, studentId: `test-${id}`, name: `測試${id}`, className: '測試班', role: 'member',
      active: true, mustChangePassword: false, sessionVersion: 1, joinedAt: Date.parse('2026-09-01T00:00:00+08:00'), ...overrides };
    sqlite.prepare(`INSERT INTO members(id,student_id,name,class_name,role,active,must_change_password,session_version,joined_at,password_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(actor.id,actor.studentId,actor.name,actor.className,actor.role,+actor.active,+actor.mustChangePassword,
      actor.sessionVersion,actor.joinedAt,'SYNTHETIC-SECRET-MUST-NEVER-EXPORT');
    return actor;
  }
  return { sqlite, env, member };
}
