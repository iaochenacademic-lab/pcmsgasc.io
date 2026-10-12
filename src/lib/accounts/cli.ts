import { generateInitialPassword, hashPassword as hashInitialPassword } from "@/lib/auth/password";
import type { UserRole } from "@/lib/auth/types";
import { isValidUsername, normalizeUsername } from "@/lib/auth/username";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface AccountRow {
  line: number;
  username: string;
  name: string;
  role: string;
}

export interface ValidAccountRow extends AccountRow {
  role: UserRole;
}

export type AccountCommand =
  | { kind: "create"; input: AccountRow; dryRun: boolean }
  | { kind: "csv"; path: string; dryRun: boolean }
  | { kind: "reset" | "activate" | "deactivate"; username: string; dryRun: boolean };

export interface AccountSummary {
  username: string;
  name: string;
  role: UserRole;
}

export interface InitialCredential extends AccountSummary {
  password: string;
}

export interface AccountInsert extends AccountSummary {
  password_hash: string;
  must_change_password: true;
  is_active: true;
}

export interface AccountRepository {
  findExistingUsernames(usernames: string[]): Promise<string[]>;
  findAccount(username: string): Promise<AccountSummary | null>;
  /** One database statement: either all accounts are inserted or none are. */
  insertMany(rows: AccountInsert[]): Promise<void>;
  /** Atomically changes the hash, forces a password change and revokes sessions. */
  resetPassword(username: string, passwordHash: string): Promise<boolean>;
  /** Atomically increments session_version when deactivating an account. */
  setActive(username: string, active: boolean): Promise<boolean>;
}

export interface CliDependencies {
  targetHostname?: string;
  repository?: AccountRepository;
  readText(path: string): Promise<string>;
  writeOut(message: string): void;
  writeError(message: string): void;
  writeInfo(message: string): void;
  generatePassword?(): string;
  hashPassword?(password: string): Promise<string>;
}

const FLAGS = new Set(["--username", "--name", "--role", "--csv", "--reset", "--activate", "--deactivate", "--dry-run"]);
const USAGE = "请选择一种命令：--username / --csv / --reset / --activate / --deactivate。";

export function parseAccountArguments(args: string[]): ParseResult<AccountCommand> {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!FLAGS.has(flag)) return { ok: false, errors: ["存在未知参数，请检查命令用法。"] };
    if (flag === "--dry-run") {
      if (dryRun) return { ok: false, errors: ["--dry-run 不能重复。"] };
      dryRun = true;
      continue;
    }
    if (values.has(flag)) return { ok: false, errors: [flag + " 不能重复。"] };
    const value = args[++index];
    if (value === undefined || value.startsWith("--") || value.trim() === "") {
      return { ok: false, errors: [flag + " 缺少参数值。"] };
    }
    values.set(flag, value);
  }

  const modes = ["--username", "--csv", "--reset", "--activate", "--deactivate"].filter((flag) => values.has(flag));
  if (modes.length !== 1) return { ok: false, errors: [USAGE] };
  const mode = modes[0];
  if (mode === "--username") {
    if (values.size !== 3 || !values.has("--name") || !values.has("--role")) {
      return { ok: false, errors: ["创建账号必须同时提供 --username、--name 和 --role。"] };
    }
    return {
      ok: true,
      value: {
        kind: "create", dryRun,
        input: { line: 1, username: values.get("--username")!, name: values.get("--name")!, role: values.get("--role")! },
      },
    };
  }
  if (values.size !== 1) return { ok: false, errors: ["不同账号操作的参数不能混用。"] };
  if (mode === "--csv") return { ok: true, value: { kind: "csv", path: values.get(mode)!, dryRun } };
  const username = normalizeUsername(values.get(mode)!);
  if (!isValidUsername(username)) return { ok: false, errors: ["用户名格式不正确：需为 3–32 位小写字母、数字、点、下划线或连字符，且以字母或数字开头。"] };
  const kind = mode.slice(2) as "reset" | "activate" | "deactivate";
  return { ok: true, value: { kind, username, dryRun } };
}

/** A small CSV reader with escaped quotes, CRLF and source-line tracking. */
export function parseAccountCsv(input: string): ParseResult<AccountRow[]> {
  const text = input.replace(/^\uFEFF/, "");
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let line = 1;
  let startLine = 1;

  function endField() {
    cells.push(field);
    field = "";
    afterQuote = false;
  }
  function endRecord() {
    endField();
    if (!(cells.length === 1 && cells[0].trim() === "")) records.push({ line: startLine, cells });
    cells = [];
  }
  function invalidCsv(): ParseResult<AccountRow[]> {
    return { ok: false, errors: ["第 " + line + " 行：CSV 引号格式不正确。"] };
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && text[index + 1] === "\n") index++;
        field += "\n";
        line++;
      } else {
        field += char;
      }
      continue;
    }

    if (char === ",") {
      endField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      endRecord();
      line++;
      startLine = line;
    } else if (afterQuote) {
      if (char !== " " && char !== "\t") return invalidCsv();
    } else if (char === '"') {
      if (field.length > 0) return invalidCsv();
      inQuotes = true;
    } else {
      field += char;
    }
  }
  if (inQuotes) return invalidCsv();
  endRecord();
  const header = records.shift();
  if (!header || header.cells.length !== 3 || header.cells.map((cell) => cell.trim()).join(",") !== "username,name,role") {
    return { ok: false, errors: ["CSV 表头必须为 username,name,role，且顺序一致。"] };
  }
  if (records.length === 0) return { ok: false, errors: ["CSV 没有账号数据行。"] };

  const errors: string[] = [];
  const rows: AccountRow[] = [];
  for (const record of records) {
    if (record.cells.length !== 3) {
      errors.push("第 " + record.line + " 行：必须恰好包含 username、name、role 三列。");
      continue;
    }
    rows.push({ line: record.line, username: record.cells[0], name: record.cells[1], role: record.cells[2] });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: rows };
}

export function validateAccountRows(rows: AccountRow[]): ParseResult<ValidAccountRow[]> {
  const errors: string[] = [];
  const validRows: ValidAccountRow[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const prefix = "第 " + row.line + " 行：";
    const username = normalizeUsername(row.username);
    const name = row.name.trim();
    const role = row.role.trim();
    if (!isValidUsername(username)) {
      errors.push(prefix + "username 格式不正确（3–32 位，以字母或数字开头，仅允许小写字母、数字、点、下划线、连字符）。");
    }
    if (Array.from(name).length < 1 || Array.from(name).length > 40) {
      errors.push(prefix + "name 去除首尾空格后须为 1–40 个字符。");
    }
    if (role !== "member" && role !== "teacher") {
      errors.push(prefix + "role 只能为 member 或 teacher。");
    }
    if (seen.has(username)) {
      errors.push(prefix + "username 与第 " + seen.get(username) + " 行重复。");
    } else {
      seen.set(username, row.line);
    }
    if (role === "member" || role === "teacher") validRows.push({ line: row.line, username, name, role });
  }
  if (rows.length === 0) errors.push("没有可创建的账号。");
  return errors.length ? { ok: false, errors } : { ok: true, value: validRows };
}

export async function buildAccountInsertions(
  accounts: ValidAccountRow[],
  generatePassword = generateInitialPassword,
  hashPassword = hashInitialPassword,
): Promise<{ rows: AccountInsert[]; credentials: InitialCredential[] }> {
  const rows: AccountInsert[] = [];
  const credentials: InitialCredential[] = [];
  for (const account of accounts) {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    const summary = { username: account.username, name: account.name, role: account.role };
    rows.push({ ...summary, password_hash: passwordHash, must_change_password: true, is_active: true });
    credentials.push({ ...summary, password });
  }
  return { rows, credentials };
}

function printableCell(value: string): string {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159) || char === "|" ? " " : char;
  }).join("");
}

export function formatInitialPasswords(credentials: InitialCredential[]): string {
  return [
    "用户名 | 姓名 | 角色 | 初始密码",
    ...credentials.map((account) => [account.username, account.name, account.role, account.password].map(printableCell).join(" | ")),
    "初始密码仅显示这一次，请立即安全分发；首次登录必须修改密码。",
  ].join("\n");
}

/** Raw storage errors may contain a hash or a request body: never echo them. */
export async function runAccountCli(args: string[], dependencies: CliDependencies): Promise<0 | 1> {
  const parsed = parseAccountArguments(args);
  if (!parsed.ok) {
    dependencies.writeError(parsed.errors.join("\n"));
    return 1;
  }
  if (dependencies.targetHostname) dependencies.writeInfo("目标 Supabase 主机：" + dependencies.targetHostname);
  const command = parsed.value;
  try {
    if (command.kind === "create" || command.kind === "csv") {
      let inputRows: AccountRow[];
      if (command.kind === "csv") {
        let csvText: string;
        try {
          csvText = await dependencies.readText(command.path);
        } catch {
          dependencies.writeError("无法读取 CSV 文件，请检查路径、编码和读取权限。");
          return 1;
        }
        const csv = parseAccountCsv(csvText);
        if (!csv.ok) {
          dependencies.writeError(csv.errors.join("\n"));
          return 1;
        }
        inputRows = csv.value;
      } else {
        inputRows = [command.input];
      }
      const validated = validateAccountRows(inputRows);
      if (!validated.ok) {
        dependencies.writeError(validated.errors.join("\n"));
        return 1;
      }
      const repository = dependencies.repository;
      if (!repository) {
        dependencies.writeError("缺少服务端配置，无法完成数据库校验；未创建或修改账号。");
        return 1;
      }
      const existing = new Set(await repository.findExistingUsernames(validated.value.map((row) => row.username)));
      const conflicts = validated.value.filter((row) => existing.has(row.username));
      if (conflicts.length) {
        dependencies.writeError(conflicts.map((row) => "第 " + row.line + " 行：username 已存在于数据库。").join("\n"));
        return 1;
      }
      if (command.dryRun) {
        dependencies.writeInfo("校验通过：" + validated.value.length + " 个账号；dry-run 未生成密码、未写入数据库。");
        return 0;
      }
      const prepared = await buildAccountInsertions(validated.value, dependencies.generatePassword, dependencies.hashPassword);
      await repository.insertMany(prepared.rows);
      // This is the sole secret-bearing output and is strictly after write success.
      dependencies.writeOut(formatInitialPasswords(prepared.credentials));
      return 0;
    }

    const repository = dependencies.repository;
    if (!repository) {
      dependencies.writeError("缺少服务端配置，无法完成数据库校验；未创建或修改账号。");
      return 1;
    }
    const account = await repository.findAccount(command.username);
    if (!account) {
      dependencies.writeError("目标账号不存在；未修改账号。");
      return 1;
    }
    if (command.dryRun) {
      dependencies.writeInfo("校验通过：目标账号存在；dry-run 未生成密码、未写入数据库。");
      return 0;
    }
    if (command.kind === "reset") {
      const password = (dependencies.generatePassword ?? generateInitialPassword)();
      const hash = await (dependencies.hashPassword ?? hashInitialPassword)(password);
      const updated = await repository.resetPassword(command.username, hash);
      if (!updated) {
        dependencies.writeError("目标账号不存在或已变化，重置未完成。");
        return 1;
      }
      dependencies.writeOut(formatInitialPasswords([{ ...account, password }]));
      return 0;
    }
    const updated = await repository.setActive(command.username, command.kind === "activate");
    if (!updated) {
      dependencies.writeError("目标账号不存在或已变化，状态修改未完成。");
      return 1;
    }
    dependencies.writeInfo(command.kind === "activate" ? "账号已启用。" : "账号已停用，已有登录状态已撤销。");
    return 0;
  } catch {
    dependencies.writeError("账号操作失败；请检查数据库连接、权限或账号状态。批量创建若发生冲突，整批均不会写入。");
    return 1;
  }
}
