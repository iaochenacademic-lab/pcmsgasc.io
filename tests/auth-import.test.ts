import { describe, expect, it } from 'vitest';
import { compare, getRounds } from 'bcryptjs';
import { importAccounts, type DeliveryEntry, type ImportStore } from '../scripts/import-accounts-core';
import { database } from './auth-helpers';

describe('private account import', () => {
  it('preserves the source administrator password, generates distinct student passwords, and skips duplicates', async () => {
    const { sqlite } = database();
    const deliveries: DeliveryEntry[] = [];
    const store: ImportStore = {
      async find(studentId) { const row = sqlite.prepare('SELECT id FROM members WHERE student_id = ?').get(studentId); return row ? { id: String(row.id) } : null; },
      async insert(row) {
        const result = sqlite.prepare('INSERT INTO members (id, student_id, name, class_name, role, joined_at, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(student_id) DO NOTHING')
          .run(row.id, row.studentId, row.name, row.className, row.role, row.joinedAt, row.passwordHash, Number(row.mustChangePassword));
        return Number(result.changes) === 1;
      },
    };
    const journal = { async stage(entry: DeliveryEntry) { deliveries.push(entry); }, async settle(id: string, status: DeliveryEntry['status']) { deliveries.find(entry => entry.id === id)!.status = status; } };
    const records = [
      { studentId: 'ROOT', name: '測試老師', className: '', role: 'admin' as const, password: 'source-test-password' },
      { studentId: 'S001', name: '測試甲', className: '1A', role: 'member' as const },
      { studentId: 'S002', name: '測試乙', className: '1A', role: 'member' as const },
    ];
    expect(await importAccounts(records, store, journal)).toEqual({ created: 3, skipped: 0 });
    expect(await importAccounts(records, store, journal)).toEqual({ created: 0, skipped: 3 });
    expect(deliveries).toHaveLength(3);
    expect(deliveries[0].initialPassword).toBeUndefined();
    expect(deliveries[1].initialPassword).not.toBe(deliveries[2].initialPassword);
    expect(deliveries.every(entry => entry.status === 'created')).toBe(true);
    const admin = sqlite.prepare("SELECT password_hash, must_change_password FROM members WHERE student_id = 'ROOT'").get();
    expect(await compare('source-test-password', String(admin?.password_hash))).toBe(true);
    expect(admin?.must_change_password).toBe(0);
    for (const member of sqlite.prepare('SELECT password_hash FROM members').all()) expect(getRounds(String(member.password_hash))).toBe(12);
  });
  it('validates the entire input before any account is inserted or credential staged', async () => {
    let writes = 0;
    const store: ImportStore = { async find() { return null; }, async insert() { writes++; return true; } };
    const journal = { async stage() { writes++; }, async settle() {} };
    await expect(importAccounts([{ studentId: 'S001', name: '測試', className: '1A', role: 'member' }, { studentId: 'S001', name: '重複', className: '1B', role: 'member' }], store, journal)).rejects.toThrow();
    expect(writes).toBe(0);
  });
  it('keeps a recoverable pending credential if a remote insert has an unknown outcome', async () => {
    const entries: DeliveryEntry[] = [];
    const store: ImportStore = { async find() { return null; }, async insert() { throw new Error('network unavailable'); } };
    const journal = { async stage(entry: DeliveryEntry) { entries.push(entry); }, async settle() {} };
    await expect(importAccounts([{ studentId: 'S001', name: '測試', className: '1A', role: 'member' }], store, journal)).rejects.toThrow();
    expect(entries[0].status).toBe('pending');
    expect(entries[0].initialPassword?.length).toBeGreaterThanOrEqual(12);
  });
});
