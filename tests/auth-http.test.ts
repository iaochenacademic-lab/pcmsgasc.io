import { beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from '../worker/auth-service';
import { handleAuth, refreshCookie, requireActor } from '../worker/auth';
import type { Env } from '../worker/env';
import { database, PASSWORD, seed } from './auth-helpers';

describe('authentication HTTP boundary', () => {
  let fixture: ReturnType<typeof database>;
  let env: Env;
  beforeEach(() => {
    fixture = database(); seed(fixture.sqlite);
    seed(fixture.sqlite, { id: 'admin-1', student_id: 'ADMIN', role: 'admin', must_change_password: 0 });
    const services = new Map<string, AccountService>();
    env = { DB: fixture.db, SESSION_SECRET: 'test-only-secret-32-bytes-minimum-long', AUTH: { getByName(name: string) {
      if (!services.has(name)) services.set(name, new AccountService(fixture.db));
      return services.get(name);
    } } } as unknown as Env;
  });
  function request(path: string, body?: unknown, cookie?: string, method = 'POST') {
    return new Request(`https://club.example${path}`, { method, headers: { 'content-type': 'application/json', origin: 'https://club.example', ...(cookie ? { cookie } : {}) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
  }
  async function login(studentId = 'ST001') {
    const response = await handleAuth(request('/api/auth/login', { studentId, password: PASSWORD }), env, '/api/auth/login');
    expect(response?.status).toBe(200);
    return response!.headers.get('set-cookie')!;
  }
  async function caught(work: () => Promise<unknown>) {
    try { await work(); return 200; } catch (error) { return error instanceof Response ? error.status : 500; }
  }

  it('issues private secure cookies and enforces first-password gate server side', async () => {
    const cookie = await login();
    expect(cookie).toContain('Secure'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
    const req = request('/api/anything', undefined, cookie, 'GET');
    expect(await caught(() => requireActor(req, env))).toBe(403);
    expect((await requireActor(req, env, true)).studentId).toBe('ST001');
    const me = await handleAuth(request('/api/auth/me', undefined, cookie, 'GET'), env, '/api/auth/me');
    expect(await me?.json()).toMatchObject({ user: { mustChangePassword: true } });
  });

  it('rechecks current role, disabled state, and session version for each request', async () => {
    seed(fixture.sqlite, { id: 'admin-2', student_id: 'ADMIN2', role: 'admin', must_change_password: 0 });
    const cookie = await login('ADMIN');
    const req = request('/api/admin/members', undefined, cookie, 'GET');
    expect((await requireActor(req, env)).role).toBe('admin');
    fixture.sqlite.prepare("UPDATE members SET session_version = 2 WHERE id = 'admin-1'").run();
    expect(await caught(() => requireActor(req, env))).toBe(401);
    fixture.sqlite.prepare("UPDATE members SET session_version = 1, active = 0 WHERE id = 'admin-1'").run();
    expect(await caught(() => requireActor(req, env))).toBe(401);
  });

  it('slides valid session expiry on an error response without reviving expired sessions', async () => {
    const cookie = await login(); const req = request('/api/auth/change-password', {}, cookie);
    fixture.sqlite.prepare('UPDATE auth_sessions SET expires_at = ?').run(Date.now() + 60_000);
    const response = await refreshCookie(req, env, Response.json({ error: '測試' }, { status: 400 }));
    expect(response.status).toBe(400); expect(response.headers.get('set-cookie')).toContain('Max-Age=2592000');
    const row = fixture.sqlite.prepare('SELECT expires_at FROM auth_sessions').get();
    expect(Number(row?.expires_at)).toBeGreaterThan(Date.now() + 29 * 86400_000);
    fixture.sqlite.prepare('UPDATE auth_sessions SET expires_at = ?').run(Date.now() - 1);
    expect(await caught(() => requireActor(req, env, true))).toBe(401);
    expect((await refreshCookie(req, env, Response.json({}))).headers.get('set-cookie')).toBeNull();
  });

  it('logout revokes the server session and clears the cookie', async () => {
    const cookie = await login();
    const response = await handleAuth(request('/api/auth/logout', {}, cookie), env, '/api/auth/logout');
    expect(response?.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await caught(() => requireActor(request('/api/auth/me', undefined, cookie, 'GET'), env, true))).toBe(401);
  });

  it('rejects forged cookies, wrong methods, and member access to admin APIs', async () => {
    expect(await caught(() => requireActor(request('/api/auth/me', undefined, '__Host-club_session=forged', 'GET'), env, true))).toBe(401);
    fixture.sqlite.prepare("UPDATE members SET must_change_password = 0 WHERE id = 'member-1'").run();
    const cookie = await login();
    expect(await caught(() => handleAuth(request('/api/admin/members', undefined, cookie, 'GET'), env, '/api/admin/members'))).toBe(403);
    expect((await handleAuth(request('/api/auth/login', undefined, undefined, 'GET'), env, '/api/auth/login'))?.status).toBe(405);
  });

  it('denies a stale password-change session after a reset', async () => {
    const cookie = await login();
    const stub = env.AUTH.getByName('ST001');
    await stub.resetPassword('ST001', 'admin-1');
    expect(await caught(() => handleAuth(request('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'changed-test-password' }, cookie), env, '/api/auth/change-password'))).toBe(401);
  });

  it('exposes member management without hashes and revokes an old cookie after admin reset', async () => {
    const memberCookie = await login(); const adminCookie = await login('ADMIN');
    const created = await handleAuth(request('/api/admin/members', { studentId: 'STNEW', name: '新同學', className: '2B' }, adminCookie), env, '/api/admin/members');
    expect(created?.status).toBe(201);
    const body = await created!.json() as { member: { id: string }; initialPassword: string };
    expect(body.initialPassword.length).toBeGreaterThanOrEqual(12);
    const listed = await handleAuth(request('/api/admin/members', undefined, adminCookie, 'GET'), env, '/api/admin/members');
    expect(await listed!.text()).not.toContain('password_hash');
    const path = '/api/admin/members/member-1/reset-password';
    const reset = await handleAuth(request(path, {}, adminCookie), env, path);
    expect(reset?.status).toBe(200);
    expect(await caught(() => requireActor(request('/api/auth/me', undefined, memberCookie, 'GET'), env, true))).toBe(401);
  });
});
