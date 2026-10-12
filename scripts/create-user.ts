import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  parseAccountArguments,
  runAccountCli,
  type AccountRepository,
} from "../src/lib/accounts/cli";
import type { Database } from "../src/lib/supabase/database.types";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const parsed = parseAccountArguments(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.errors.join("\n") + "\n");
    return 1;
  }

  // Configuration stays in the process. Never print dotenv results or client errors.
  dotenv.config({ path: ".env.local", quiet: true });
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let targetHostname: string | undefined;
  let repository: AccountRepository | undefined;

  if (supabaseUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(supabaseUrl);
    } catch {
      process.stderr.write("SUPABASE_URL 必须是有效的 URL。\n");
      return 1;
    }
    const isLocalDevelopment = ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname);
    if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && isLocalDevelopment)) {
      process.stderr.write("SUPABASE_URL 除本机开发环境外必须使用 HTTPS。\n");
      return 1;
    }
    targetHostname = parsedUrl.hostname;
    if (serviceRoleKey) {
      const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      repository = {
        async findExistingUsernames(usernames) {
          const existing: string[] = [];
          // Small pages keep URLs and result counts below PostgREST limits.
          for (let offset = 0; offset < usernames.length; offset += 200) {
            const { data, error } = await client.from("users").select("username").in("username", usernames.slice(offset, offset + 200));
            if (error) throw new Error("Account lookup failed.");
            existing.push(...data.map((row) => row.username));
          }
          return existing;
        },
        async findAccount(username) {
          const { data, error } = await client.from("users").select("username,name,role").eq("username", username).maybeSingle();
          if (error) throw new Error("Account lookup failed.");
          if (!data) return null;
          if (data.role !== "member" && data.role !== "teacher") throw new Error("Invalid account role.");
          return { username: data.username, name: data.name, role: data.role };
        },
        async insertMany(rows) {
          const { error } = await client.from("users").insert(rows);
          if (error) throw new Error("Account insert failed.");
        },
        async resetPassword(username, passwordHash) {
          const { data, error } = await client.rpc("admin_reset_password", { p_username: username, p_password_hash: passwordHash });
          if (error) throw new Error("Account reset failed.");
          return data === true;
        },
        async setActive(username, active) {
          const { data, error } = await client.rpc("admin_set_user_active", { p_username: username, p_is_active: active });
          if (error) throw new Error("Account activation failed.");
          return data === true;
        },
      };
    }
  }

  return runAccountCli(args, {
    targetHostname,
    repository,
    readText: (path) => readFile(path, "utf8"),
    writeOut: (message) => { process.stdout.write(message + "\n"); },
    writeError: (message) => { process.stderr.write(message + "\n"); },
    writeInfo: (message) => { process.stderr.write(message + "\n"); },
  });
}

main().then((code) => { process.exitCode = code; }).catch(() => {
  // Do not expose a client exception, connection string, key or request body.
  process.stderr.write("账号脚本运行失败，请检查服务端配置与网络连接。\n");
  process.exitCode = 1;
});
