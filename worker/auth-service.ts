import type { Actor } from './env';
import { compare, hash } from 'bcryptjs';
export interface PasswordEngine { hash(password: string): Promise<string>; compare(password: string, hash: string): Promise<boolean> }
export type Failure = { ok: false; status: number; error: string };
export type Result<T> = ({ ok: true } & T) | Failure;
export type LoginResult = Result<{ user: Actor; sessionId: string; expiresAt: number }>;
export interface NewMember { studentId: string; name: string; className: string; role: 'admin' | 'member'; joinedAt?: number }
export interface MemberPatch { name?: string; className?: string; role?: 'admin' | 'member'; active?: boolean }
export interface MemberRow {
  id: string; student_id: string; name: string; class_name: string; role: 'admin' | 'member';
  active: number; must_change_password: number; session_version: number; joined_at: number;
  password_hash: string; failure_count: number; locked_until: number; auth_revision: number;
}
export const SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
export const PUBLIC_MEMBER_COLUMNS = 'id, student_id, name, class_name, role, active, must_change_password, session_version, joined_at';
// Public synthetic cost-12 value, never a real account's password hash.
const DUMMY_HASH = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
const realPasswords: PasswordEngine = { hash: password => hash(password, 12), compare };
const denied = (): Failure => ({ ok: false, status: 401, error: '學號或密碼不正確，或帳號已停用。' });
const forbidden = (): Failure => ({ ok: false, status: 403, error: '只有管理員可以執行此操作。' });
const bad = (error: string): Failure => ({ ok: false, status: 400, error });
const conflict = (): Failure => ({ ok: false, status: 409, error: '帳號狀態已變更，請重新整理後再試。' });
const locked = (): Failure => ({ ok: false, status: 429, error: '登入嘗試過多，請於五分鐘後再試。' });
const adminPredicate = "EXISTS (SELECT 1 FROM members AS administrator WHERE administrator.id = ? AND administrator.role = 'admin' AND administrator.active = 1 AND administrator.must_change_password = 0)";

export function toActor(row: Pick<MemberRow, 'id'|'student_id'|'name'|'class_name'|'role'|'active'|'must_change_password'|'session_version'|'joined_at'>): Actor {
  return { id: row.id, studentId: row.student_id, name: row.name, className: row.class_name, role: row.role, active: row.active === 1, mustChangePassword: row.must_change_password === 1, sessionVersion: row.session_version, joinedAt: row.joined_at };
}
export function validStudentId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value); }
export function validPassword(value: unknown, isNew = false): value is string {
  return typeof value === 'string' && [...value].length >= (isNew ? 12 : 1) && new TextEncoder().encode(value).length <= 72;
}
export function randomPassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), n => n.toString(16).padStart(2, '0')).join('');
}
function validProfile(input: NewMember): boolean {
  return validStudentId(input.studentId) && typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 80
    && typeof input.className === 'string' && input.className.length <= 40 && ['admin', 'member'].includes(input.role)
    && (input.joinedAt === undefined || (Number.isSafeInteger(input.joinedAt) && input.joinedAt >= 0));
}

export class AccountService {
  // Only in-flight ordering lives in memory. Every authorization condition and
  // counter is durable in D1, with conditional writes protecting external changes.
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: D1Database, private readonly passwords: PasswordEngine = realPasswords, private readonly now: () => number = Date.now) {}
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.tail.then(operation); this.tail = current.catch(() => undefined); return current;
  }
  private row(studentId: string) { return this.db.prepare('SELECT * FROM members WHERE student_id = ?').bind(studentId).first<MemberRow>(); }
  private async admin(id: string): Promise<boolean> {
    return !!await this.db.prepare("SELECT id FROM members WHERE id = ? AND role = 'admin' AND active = 1 AND must_change_password = 0").bind(id).first();
  }
  private audit(operation: string, actor: string, target: string, action: string, now: number) {
    return this.db.prepare('INSERT INTO account_audit (id, actor_id, target_id, action, created_at) SELECT ?, ?, id, ?, ? FROM members WHERE id = ? AND last_operation = ?').bind(operation, actor, action, now, target, operation);
  }
  private purgeSessions(id: string) {
    return this.db.prepare('DELETE FROM auth_sessions WHERE member_id = ? AND session_version != (SELECT session_version FROM members WHERE id = ?)').bind(id, id);
  }
  private async failAttempt(row: MemberRow, now: number): Promise<Failure> {
    await this.db.prepare(`UPDATE members SET
      failure_count = CASE WHEN locked_until > 0 AND locked_until <= ? THEN 1 ELSE MIN(failure_count + 1, 10) END,
      locked_until = CASE WHEN locked_until > 0 AND locked_until <= ? THEN 0 WHEN failure_count >= 9 THEN ? ELSE 0 END,
      auth_revision = auth_revision + 1
      WHERE id = ? AND active = 1 AND session_version = ? AND password_hash = ? AND locked_until <= ?`)
      .bind(now, now, now + 300_000, row.id, row.session_version, row.password_hash, now).run();
    const updated = await this.row(row.student_id);
    return updated && updated.locked_until > now ? locked() : denied();
  }
  private sessionInsert(id: string, memberId: string, operation: string, now: number) {
    return this.db.prepare('INSERT INTO auth_sessions (id, member_id, session_version, created_at, expires_at) SELECT ?, id, session_version, ?, ? FROM members WHERE id = ? AND active = 1 AND last_operation = ?')
      .bind(id, now, now + SESSION_LIFETIME, memberId, operation);
  }
  private async finishSession(studentId: string, sessionId: string, now: number): Promise<LoginResult> {
    const row = await this.row(studentId);
    const session = await this.db.prepare('SELECT id FROM auth_sessions WHERE id = ? AND member_id = ? AND session_version = ? AND expires_at > ?')
      .bind(sessionId, row?.id ?? '', row?.session_version ?? 0, now).first();
    if (!row || row.active !== 1 || !session) return denied();
    return { ok: true, user: toActor(row), sessionId, expiresAt: now + SESSION_LIFETIME };
  }
  login(studentId: string, password: string): Promise<LoginResult> {
    return this.exclusive(async () => {
      if (!validStudentId(studentId) || !validPassword(password)) return bad('請輸入有效學號與密碼；密碼最多 72 bytes。');
      const row = await this.row(studentId);
      const matches = await this.passwords.compare(password, row?.password_hash ?? DUMMY_HASH);
      const now = this.now();
      if (!row || row.active !== 1) return denied();
      if (row.locked_until > now) return locked();
      if (!matches) return this.failAttempt(row, now);
      const operation = crypto.randomUUID(); const sessionId = crypto.randomUUID();
      const result = await this.db.batch([
        this.db.prepare('UPDATE members SET failure_count = 0, locked_until = 0, auth_revision = auth_revision + 1, last_operation = ? WHERE id = ? AND active = 1 AND session_version = ? AND password_hash = ? AND auth_revision = ? AND locked_until <= ?')
          .bind(operation, row.id, row.session_version, row.password_hash, row.auth_revision, now),
        this.db.prepare('DELETE FROM auth_sessions WHERE member_id = ? AND expires_at <= ?').bind(row.id, now),
        this.sessionInsert(sessionId, row.id, operation, now),
      ]);
      if (!result[0].meta.changes) return denied();
      return this.finishSession(studentId, sessionId, now);
    });
  }
  changePassword(studentId: string, sessionId: string, current: string, next: string): Promise<LoginResult> {
    return this.exclusive(async () => {
      if (!validPassword(current) || !validPassword(next, true)) return bad('新密碼至少 12 個字元，UTF-8 長度最多 72 bytes。');
      const row = await this.row(studentId); const now = this.now();
      if (!row || row.active !== 1) return denied();
      const session = await this.db.prepare('SELECT id FROM auth_sessions WHERE id = ? AND member_id = ? AND session_version = ? AND expires_at > ?').bind(sessionId, row.id, row.session_version, now).first();
      if (!session) return denied();
      if (row.locked_until > now) return locked();
      if (!await this.passwords.compare(current, row.password_hash)) return this.failAttempt(row, this.now());
      if (current === next) return bad('新密碼必須與目前密碼不同。');
      const passwordHash = await this.passwords.hash(next); const at = this.now();
      const operation = crypto.randomUUID(); const newSession = crypto.randomUUID();
      const result = await this.db.batch([
        this.db.prepare(`UPDATE members SET password_hash = ?, must_change_password = 0, session_version = session_version + 1, auth_revision = auth_revision + 1, failure_count = 0, locked_until = 0, last_operation = ?
          WHERE id = ? AND active = 1 AND session_version = ? AND auth_revision = ? AND EXISTS (SELECT 1 FROM auth_sessions WHERE id = ? AND member_id = members.id AND expires_at > ?)`)
          .bind(passwordHash, operation, row.id, row.session_version, row.auth_revision, sessionId, at),
        this.purgeSessions(row.id), this.sessionInsert(newSession, row.id, operation, at), this.audit(operation, row.id, row.id, 'change_password', at),
      ]);
      if (!result[0].meta.changes) return denied();
      return this.finishSession(studentId, newSession, at);
    });
  }
  create(input: NewMember, adminId: string): Promise<Result<{ member: Actor; initialPassword: string }>> {
    return this.exclusive(async () => {
      if (!await this.admin(adminId)) return forbidden();
      if (!validProfile(input)) return bad('請檢查學號、姓名、班別與角色。');
      if (await this.row(input.studentId)) return { ok: false, status: 409, error: '此學號已存在。' };
      const initialPassword = randomPassword(); const passwordHash = await this.passwords.hash(initialPassword);
      const id = crypto.randomUUID(); const operation = crypto.randomUUID(); const now = this.now();
      const results = await this.db.batch([
        this.db.prepare(`INSERT INTO members (id, student_id, name, class_name, role, joined_at, password_hash, last_operation)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${adminPredicate} ON CONFLICT(student_id) DO NOTHING`)
          .bind(id, input.studentId, input.name.trim(), input.className.trim(), input.role, input.joinedAt ?? now, passwordHash, operation, adminId),
        this.audit(operation, adminId, id, 'create', now),
      ]);
      if (!results[0].meta.changes) return conflict();
      return { ok: true, member: toActor((await this.row(input.studentId))!), initialPassword };
    });
  }
  update(studentId: string, adminId: string, patch: MemberPatch): Promise<Result<{ member: Actor }>> {
    return this.exclusive(async () => {
      if (!await this.admin(adminId)) return forbidden();
      const row = await this.row(studentId); if (!row) return { ok: false, status: 404, error: '找不到此帳號。' };
      const keys = Object.keys(patch);
      if (!keys.length || keys.some(key => !['name', 'className', 'role', 'active'].includes(key))) return bad('沒有可更新的欄位，或包含不允許的欄位。');
      const name = patch.name ?? row.name; const className = patch.className ?? row.class_name; const role = patch.role ?? row.role;
      if (!validProfile({ studentId, name, className, role }) || (patch.active !== undefined && typeof patch.active !== 'boolean')) return bad('帳號資料格式不正確。');
      const active = patch.active === undefined ? row.active : Number(patch.active);
      const revoke = active !== row.active || role !== row.role ? 1 : 0;
      const operation = crypto.randomUUID(); const now = this.now();
      try {
        const results = await this.db.batch([
          this.db.prepare(`UPDATE members SET name = ?, class_name = ?, role = ?, active = ?, session_version = session_version + ?, auth_revision = auth_revision + 1, last_operation = ?
            WHERE id = ? AND session_version = ? AND auth_revision = ? AND ${adminPredicate}`)
            .bind(name.trim(), className.trim(), role, active, revoke, operation, row.id, row.session_version, row.auth_revision, adminId),
          this.purgeSessions(row.id), this.audit(operation, adminId, row.id, 'update', now),
        ]);
        if (!results[0].meta.changes) return conflict();
      } catch (error) {
        if (error instanceof Error && error.message.includes('last_active_admin')) return { ok: false, status: 409, error: '至少須保留一位有效管理員。' };
        throw error;
      }
      return { ok: true, member: toActor((await this.row(studentId))!) };
    });
  }
  resetPassword(studentId: string, adminId: string): Promise<Result<{ member: Actor; initialPassword: string }>> {
    return this.exclusive(async () => {
      if (!await this.admin(adminId)) return forbidden();
      const row = await this.row(studentId); if (!row) return { ok: false, status: 404, error: '找不到此帳號。' };
      const initialPassword = randomPassword(); const passwordHash = await this.passwords.hash(initialPassword);
      const operation = crypto.randomUUID(); const now = this.now();
      const results = await this.db.batch([
        this.db.prepare(`UPDATE members SET password_hash = ?, must_change_password = 1, failure_count = 0, locked_until = 0, session_version = session_version + 1, auth_revision = auth_revision + 1, last_operation = ?
          WHERE id = ? AND session_version = ? AND auth_revision = ? AND ${adminPredicate}`)
          .bind(passwordHash, operation, row.id, row.session_version, row.auth_revision, adminId),
        this.purgeSessions(row.id), this.audit(operation, adminId, row.id, 'reset_password', now),
      ]);
      if (!results[0].meta.changes) return conflict();
      return { ok: true, member: toActor((await this.row(studentId))!), initialPassword };
    });
  }
}
