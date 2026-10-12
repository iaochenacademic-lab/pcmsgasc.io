export interface ImportRecord { studentId: string; name: string; className: string; role: 'admin' | 'member'; password?: string; joinedAt?: number }
export interface InsertRecord extends Omit<ImportRecord, 'password' | 'joinedAt'> { id: string; passwordHash: string; mustChangePassword: boolean; joinedAt: number }
export interface ImportStore { find(studentId: string): Promise<{ id: string } | null>; insert(row: InsertRecord): Promise<boolean> }
export interface DeliveryEntry { id: string; studentId: string; name: string; className: string; initialPassword?: string; status: 'pending' | 'created' | 'skipped' }
export interface DeliveryJournal { stage(entry: DeliveryEntry): Promise<void>; settle(id: string, status: DeliveryEntry['status']): Promise<void> }
export function validateImport(records: ImportRecord[]): void {
  if (!Array.isArray(records) || records.length === 0 || records.length > 500) throw new Error('Import requires 1–500 records');
  const ids = new Set<string>();
  for (const record of records) {
    if (!record || !validStudentId(record.studentId) || ids.has(record.studentId)
      || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 80
      || typeof record.className !== 'string' || record.className.length > 40
      || !['admin', 'member'].includes(record.role)
      || (record.role === 'admin' && !validPassword(record.password))
      || (record.joinedAt !== undefined && (!Number.isSafeInteger(record.joinedAt) || record.joinedAt < 0))) {
      // Never interpolate a source value: this error may reach a terminal.
      throw new Error('Invalid or duplicate account record');
    }
    ids.add(record.studentId);
  }
}
export async function importAccounts(records: ImportRecord[], store: ImportStore, journal: DeliveryJournal): Promise<{ created: number; skipped: number }> {
  validateImport(records);
  let created = 0; let skipped = 0;
  for (const record of records) {
    if (await store.find(record.studentId)) { skipped++; continue; }
    const password = record.role === 'admin' ? record.password! : randomPassword();
    const id = crypto.randomUUID();
    const row: InsertRecord = { id, studentId: record.studentId, name: record.name.trim(), className: record.className.trim(), role: record.role,
      joinedAt: record.joinedAt ?? Date.now(), passwordHash: await hash(password, 12), mustChangePassword: record.role !== 'admin' };
    // Persist the one-time credential before the network write. An interrupted
    // import remains recoverable by matching this id to the inserted member.
    await journal.stage({ id, studentId: row.studentId, name: row.name, className: row.className,
      ...(record.role === 'member' ? { initialPassword: password } : {}), status: 'pending' });
    const inserted = await store.insert(row);
    await journal.settle(id, inserted ? 'created' : 'skipped');
    if (inserted) created++; else skipped++;
  }
  return { created, skipped };
}
import { hash } from 'bcryptjs';
import { randomPassword, validPassword, validStudentId } from '../worker/auth-service';
