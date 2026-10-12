import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, pointsFromField, query, toDateInput, toTimestamp } from '../web/api';

afterEach(() => vi.unstubAllGlobals());

describe('browser API and input boundaries', () => {
  it('sends authenticated same-origin JSON with the requested HTTP method', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/api/admin/classes/class-test/attendance', 'PUT', { memberId: 'fictional-member', status: 'present', shared: true, reason: '虛構測試補登' })).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith('/api/admin/classes/class-test/attendance', expect.objectContaining({ method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: 'fictional-member', status: 'present', shared: true, reason: '虛構測試補登' }) }));
  });
  it('keeps server validation errors available to the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: '簽到碼已過期或不正確，請重新掃碼。' }, { status: 400 })));
    await expect(api('/api/checkin', 'POST', { classId: 'fictional-class', code: '000000' })).rejects.toMatchObject({ status: 400, message: '簽到碼已過期或不正確，請重新掃碼。' });
  });
  it('requests reauthentication when a protected request loses its session', async () => {
    const windowEvents = new EventTarget(); const expired = vi.fn(); windowEvents.addEventListener('session-expired', expired);
    vi.stubGlobal('window', windowEvents);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: '登入已失效，請重新登入。' }, { status: 401 })));
    await expect(api('/api/ledger')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledOnce();
  });
  it('returns a Chinese connectivity error without changing a failed write into success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/api/admin/adjustments', 'POST', {})).rejects.toThrow('暫時無法連線');
  });
  it('does not sign out a valid session for an incorrect current password', async () => {
    const windowEvents = new EventTarget(); const expired = vi.fn(); windowEvents.addEventListener('session-expired', expired);
    vi.stubGlobal('window', windowEvents);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: '學號或密碼不正確。' }, { status: 401 })).mockResolvedValueOnce(Response.json({ user: { id: 'fictional-member' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/api/auth/change-password', 'POST', {})).rejects.toBeInstanceOf(ApiError);
    expect(expired).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenLastCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'same-origin' }));
  });
  it('does not present a non-JSON response as a successful operation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>unavailable</html>')));
    await expect(api('/api/admin/members', 'POST', {})).rejects.toThrow('伺服器回應無法讀取');
  });
  it('converts visible decimal points to integer hundredths without accepting extra precision', () => {
    const form = new FormData(); form.set('points', '2.5'); expect(pointsFromField(form, 'points')).toBe(250);
    form.set('points', '-1.01'); expect(pointsFromField(form, 'points')).toBe(-101);
    form.set('points', '0'); expect(pointsFromField(form, 'points')).toBe(0);
    form.set('points', '0.001'); expect(() => pointsFromField(form, 'points')).toThrow('最多兩位小數');
    form.set('points', ''); expect(() => pointsFromField(form, 'points')).toThrow();
  });
  it('interprets entered dates as UTC+8 regardless of the device timezone', () => {
    expect(toTimestamp('2026-10-12T12:55')).toBe(Date.parse('2026-10-12T04:55:00.000Z'));
    expect(toDateInput(Date.parse('2026-10-11T20:30:00.000Z'))).toBe('2026-10-12T04:30');
    expect(toTimestamp('')).toBeNull();
  });
  it('encodes cycle and member identifiers as query parameters', () => {
    expect(query('cycle+1', { memberId: 'member&2' })).toBe('?memberId=member%262&cycleId=cycle%2B1');
  });
});
