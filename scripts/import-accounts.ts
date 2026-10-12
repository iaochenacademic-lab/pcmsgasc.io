import { open, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAccounts, validateImport, type DeliveryEntry, type DeliveryJournal, type ImportRecord, type ImportStore } from './import-accounts-core';

type QueryResult = { success: boolean; results?: { id: string }[]; meta?: { changes?: number } };
type JournalEvent = ({ type: 'credential' } & DeliveryEntry) | { type: 'result'; id: string; status: DeliveryEntry['status'] };

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'Private account import for the club management database.',
      'Usage: node --import tsx scripts/import-accounts.ts --remote --account-id ID --database-id ID --input PRIVATE_JSON --output PRIVATE_JSONL',
      'Recovery: use --remote --account-id ID --database-id ID --output PRIVATE_JSONL --recover',
      '--input: private JSON account array outside the project; source administrators require a password.',
      '--output: new private JSONL delivery file outside the project; existing files are never overwritten.',
      '--recover: reconcile pending entries from an interrupted import; does not insert or reset accounts.',
      'Set CLOUDFLARE_API_TOKEN in the environment. This help does not read credentials or account files.',
      'Only deliver student credentials whose last result status is created. See docs/auth-api.md.',
      '',
    ].join('\n'));
    return;
  }
  const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const accountId = flag('--account-id'); const databaseId = flag('--database-id'); const input = flag('--input'); const output = flag('--output');
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const recover = args.includes('--recover');
  if (!accountId || !/^[a-f0-9]{32}$/.test(accountId) || !databaseId || !/^[a-f0-9-]{36}$/.test(databaseId) || !output || (!recover && !input) || !token || !args.includes('--remote')) {
    throw new Error('Use --remote --account-id ID --database-id ID --input PRIVATE_JSON --output PRIVATE_JSONL and CLOUDFLARE_API_TOKEN; use --recover with the same output to reconcile an interrupted import');
  }
  const project = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  function outsideProject(path: string) {
    const local = relative(project, path);
    if (!local || (!local.startsWith('..') && !isAbsolute(local))) throw new Error('Account source and output must be outside the project folder');
  }
  const destination = resolve(await realpath(dirname(resolve(output))), resolve(output).split(/[\\/]/).pop()!);
  outsideProject(destination);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  async function query(sql: string, params: (string | number)[]): Promise<QueryResult> {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) });
    if (!response.ok) throw new Error('D1 request failed; inspect the private delivery journal before retrying');
    const payload = await response.json() as { success?: boolean; result?: QueryResult[] };
    if (!payload.success || !payload.result?.[0]?.success) throw new Error('D1 query failed; private source details were withheld');
    return payload.result[0];
  }
  const store: ImportStore = {
    async find(studentId) { return (await query('SELECT id FROM members WHERE student_id = ?', [studentId])).results?.[0] ?? null; },
    async insert(row) {
      return (await query('INSERT INTO members (id, student_id, name, class_name, role, joined_at, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(student_id) DO NOTHING',
        [row.id, row.studentId, row.name, row.className, row.role, row.joinedAt, row.passwordHash, Number(row.mustChangePassword)])).meta?.changes === 1;
    },
  };
  let records: ImportRecord[] = [];
  if (!recover) {
    const source = await realpath(resolve(input!)); outsideProject(source);
    records = JSON.parse(await readFile(source, 'utf8')) as ImportRecord[];
    validateImport(records);
  }
  const events: JournalEvent[] = recover ? (await readFile(destination, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as JournalEvent) : [];
  // wx refuses to overwrite a previous one-time delivery; 0600 applies on POSIX.
  // On Windows the parent private directory must already have appropriate ACLs.
  const handle = await open(destination, recover ? 'a' : 'wx', 0o600);
  async function write(event: JournalEvent) { await handle.write(`${JSON.stringify(event)}\n`); await handle.sync(); }
  const journal: DeliveryJournal = {
    stage: entry => write({ type: 'credential', ...entry }),
    settle: (id, status) => write({ type: 'result', id, status }),
  };
  try {
    if (recover) {
      const entries = new Map<string, DeliveryEntry>();
      for (const event of events) {
        if (event.type === 'credential') entries.set(event.id, { ...event });
        else { const entry = entries.get(event.id); if (entry) entry.status = event.status; }
      }
      let reconciled = 0;
      for (const entry of entries.values()) {
        if (entry.status !== 'pending') continue;
        const member = await store.find(entry.studentId);
        await journal.settle(entry.id, member?.id === entry.id ? 'created' : 'skipped'); reconciled++;
      }
      process.stdout.write(`Reconciled ${reconciled} pending entries. Deliver only entries confirmed as created.\n`);
    } else {
      const result = await importAccounts(records, store, journal);
      process.stdout.write(`Created ${result.created}; skipped ${result.skipped}. Credentials are available only in the private output file.\n`);
    }
  } finally { await handle.close(); }
}

main().catch(() => {
  // No source data, API errors, SQL, hashes, or token values are logged.
  process.stderr.write('Import stopped. Check arguments, private file permissions, and D1 access. Preserve the private journal; reconcile pending entries with --recover before another import.\n');
  process.exitCode = 1;
});
