import type { Actor, Env } from './env';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { PUBLIC_MEMBER_COLUMNS, SESSION_LIFETIME, toActor, validPassword, validStudentId, type LoginResult, type MemberPatch, type MemberRow, type NewMember } from './auth-service';

const COOKIE = '__Host-club_session';
const ISSUER = 'club-management';
const AUDIENCE = 'club-browser';
const fail = (status: number, error: string): Response => Response.json({ error }, { status });
const sessionCookie = (value: string, seconds = SESSION_LIFETIME / 1000) => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
const publicColumns = PUBLIC_MEMBER_COLUMNS.split(', ').map(column => `m.${column}`).join(', ');
type SessionMember = MemberRow & { session_id: string; expires_at: number };

async function key(env: Env) {
  if (typeof env.SESSION_SECRET !== 'string' || new TextEncoder().encode(env.SESSION_SECRET).length < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SESSION_SECRET)));
}
async function encryptSession(sessionId: string, env: Env, expiresAt: number): Promise<string> {
  return new EncryptJWT({ sid: sessionId }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime(Math.floor(expiresAt / 1000)).encrypt(await key(env));
}
async function readSessionId(request: Request, env: Env): Promise<string | null> {
  const cookies = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
  if (cookies.length !== 1) return null;
  const token = cookies[0].slice(COOKIE.length + 1); if (token.length > 4096) return null;
  // Configuration failures should be visible to the operator, not reported as bad credentials.
  const secret = await key(env);
  try {
    const { payload } = await jwtDecrypt(token, secret, { issuer: ISSUER, audience: AUDIENCE, keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] });
    return typeof payload.sid === 'string' && /^[a-f0-9-]{36}$/.test(payload.sid) ? payload.sid : null;
  } catch { return null; }
}
async function sessionMember(request: Request, env: Env): Promise<SessionMember | null> {
  const id = await readSessionId(request, env); if (!id) return null;
  return env.DB.prepare(`SELECT ${publicColumns}, s.id AS session_id, s.expires_at FROM auth_sessions s JOIN members m ON m.id = s.member_id
    WHERE s.id = ? AND s.expires_at > ? AND m.active = 1 AND s.session_version = m.session_version`).bind(id, Date.now()).first<SessionMember>();
}
export async function requireActor(request: Request, env: Env, allowMustChange = false): Promise<Actor> {
  const row = await sessionMember(request, env);
  if (!row) throw fail(401, '登入已失效，請重新登入。');
  const actor = toActor(row);
  if (!allowMustChange && actor.mustChangePassword) throw fail(403, '請先更改初始密碼。');
  return actor;
}
export async function refreshCookie(request: Request, env: Env, response: Response): Promise<Response> {
  // Login/change-password/logout own their cookie and must never be overwritten.
  if (response.headers.has('set-cookie')) return response;
  const row = await sessionMember(request, env); if (!row) return response;
  const now = Date.now(); const expiresAt = now + SESSION_LIFETIME;
  const result = await env.DB.prepare(`UPDATE auth_sessions SET expires_at = MAX(expires_at, ?) WHERE id = ? AND expires_at > ?
    AND EXISTS (SELECT 1 FROM members m WHERE m.id = auth_sessions.member_id AND m.active = 1 AND m.session_version = auth_sessions.session_version)`)
    .bind(expiresAt, row.session_id, now).run();
  if (!result.meta.changes) return response;
  const headers = new Headers(response.headers); headers.set('set-cookie', sessionCookie(await encryptSession(row.session_id, env, expiresAt)));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw fail(415, '請以 JSON 格式傳送資料。');
  if (!request.body) return {};
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 8192) { await reader.cancel(); throw fail(413, '資料內容過大。'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail(400, '資料格式不正確。');
    return parsed as Record<string, unknown>;
  } catch (error) { if (error instanceof Response) throw error; throw fail(400, '資料格式不正確。'); }
}
async function loginResponse(result: LoginResult, env: Env): Promise<Response> {
  if (!result.ok) return fail(result.status, result.error);
  return Response.json({ user: result.user }, { headers: { 'set-cookie': sessionCookie(await encryptSession(result.sessionId, env, result.expiresAt)) } });
}
function resultResponse<T extends { ok: boolean }>(result: T & { status?: number; error?: string }, status = 200): Response {
  if (!result.ok) return fail(result.status ?? 500, result.error ?? '操作失敗。');
  const { ok: _ok, ...data } = result; return Response.json(data, { status });
}
async function dispatch(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/api/auth/login') {
    if (request.method !== 'POST') return fail(405, '此操作僅接受 POST。');
    const body = await readJson(request);
    if (!validStudentId(body.studentId) || !validPassword(body.password)) return fail(400, '請輸入有效學號與密碼；密碼最多 72 bytes。');
    return loginResponse(await env.AUTH.getByName(body.studentId).login(body.studentId, body.password), env);
  }
  if (path === '/api/auth/logout') {
    if (request.method !== 'POST') return fail(405, '此操作僅接受 POST。');
    const sessionId = await readSessionId(request, env);
    if (sessionId) await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(sessionId).run();
    return Response.json({ ok: true }, { headers: { 'set-cookie': sessionCookie('', 0) } });
  }
  if (path === '/api/auth/me') {
    if (request.method !== 'GET') return fail(405, '此操作僅接受 GET。');
    return Response.json({ user: await requireActor(request, env, true) });
  }
  if (path === '/api/auth/change-password') {
    if (request.method !== 'POST') return fail(405, '此操作僅接受 POST。');
    const actor = await requireActor(request, env, true); const sessionId = await readSessionId(request, env);
    const body = await readJson(request);
    if (!validPassword(body.currentPassword) || !validPassword(body.newPassword, true)) return fail(400, '新密碼至少 12 個字元，UTF-8 長度最多 72 bytes。');
    return loginResponse(await env.AUTH.getByName(actor.studentId).changePassword(actor.studentId, sessionId!, body.currentPassword, body.newPassword), env);
  }
  const memberMatch = path.match(/^\/api\/admin\/members\/([A-Za-z0-9_-]+)(\/reset-password)?$/);
  if (path !== '/api/admin/members' && !memberMatch) return null;
  const actor = await requireActor(request, env);
  if (actor.role !== 'admin') throw fail(403, '只有管理員可以管理帳號。');
  if (path === '/api/admin/members') {
    if (request.method === 'GET') {
      const rows = await env.DB.prepare(`SELECT ${PUBLIC_MEMBER_COLUMNS} FROM members ORDER BY role, class_name, student_id`).all<MemberRow>();
      return Response.json({ members: rows.results.map(toActor) });
    }
    if (request.method !== 'POST') return fail(405, '此操作僅接受 GET 或 POST。');
    const body = await readJson(request);
    if (!validStudentId(body.studentId) || typeof body.name !== 'string' || typeof body.className !== 'string'
      || (body.role !== undefined && body.role !== 'member' && body.role !== 'admin') || (body.joinedAt !== undefined && typeof body.joinedAt !== 'number')) return fail(400, '帳號資料格式不正確。');
    const input: NewMember = { studentId: body.studentId, name: body.name, className: body.className, role: body.role ?? 'member', joinedAt: body.joinedAt };
    return resultResponse(await env.AUTH.getByName(input.studentId).create(input, actor.id), 201);
  }
  const target = await env.DB.prepare('SELECT student_id FROM members WHERE id = ?').bind(memberMatch![1]).first<{ student_id: string }>();
  if (!target) return fail(404, '找不到此帳號。');
  if (memberMatch![2]) {
    if (request.method !== 'POST') return fail(405, '此操作僅接受 POST。');
    return resultResponse(await env.AUTH.getByName(target.student_id).resetPassword(target.student_id, actor.id));
  }
  if (request.method !== 'PATCH') return fail(405, '此操作僅接受 PATCH。');
  const body = await readJson(request);
  return resultResponse(await env.AUTH.getByName(target.student_id).update(target.student_id, actor.id, body as MemberPatch));
}

export async function handleAuth(request: Request, env: Env, path: string): Promise<Response | null> {
  try {
    const response = await dispatch(request, env, path);
    return response ? await refreshCookie(request, env, response) : null;
  } catch (error) {
    if (error instanceof Response) throw await refreshCookie(request, env, error);
    throw error;
  }
}
