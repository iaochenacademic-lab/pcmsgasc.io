import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { AccountService, type MemberPatch, type NewMember } from './auth-service';

/** One SQLite Durable Object per immutable student ID. Bcrypt runs here. */
export class Account extends DurableObject<Env> {
  private readonly accounts: AccountService;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.accounts = new AccountService(env.DB);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS account_identity (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), student_id TEXT NOT NULL)');
    });
  }
  private identify(studentId: string) {
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO account_identity (singleton, student_id) VALUES (1, ?)', studentId);
    const identity = this.ctx.storage.sql.exec<{ student_id: string }>('SELECT student_id FROM account_identity WHERE singleton = 1').one();
    if (identity.student_id !== studentId) throw new Error('Account routing mismatch');
  }
  async login(studentId: string, password: string) { this.identify(studentId); return this.accounts.login(studentId, password); }
  async changePassword(studentId: string, sessionId: string, current: string, next: string) { this.identify(studentId); return this.accounts.changePassword(studentId, sessionId, current, next); }
  async create(input: NewMember, adminId: string) { this.identify(input.studentId); return this.accounts.create(input, adminId); }
  async update(studentId: string, adminId: string, patch: MemberPatch) { this.identify(studentId); return this.accounts.update(studentId, adminId, patch); }
  async resetPassword(studentId: string, adminId: string) { this.identify(studentId); return this.accounts.resetPassword(studentId, adminId); }
}
