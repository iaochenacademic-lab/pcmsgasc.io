import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe('account import command help', () => {
  it('shows safe help successfully without a source file or credentials', async () => {
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/import-accounts.ts', '--help'], {
      cwd: process.cwd(), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SESSION_SECRET: '', CHECKIN_SECRET: '' },
    });
    expect(result.stdout).toContain('--input');
    expect(result.stdout).toContain('--recover');
    expect(result.stdout).toContain('CLOUDFLARE_API_TOKEN');
    expect(result.stderr).toBe('');
  });
});
