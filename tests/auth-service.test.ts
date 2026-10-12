import { beforeEach, describe, expect, it } from 'vitest';
import { compare, getRounds } from 'bcryptjs';
import { AccountService, type PasswordEngine } from '../worker/auth-service';
import { database, PASSWORD, PASSWORD_HASH, seed } from './auth-helpers';

describe('account safety against real SQLite', () => {
  let fixture: ReturnType<typeof database>;
  let now: number;
  let service: AccountService;
  beforeEach(() => {
    fixture = database(); now = 1_800_000_000_000;
    seed(fixture.sqlite);
    seed(fixture.sqlite, { id: 'admin-1', student_id: 'ADMIN', role: 'admin', must_change_password: 0 });
    service = new AccountService(fixture.db, undefined, () => now);
  });

  it('does a cost-12 comparison for an unknown account and issues no session', async () => {
    let observedRounds = 0;
    const engine: PasswordEngine = { hash: async () => PASSWORD_HASH, compare: async (_input, hash) => { observedRounds = getRounds(hash); return false; } };
    const result = await new AccountService(fixture.db, engine).login('UNKNOWN', PASSWORD);
    expect(result.ok).toBe(false);
    expect(observedRounds).toBe(12);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()?.n).toBe(0);
  });

  it('locks on the tenth failure, rejects a correct password, and unlocks at five minutes', async () => {
    const engine: PasswordEngine = { hash: async () => PASSWORD_HASH, compare: async (password) => password === PASSWORD };
    service = new AccountService(fixture.db, engine, () => now);
    for (let i = 0; i < 9; i++) expect((await service.login('ST001', 'incorrect')).ok).toBe(false);
    expect((await service.login('ST001', 'incorrect'))).toMatchObject({ ok: false, status: 429 });
    expect((await service.login('ST001', PASSWORD))).toMatchObject({ ok: false, status: 429 });
    now += 299_999;
    expect((await service.login('ST001', PASSWORD))).toMatchObject({ ok: false, status: 429 });
    now++;
    expect((await service.login('ST001', PASSWORD)).ok).toBe(true);
    expect(fixture.sqlite.prepare('SELECT failure_count FROM members WHERE id = ?').get('member-1')?.failure_count).toBe(0);
  });

  it('serializes a successful login after ten concurrent failures without bypassing lockout', async () => {
    const engine: PasswordEngine = { hash: async () => PASSWORD_HASH, compare: async (password) => { await new Promise(r => setTimeout(r, 1)); return password === PASSWORD; } };
    service = new AccountService(fixture.db, engine, () => now);
    const results = await Promise.all([...Array.from({ length: 10 }, () => service.login('ST001', 'incorrect')), service.login('ST001', PASSWORD)]);
    expect(results.every(result => !result.ok)).toBe(true);
    expect(fixture.sqlite.prepare('SELECT failure_count FROM members WHERE id = ?').get('member-1')?.failure_count).toBe(10);
  });

  it('rejects a login when business settlement disables the account during bcrypt comparison', async () => {
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const engine: PasswordEngine = { hash: async () => PASSWORD_HASH, compare: async () => { started(); await gate; return true; } };
    service = new AccountService(fixture.db, engine, () => now);
    const attempt = service.login('ST001', PASSWORD);
    await entered;
    fixture.sqlite.prepare("UPDATE members SET active = 0, session_version = session_version + 1, auth_revision = auth_revision + 1 WHERE id = 'member-1'").run();
    release();
    expect(await attempt).toMatchObject({ ok: false, status: 401 });
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()?.n).toBe(0);
  });

  it('changes password at cost 12, invalidates every old session, and clears first-login gate', async () => {
    const first = await service.login('ST001', PASSWORD);
    const second = await service.login('ST001', PASSWORD);
    if (!first.ok || !second.ok) throw new Error('login failed');
    const result = await service.changePassword('ST001', first.sessionId, PASSWORD, 'new-test-only-password');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.mustChangePassword).toBe(false);
    const row = fixture.sqlite.prepare('SELECT password_hash, session_version FROM members WHERE id = ?').get('member-1');
    expect(getRounds(String(row?.password_hash))).toBe(12);
    expect(await compare('new-test-only-password', String(row?.password_hash))).toBe(true);
    const sessions = fixture.sqlite.prepare('SELECT id FROM auth_sessions').all();
    expect(sessions).toEqual([{ id: result.sessionId }]);
    expect(result.sessionId).not.toBe(first.sessionId);
  });

  it('rejects UTF-8 passwords beyond bcrypt 72-byte limit without changing state', async () => {
    const session = await service.login('ST001', PASSWORD);
    if (!session.ok) throw new Error('login failed');
    const result = await service.changePassword('ST001', session.sessionId, PASSWORD, '密'.repeat(25));
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(fixture.sqlite.prepare('SELECT password_hash FROM members WHERE id = ?').get('member-1')?.password_hash).toBe(PASSWORD_HASH);
  });

  it('requires twelve actual Unicode characters rather than twelve UTF-16 code units', async () => {
    const session = await service.login('ST001', PASSWORD);
    if (!session.ok) throw new Error('login failed');
    expect(await service.changePassword('ST001', session.sessionId, PASSWORD, '😀'.repeat(6))).toMatchObject({ ok: false, status: 400 });
  });

  it('prevents a pending old-password login from surviving an administrator reset', async () => {
    const [login, reset] = await Promise.all([service.login('ST001', PASSWORD), service.resetPassword('ST001', 'admin-1')]);
    expect(login.ok).toBe(true); expect(reset.ok).toBe(true);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()?.n).toBe(0);
    expect((await service.login('ST001', PASSWORD)).ok).toBe(false);
    if (!reset.ok) return;
    expect((await service.login('ST001', reset.initialPassword)).ok).toBe(true);
  });

  it('disables and restores accounts without restoring old sessions', async () => {
    expect((await service.login('ST001', PASSWORD)).ok).toBe(true);
    expect((await service.update('ST001', 'admin-1', { active: false })).ok).toBe(true);
    expect((await service.login('ST001', PASSWORD)).ok).toBe(false);
    expect((await service.update('ST001', 'admin-1', { active: true })).ok).toBe(true);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()?.n).toBe(0);
  });

  it('rejects member privilege escalation and removal of the final active administrator', async () => {
    expect(await service.update('ST001', 'member-1', { role: 'admin' })).toMatchObject({ ok: false, status: 403 });
    expect(await service.update('ADMIN', 'admin-1', { active: false })).toMatchObject({ ok: false, status: 409 });
    expect(await service.update('ADMIN', 'admin-1', { role: 'member' })).toMatchObject({ ok: false, status: 409 });
  });

  it('creates distinct random initial passwords, never overwrites duplicates, and never audits secrets', async () => {
    const a = await service.create({ studentId: 'ST002', name: '測試二', className: '1A', role: 'member' }, 'admin-1');
    const b = await service.create({ studentId: 'ST003', name: '測試三', className: '1A', role: 'member' }, 'admin-1');
    if (!a.ok || !b.ok) throw new Error('create failed');
    expect(a.initialPassword).not.toBe(b.initialPassword);
    expect(a.member.mustChangePassword).toBe(true);
    expect(await service.create({ studentId: 'ST002', name: '覆寫', className: '1B', role: 'member' }, 'admin-1')).toMatchObject({ ok: false, status: 409 });
    const login = await service.login('ST002', a.initialPassword);
    expect(login.ok).toBe(true);
    const audit = JSON.stringify(fixture.sqlite.prepare('SELECT * FROM account_audit').all());
    expect(audit).not.toContain(a.initialPassword);
    expect(audit).not.toContain('$2');
    expect(JSON.stringify(a.member)).not.toContain('password_hash');
  });

  it('handles one hundred simultaneous independent logins using real cost-12 bcrypt and distinct sessions', async () => {
    const services = Array.from({ length: 100 }, (_, i) => {
      seed(fixture.sqlite, { id: `load-${i}`, student_id: `LOAD${i}`, must_change_password: 0 });
      return new AccountService(fixture.db, undefined, () => now);
    });
    const results = await Promise.all(services.map((account, i) => account.login(`LOAD${i}`, PASSWORD)));
    expect(results.every(result => result.ok)).toBe(true);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()?.n).toBe(100);
    expect(new Set(results.map(result => result.ok ? result.sessionId : '')).size).toBe(100);
  }, 180000);
});
