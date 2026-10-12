import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import {
  buildAccountInsertions,
  formatInitialPasswords,
  parseAccountArguments,
  parseAccountCsv,
  runAccountCli,
  validateAccountRows,
  type AccountRepository,
  type CliDependencies,
} from "@/lib/accounts/cli";

function harness(overrides: Partial<AccountRepository> = {}) {
  const repository: AccountRepository = {
    findExistingUsernames: vi.fn(async () => []),
    findAccount: vi.fn(async () => ({ username: "alice", name: "Alice", role: "member" as const })),
    insertMany: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => true),
    setActive: vi.fn(async () => true),
    ...overrides,
  };
  const dependencies: CliDependencies = {
    targetHostname: "example.supabase.co",
    repository,
    readText: vi.fn(async () => "username,name,role\nalice,Alice,member\nbobby,Bob,teacher\n"),
    writeOut: vi.fn(),
    writeError: vi.fn(),
    writeInfo: vi.fn(),
    generatePassword: vi.fn(() => "unit-test-initial-password-only"),
    hashPassword: vi.fn(async () => "unit-test-hash-placeholder"),
  };
  return { repository, dependencies };
}

describe("account command parsing", () => {
  it("parses each command and a dry run flag in either position", () => {
    expect(parseAccountArguments(["--username", "Alice", "--name", "Alice", "--role", "member"]))
      .toEqual({ ok: true, value: { kind: "create", dryRun: false, input: { username: "Alice", name: "Alice", role: "member", line: 1 } } });
    expect(parseAccountArguments(["--csv", "members.csv", "--dry-run"]))
      .toEqual({ ok: true, value: { kind: "csv", path: "members.csv", dryRun: true } });
    for (const kind of ["reset", "activate", "deactivate"]) {
      expect(parseAccountArguments(["--dry-run", "--" + kind, " Alice "]))
        .toEqual({ ok: true, value: { kind, username: "alice", dryRun: true } });
    }
  });

  it.each([
    [], ["--username", "alice"], ["--wat"],
    ["--csv"], ["--csv", "a.csv", "--reset", "alice"],
    ["--reset", "alice", "--name", "Alice"],
    ["--username", "alice", "--name", "Alice", "--role", "member", "--username", "other"],
    ["--csv", "a.csv", "--dry-run", "--dry-run"],
    ["--reset", "a"], ["--activate", ".invalid"],
    ["--username=alice"], ["--dry-run"],
  ])("rejects incomplete, unknown, duplicate and conflicting arguments: %j", (...args) => {
    const result = parseAccountArguments(args);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("account CSV and row validation", () => {
  it("handles a BOM, CRLF, commas and escaped quotes in a name with physical line numbers", () => {
    expect(parseAccountCsv('\ufeffusername,name,role\r\nalice,"Alice, ""A""",member\r\nbobby,Bob,teacher\r\n')).toEqual({
      ok: true, value: [
        { line: 2, username: "alice", name: 'Alice, "A"', role: "member" },
        { line: 3, username: "bobby", name: "Bob", role: "teacher" },
      ],
    });
  });

  it("supports a quoted newline and preserves the next row's source line", () => {
    const result = parseAccountCsv('username,name,role\nalice,"Alice\nExample",member\nbobby,Bob,member');
    expect(result.ok && result.value.map((row) => row.line)).toEqual([2, 4]);
  });

  it.each([
    "", "username,role,name\nalice,member,Alice", "username,name,role\n",
    'username,name,role\nalice,"Alice,member',
    'username,name,role\nalice,"Alice"x,member',
    'username,name,role\nalice,Ali"ce,member',
    "username,name,role\nalice,Alice\nbobby,Bob,member,extra",
  ])("rejects malformed or empty CSV: %j", (input) => {
    expect(parseAccountCsv(input).ok).toBe(false);
  });

  it("reports all invalid row fields and case-insensitive duplicates", () => {
    const result = validateAccountRows([
      { line: 2, username: "Alice", name: " Alice ", role: "member" },
      { line: 3, username: " alice ", name: "", role: "admin" },
      { line: 4, username: "bad user", name: "名".repeat(41), role: "teacher" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(5);
      expect(result.errors.join("\n")).toContain("第 3 行");
      expect(result.errors.join("\n")).toContain("第 4 行");
      expect(result.errors.join("\n")).toContain("重复");
    }
  });

  it("trims names and measures Unicode code points", () => {
    expect(validateAccountRows([{ line: 2, username: " Alice ", name: "  " + "😀".repeat(40) + " ", role: "member" }]))
      .toEqual({ ok: true, value: [{ line: 2, username: "alice", name: "😀".repeat(40), role: "member" }] });
  });
});

describe("account execution and secret output", () => {
  it("builds independent bcrypt cost-12 insertions with forced password changes", async () => {
    const prepared = await buildAccountInsertions([
      { line: 2, username: "alice", name: "Alice", role: "member" },
      { line: 3, username: "bobby", name: "Bob", role: "teacher" },
    ]);
    expect(prepared.rows).toHaveLength(2);
    expect(prepared.credentials[0].password === prepared.credentials[1].password).toBe(false);
    for (let index = 0; index < prepared.rows.length; index++) {
      const row = prepared.rows[index];
      expect(bcrypt.getRounds(row.password_hash)).toBe(12);
      expect(await bcrypt.compare(prepared.credentials[index].password, row.password_hash)).toBe(true);
      expect(row.must_change_password).toBe(true);
      expect(row.is_active).toBe(true);
    }
  });

  it("writes one password table only after one complete batch insert succeeds", async () => {
    const { repository, dependencies } = harness();
    let inserted = false;
    vi.mocked(repository.insertMany).mockImplementation(async (rows) => {
      expect(rows).toHaveLength(2);
      expect(dependencies.writeOut).not.toHaveBeenCalled();
      inserted = true;
    });
    vi.mocked(dependencies.writeOut).mockImplementation((output) => {
      expect(inserted).toBe(true);
      expect(output).toContain("用户名 | 姓名 | 角色 | 初始密码");
      expect(output).toContain("仅显示这一次");
    });
    expect(await runAccountCli(["--csv", "members.csv"], dependencies)).toBe(0);
    expect(repository.insertMany).toHaveBeenCalledTimes(1);
    expect(dependencies.writeOut).toHaveBeenCalledTimes(1);
    expect(dependencies.writeError).not.toHaveBeenCalled();
    expect(dependencies.writeInfo).toHaveBeenCalledWith("目标 Supabase 主机：example.supabase.co");
  });

  it.each(["invalid", "duplicate", "database-existing", "lookup-failure", "insert-failure"])(
    "never outputs passwords when a batch fails: %s", async (scenario) => {
      const { repository, dependencies } = harness();
      if (scenario === "invalid") vi.mocked(dependencies.readText).mockResolvedValue("username,name,role\na,Alice,member");
      if (scenario === "duplicate") vi.mocked(dependencies.readText).mockResolvedValue("username,name,role\nalice,Alice,member\nALICE,Other,member");
      if (scenario === "database-existing") vi.mocked(repository.findExistingUsernames).mockResolvedValue(["alice"]);
      if (scenario === "lookup-failure") vi.mocked(repository.findExistingUsernames).mockRejectedValue(new Error("sensitive-backend-details"));
      if (scenario === "insert-failure") vi.mocked(repository.insertMany).mockRejectedValue({ code: "23505", details: "sensitive-backend-details" });
      expect(await runAccountCli(["--csv", "members.csv"], dependencies)).toBe(1);
      expect(dependencies.writeOut).not.toHaveBeenCalled();
      expect(dependencies.writeError).toHaveBeenCalled();
      expect(vi.mocked(dependencies.writeError).mock.calls.flat().join("\n")).not.toContain("sensitive-backend-details");
      if (scenario !== "insert-failure") {
        expect(repository.insertMany).not.toHaveBeenCalled();
        expect(dependencies.generatePassword).not.toHaveBeenCalled();
      }
    },
  );

  it("dry-run checks database duplicates but neither generates nor writes secrets", async () => {
    const { repository, dependencies } = harness();
    expect(await runAccountCli(["--csv", "members.csv", "--dry-run"], dependencies)).toBe(0);
    expect(repository.findExistingUsernames).toHaveBeenCalledWith(["alice", "bobby"]);
    expect(repository.insertMany).not.toHaveBeenCalled();
    expect(dependencies.generatePassword).not.toHaveBeenCalled();
    expect(dependencies.hashPassword).not.toHaveBeenCalled();
    expect(dependencies.writeOut).not.toHaveBeenCalled();
  });

  it("requires database validation even for a dry run", async () => {
    const { dependencies } = harness();
    dependencies.repository = undefined;
    expect(await runAccountCli(["--csv", "members.csv", "--dry-run"], dependencies)).toBe(1);
    expect(dependencies.writeError).toHaveBeenCalledWith(expect.stringContaining("无法完成数据库校验"));
    expect(dependencies.generatePassword).not.toHaveBeenCalled();
  });

  it("resets through the atomic repository method then outputs one password table", async () => {
    const { repository, dependencies } = harness();
    vi.mocked(repository.resetPassword).mockImplementation(async () => {
      expect(dependencies.writeOut).not.toHaveBeenCalled();
      return true;
    });
    expect(await runAccountCli(["--reset", "Alice"], dependencies)).toBe(0);
    expect(repository.resetPassword).toHaveBeenCalledWith("alice", "unit-test-hash-placeholder");
    expect(dependencies.writeOut).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "race", "error"])("does not reveal reset secrets after %s", async (scenario) => {
    const { repository, dependencies } = harness();
    if (scenario === "missing") vi.mocked(repository.findAccount).mockResolvedValue(null);
    if (scenario === "race") vi.mocked(repository.resetPassword).mockResolvedValue(false);
    if (scenario === "error") vi.mocked(repository.resetPassword).mockRejectedValue(new Error("sensitive-backend-details"));
    expect(await runAccountCli(["--reset", "alice"], dependencies)).toBe(1);
    expect(dependencies.writeOut).not.toHaveBeenCalled();
    if (scenario === "missing") expect(dependencies.generatePassword).not.toHaveBeenCalled();
  });

  it.each(["activate", "deactivate"])("performs %s without generating passwords", async (kind) => {
    const { repository, dependencies } = harness();
    expect(await runAccountCli(["--" + kind, "alice"], dependencies)).toBe(0);
    expect(repository.setActive).toHaveBeenCalledWith("alice", kind === "activate");
    expect(dependencies.generatePassword).not.toHaveBeenCalled();
    expect(dependencies.writeOut).not.toHaveBeenCalled();
  });

  it.each(["reset", "activate", "deactivate"])("dry-runs %s with an existence check only", async (kind) => {
    const { repository, dependencies } = harness();
    expect(await runAccountCli(["--" + kind, "alice", "--dry-run"], dependencies)).toBe(0);
    expect(repository.findAccount).toHaveBeenCalledWith("alice");
    expect(repository.setActive).not.toHaveBeenCalled();
    expect(repository.resetPassword).not.toHaveBeenCalled();
    expect(dependencies.generatePassword).not.toHaveBeenCalled();
    expect(dependencies.writeOut).not.toHaveBeenCalled();
  });

  it("rejects arguments and unreadable CSV without contacting the database", async () => {
    const { repository, dependencies } = harness();
    expect(await runAccountCli(["--csv"], dependencies)).toBe(1);
    vi.mocked(dependencies.readText).mockRejectedValue(new Error("private-file-details"));
    expect(await runAccountCli(["--csv", "missing.csv"], dependencies)).toBe(1);
    expect(repository.findExistingUsernames).not.toHaveBeenCalled();
    expect(dependencies.writeOut).not.toHaveBeenCalled();
    expect(vi.mocked(dependencies.writeError).mock.calls.flat().join("\n")).not.toContain("private-file-details");
  });

  it("escapes terminal controls, newlines and separators in the output table", () => {
    const output = formatInitialPasswords([{ username: "alice", name: "Alice\n|\u001b[31m", role: "member", password: "unit-test-placeholder" }]);
    expect(output.split("\n")).toHaveLength(3);
    expect(output.includes(String.fromCharCode(27))).toBe(false);
    expect(output.match(/\|/g)).toHaveLength(6);
  });
});
