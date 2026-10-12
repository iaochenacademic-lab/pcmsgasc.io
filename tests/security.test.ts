import { describe, expect, it } from 'vitest';
import { checkWriteRequest, protectResponse } from '../worker/http';

describe('HTTP boundary', () => {
  it('rejects cross-site writes before any data changes', async () => {
    const req = new Request('https://club.example/api/checkin', { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}' });
    await expect(checkWriteRequest(req)).rejects.toMatchObject({ status: 403 });
  });
  it('requires an exact origin even with a similar hostname', async () => {
    const req = new Request('https://club.example/api/checkin', { method: 'POST', headers: { Origin: 'https://club.example.attacker.org', 'Content-Type': 'application/json' }, body: '{}' });
    await expect(checkWriteRequest(req)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects unauthenticated-form content type and missing origin', async () => {
    await expect(checkWriteRequest(new Request('https://club.example/api/checkin', {method:'POST',body:'x=1'}))).rejects.toMatchObject({status:403});
    await expect(checkWriteRequest(new Request('https://club.example/api/checkin', {method:'POST',headers:{Origin:'https://club.example'},body:'x=1'}))).rejects.toMatchObject({status:415});
  });
  it('bounds chunked JSON request bodies without trusting content-length', async () => {
    const req = new Request('https://club.example/api/checkin', {method:'POST',headers:{Origin:'https://club.example','Content-Type':'application/json'},body:'x'.repeat(65537)});
    await expect(checkWriteRequest(req)).rejects.toMatchObject({status:413});
  });
  it('preserves a valid body for the actual route handler', async () => {
    const req = new Request('https://club.example/api/checkin', {method:'POST',headers:{Origin:'https://club.example','Content-Type':'application/json'},body:'{"code":"123456"}'});
    const checked = await checkWriteRequest(req);
    expect(await checked.json()).toEqual({code:'123456'});
  });
  it('makes private responses uncacheable and blocks framing', () => {
    const res = protectResponse(Response.json({ok:true}), true);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
