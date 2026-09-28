# 社团管理网站认证基础实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 初始化 Next.js 社团管理网站，接入 Supabase 的自定义 `users` 表，实现预建账号登录、老师/成员角色分流、失败锁定、首次改密和 30 天滑动 Session。

**Architecture:** 使用 Next.js App Router 的服务端 Route Handler 处理登录与改密，使用只在服务端创建的 Supabase Service Role Client 读取/更新 `public.users`。密码由 bcrypt cost 12 哈希，Session 使用 `jose` 的 AES-GCM 加密 JWT 存入带 `Secure`、`HttpOnly`、`SameSite=Lax` 的 Cookie；根目录 `proxy.ts` 验证并在有效请求时刷新 30 天 Cookie TTL，服务端页面再执行角色守卫。

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, `@supabase/supabase-js`, `bcryptjs`, `jose`, `dotenv`, Vitest, `tsx`。

**Spec:** `docs/superpowers/specs/2026-09-26-club-auth-design.md`

## Global Constraints

- 自定义 `public.users` 表必须包含用户名、密码哈希、角色和姓名。
- `role` 只允许 `teacher` 与 `member`。
- 账号只能通过服务端脚本预先创建，网站不提供注册页面。
- 初始密码由 `create-user.ts` 为每个账号独立生成随机值，并且只在脚本输出中显示一次。
- 新账号首次登录后必须修改密码。
- bcrypt cost factor 固定为 12。
- 登录失败累计达到 10 次后，账号锁定 5 分钟；成功登录会清零失败计数。
- Session 使用 `jose` 的成熟加密能力，不自行实现加密或签名算法。
- Session Cookie 设置 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`。
- Session 按滑动过期处理：连续 30 天没有任何受保护请求则过期；每次有效受保护请求刷新 30 天 TTL。
- Service Role Key 只能存在于服务端环境变量，不能以 `NEXT_PUBLIC_` 前缀暴露。
- 不提交 `.env.local`、Service Role Key、初始密码或真实账号数据。
- 所有新增业务逻辑遵循 TDD：先写一个会正确失败的测试，再写最小实现，再运行完整测试集。

## Review Focus

- 恰好第 10 次错误密码是否锁定 5 分钟，而第 9 次不会提前锁定；由 Task 4 的认证服务测试覆盖。
- 已过期锁定窗口是否从失败次数 1 重新开始，而不是永久锁定；由 Task 2 的锁定状态测试覆盖。
- 首次登录用户是否无法绕过改密直接访问 `/teacher` 或 `/member`；由 Task 4 的 Session/Proxy 测试和 Task 5 的页面守卫测试覆盖。
- 非法、被篡改或已过期 Session 是否被清除而不是信任 Cookie 内容；由 Task 2 的 Session 测试和 Task 4 的 Proxy 测试覆盖。
- 登录页面是否不会泄露“用户名不存在”和“密码错误”的差异，也不会把 Service Role Key 或哈希发送到浏览器；由 Task 4 的 Route Handler 测试/代码检查和 Task 6 的配置检查覆盖。

---

### Task 1: 初始化 Next.js 项目与测试工具链

**Files:**
- Create: Next.js 生成的 `package.json`、`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`src/app/layout.tsx`、`src/app/page.tsx`、`src/app/globals.css` 等基础文件。
- Create: `.env.example`、`vitest.config.ts`、`src/test/setup.ts`。
- Modify: `package.json` scripts and dependencies。
- Modify: `.gitignore` to keep `.env.local` and local build artifacts untracked.

**Interfaces:**
- Consumes: empty repository at `D:\pcmsgasc.io`.
- Produces: a runnable Next.js App Router project with `@/*` resolving to `src/*`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run create-user` script slots.

- [ ] **Step 1: Scaffold the application**

  Run `npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes` from `D:\pcmsgasc.io`. Preserve the existing `docs/` and `.git/` directories. If the current create-next-app prompts or flags differ, inspect `npx create-next-app@latest --help` and use the equivalent flags rather than guessing.

- [ ] **Step 2: Install pinned runtime and test dependencies**

  Install `@supabase/supabase-js`, `bcryptjs`, `jose`, and `dotenv` as runtime dependencies; install `vitest`, `tsx`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, and `@testing-library/jest-dom` as dev dependencies. Keep the generated lockfile. Do not install `@supabase/ssr` because this phase uses the separately scoped custom Session Cookie, not Supabase Auth sessions.

- [ ] **Step 3: Configure scripts and environment template**

  Add scripts `test: "vitest run"`, `test:watch: "vitest"`, `typecheck: "tsc --noEmit"`, and `create-user: "tsx scripts/create-user.ts"`. Configure Vitest with the React plugin, `jsdom` environment, `src/test/setup.ts` setup file, and the `@/*` alias. Add `.env.example` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a 32-byte base64url `SESSION_SECRET` placeholder. Ensure no variable containing the Service Role Key starts with `NEXT_PUBLIC_`.

- [ ] **Step 4: Add a baseline test and run it**

  Create `src/lib/auth/baseline.test.ts` with one trivial Vitest assertion that the test runner is wired. Run `npm test -- --run src/lib/auth/baseline.test.ts`; expected result is one passing test. Remove the baseline test after the first real auth primitive test is introduced.

- [ ] **Step 5: Verify the scaffold**

  Run `npm run typecheck`, `npm run lint`, and `npm run build`. Expected result: all commands exit 0 against the generated app before feature code is added.

- [ ] **Step 6: Commit**

  ```bash
  git add package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs src .env.example .gitignore vitest.config.ts
  git commit -m "chore: initialize club management app"
  ```

### Task 2: 实现并测试密码、锁定状态与 Session 原语

**Files:**
- Create: `src/lib/auth/constants.ts`。
- Create: `src/lib/auth/types.ts`。
- Create: `src/lib/auth/password.ts`。
- Create: `src/lib/auth/lockout.ts`。
- Create: `src/lib/auth/session.ts`。
- Create: `src/lib/auth/password.test.ts`、`src/lib/auth/lockout.test.ts`、`src/lib/auth/session.test.ts`。
- Modify: `vitest.config.ts` if Node built-ins or `@/*` aliases need explicit resolution.

**Interfaces:**
- Produces `UserRole = "teacher" | "member"` and `SessionPayload` with `userId`, `username`, `role`, `name`, and `mustChangePassword`.
- Produces `LoginInput = { username: string; password: string }`, `ChangePasswordInput = { userId: string; currentPassword: string; newPassword: string }`, and `LoginFailureState = { failedLoginCount: number; lockedUntil: string | null }`.
- Produces `BCRYPT_COST = 12`, `SESSION_MAX_AGE_SECONDS = 2_592_000`, `MAX_FAILED_LOGIN_ATTEMPTS = 10`, and `LOCKOUT_DURATION_SECONDS = 300`.
- Produces `generateInitialPassword(byteLength?: number): string`, `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, hash: string): Promise<boolean>`.
- Produces `isAccountLocked(lockedUntil: string | Date | null, now?: Date): boolean`, `nextLoginFailureState(state, now?: Date)`, and `resetLoginFailureState()`.
- Produces `createSessionToken(payload: SessionPayload, now?: Date): Promise<string>` and `readSessionToken(token: string, now?: Date): Promise<SessionPayload | null>`.

- [ ] **Step 1: Write failing password tests**

  In `password.test.ts`, assert that `generateInitialPassword()` returns a non-empty high-entropy string, two calls produce different values, `hashPassword()` produces a bcrypt hash whose `bcrypt.getRounds()` is exactly 12, valid passwords verify, and invalid passwords do not. Add a test that rejects an empty password for the shared new-password validator if that validator is included in this unit.

- [ ] **Step 2: Run password tests and confirm RED**

  Run `npm test -- --run src/lib/auth/password.test.ts`; expected failure is missing module/functions, not a test-runner error.

- [ ] **Step 3: Implement the minimal password primitives**

  Use `bcryptjs.hash(password, 12)` and `bcryptjs.compare(password, hash)`. Use Node's secure random source for initial password generation; do not embed a default password or write a custom hash algorithm.

- [ ] **Step 4: Run password tests and confirm GREEN**

  Run the same command and verify all password assertions pass.

- [ ] **Step 5: Write failing lockout tests**

  In `lockout.test.ts`, pin these cases: counts 0→1 and 8→9 remain unlocked; count 9→10 sets `lockedUntil = now + 300 seconds`; a locked account returns true before the deadline and false at/after the deadline; a failure after an expired lock starts at count 1; reset returns count 0 and `lockedUntil=null`.

- [ ] **Step 6: Run lockout tests and confirm RED**

  Run `npm test -- --run src/lib/auth/lockout.test.ts`; expected failure is missing lockout exports.

- [ ] **Step 7: Implement the lockout state transitions**

  Keep this module pure and deterministic by accepting an optional `now` argument. Use the exact 10-attempt and 300-second constants; do not put database calls in this module.

- [ ] **Step 8: Run lockout tests and confirm GREEN**

  Run the same command and verify all lockout assertions pass.

- [ ] **Step 9: Write failing Session tests**

  In `session.test.ts`, assert that a payload round-trips through `createSessionToken`/`readSessionToken`, the token does not contain the plaintext username or name, `exp - iat` equals `2_592_000`, invalid/tampered tokens return `null`, and the cookie options exported by `constants.ts` contain `httpOnly=true`, `secure=true`, `sameSite="lax"`, `path="/"`, and `maxAge=2_592_000`.

- [ ] **Step 10: Run Session tests and confirm RED**

  Run `npm test -- --run src/lib/auth/session.test.ts`; expected failure is missing Session exports.

- [ ] **Step 11: Implement `jose` Session encryption**

  Decode the required base64url `SESSION_SECRET` into a 32-byte key and use `EncryptJWT` with `alg="dir"`, `enc="A256GCM"`, `setIssuedAt`, `setExpirationTime`, and `jwtDecrypt`. Return `null` for malformed, expired, or tampered tokens. Do not implement AES, HMAC, JWT parsing, or key derivation manually.

- [ ] **Step 12: Run primitive tests and the full suite**

  Run `npm test -- --run src/lib/auth/password.test.ts src/lib/auth/lockout.test.ts src/lib/auth/session.test.ts` and then `npm test`; expected result is all tests passing with no unhandled warnings.

- [ ] **Step 13: Commit**

  ```bash
  git add src/lib/auth vitest.config.ts package.json package-lock.json
  git commit -m "feat: add auth security primitives"
  ```

### Task 3: 创建 Supabase users schema 与服务端仓库

**Files:**
- Create: `supabase/migrations/<generated>_create_users_and_lockout.sql` using the filename generated by `supabase migration new create_users_and_lockout` (do not invent the migration filename).
- Create: `src/lib/supabase/admin.ts`。
- Create: `src/lib/supabase/database.types.ts`。
- Create: `src/lib/auth/user-repository.ts`。
- Create: `src/lib/auth/user-repository.test.ts`。

**Interfaces:**
- `src/lib/supabase/admin.ts` produces `createAdminClient()` using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, with session persistence and auto-refresh disabled.
- `UserRepository` produces `findByUsername(username: string)`, `findById(userId: string)`, `recordLoginFailure(userId: string)`, `resetLoginFailures(userId: string)`, and `updatePassword(userId: string, passwordHash: string)`; the final method also sets `must_change_password=false` and clears lockout state in the same update.
- Repository return values expose a typed `UserRecord` to server code only; no repository function is imported by Client Components.

- [ ] **Step 1: Discover available Supabase CLI commands and generate migration path**

  Run `supabase --help`, then `supabase migration --help`. If the CLI is available, run `supabase migration new create_users_and_lockout` and use the returned path. If the CLI is unavailable, record that fact and create the migration through the connected Supabase MCP workflow while preserving the exact SQL in a local migration file with the tool-generated migration version.

- [ ] **Step 2: Write the schema migration**

  Add `public.users` with `id`, `username`, `password_hash`, `role`, `name`, `must_change_password`, `failed_login_count`, `locked_until`, `created_at`, and `updated_at`; add the role check constraint and username uniqueness. Enable RLS, revoke table privileges from `anon` and `authenticated`, and grant server-only access to `service_role`.

  Add `public.record_login_failure(p_user_id uuid)` as a `SECURITY INVOKER` function. It must atomically increment the failure count, reset an expired lock to count 1, and set `locked_until = now() + interval '5 minutes'` exactly when the resulting count reaches 10. Revoke public/anon/authenticated execute and grant execute only to `service_role`.

- [ ] **Step 3: Apply the schema to the connected Supabase project**

  Apply the migration to project `epsxsbskwlewmsstrzfu` using the connected Supabase database tool. Do not insert real credentials. If schema iteration is needed, use the Supabase SQL execution tool for read-only inspection and keep the final SQL in the migration file.

- [ ] **Step 4: Write failing repository contract tests**

  In `user-repository.test.ts`, use a small fake repository/client contract to assert username lookup maps snake_case database fields to `UserRecord`, failure recording returns the atomic count/lock result, successful reset clears count and lock, and password updates always update `updated_at`. Assert that the public repository result type never includes a plaintext password.

- [ ] **Step 5: Run repository tests and confirm RED**

  Run `npm test -- --run src/lib/auth/user-repository.test.ts`; expected failure is missing repository implementation or interfaces.

- [ ] **Step 6: Implement the Admin Client and repository**

  Create a fresh Supabase client per server operation with `persistSession:false`, `autoRefreshToken:false`, and `detectSessionInUrl:false`. Use the RPC for atomic failure recording; use parameterized Supabase query builders for all other operations. Treat database errors as server errors and never return them to the browser.

- [ ] **Step 7: Run repository tests and full local checks**

  Run `npm test -- --run src/lib/auth/user-repository.test.ts`, then `npm test` and `npm run typecheck`; expected result is green tests and no type errors.

- [ ] **Step 8: Verify Supabase schema and security**

  Run a read-only SQL inspection for columns, constraints, RLS state, table privileges, and function privileges. Run Supabase security and performance advisors. Expected result: the table exists with RLS enabled, no `anon`/`authenticated` table access, the lockout function is invoker security, and no unresolved security advisor applies to this schema.

- [ ] **Step 9: Commit**

  ```bash
  git add supabase src/lib/supabase src/lib/auth/user-repository.ts src/lib/auth/user-repository.test.ts
  git commit -m "feat: add secured users table repository"
  ```

### Task 4: 实现认证服务、Route Handlers 与 Proxy 守卫

**Files:**
- Create: `src/lib/auth/validation.ts`。
- Create: `src/lib/auth/service.ts`。
- Create: `src/lib/auth/service.test.ts`。
- Create: `src/lib/auth/cookies.ts`。
- Create: `src/lib/auth/guards.ts`。
- Create: `src/app/api/auth/login/route.ts`。
- Create: `src/app/api/auth/logout/route.ts`。
- Create: `src/app/api/auth/change-password/route.ts`。
- Create: `proxy.ts`。
- Create: `src/lib/auth/route.test.ts`.

**Interfaces:**
- `authenticateUser(input: LoginInput, deps: AuthServiceDependencies): Promise<AuthResult>` performs lock check, bcrypt verification, atomic failure recording, and success reset.
- `changeUserPassword(input: ChangePasswordInput, deps: AuthServiceDependencies): Promise<ChangePasswordResult>` verifies the current password, hashes the new password at cost 12, clears `must_change_password`, and resets lockout state.
- `requireSession(): Promise<SessionPayload>` and `requireRole(role: UserRole): Promise<SessionPayload>` are server-only guards that redirect on failure.
- Route handlers accept JSON `{ username, password }` for login and `{ currentPassword, newPassword }` for change-password; they return generic errors without database details.

- [ ] **Step 1: Write failing authentication-service tests**

  In `service.test.ts`, use an in-memory implementation of `UserRepository` and the real password primitives to assert: unknown user and wrong password return the same invalid-credential result; a locked user is rejected without invoking password comparison; the 10th invalid password returns a locked result; valid login resets failures; a user with `mustChangePassword=true` succeeds but is marked for the change-password flow; change-password requires the current password and clears the flag only after the new hash is stored.

- [ ] **Step 2: Run service tests and confirm RED**

  Run `npm test -- --run src/lib/auth/service.test.ts`; expected failure is missing validation/service exports.

- [ ] **Step 3: Implement validation and authentication service**

  Normalize usernames consistently (trim and lowercase), reject empty credentials, enforce a minimum new-password length in one shared validator, and keep lockout decisions in the service/repository boundary. Do not reveal whether a username exists in the returned invalid-credential result.

- [ ] **Step 4: Run service tests and confirm GREEN**

  Run the same command and verify all service assertions pass.

- [ ] **Step 5: Write failing Cookie/Route/Proxy tests**

  In `route.test.ts`, call the exported Route Handler functions with `Request` objects while mocking only the Admin Client boundary. Assert cookie option exactness, login success setting an encrypted Session Cookie, login failure returning no Session Cookie and no sensitive fields, logout clearing the Cookie, change-password rotating the Session to `mustChangePassword=false`, invalid Session redirect/clear behavior, and role mismatch routing to the correct role home.

- [ ] **Step 6: Implement Cookie helpers and Route Handlers**

  Set the Session Cookie with `httpOnly:true`, `secure:true`, `sameSite:"lax"`, `path:"/"`, and `maxAge:2_592_000`. Mark auth routes with the Node.js runtime because bcrypt and the Supabase admin client are server-only. On login, issue a Session containing the exact current user fields; on logout, expire the Cookie; on change-password, verify the current password, persist the new hash, and issue a fresh Session with `mustChangePassword=false`.

- [ ] **Step 7: Implement server guards and `proxy.ts`**

  Export `proxy(request: NextRequest)` and match application/API paths while excluding static assets. Decrypt the custom Session with `jose`; clear and redirect invalid tokens; redirect first-login sessions to `/change-password`; redirect unauthenticated protected requests to `/login`; refresh a valid Session token and Cookie on every protected request so the 30-day expiration is idle-based. Keep role authorization in `requireRole`, not in client-side state.

- [ ] **Step 8: Run Route/Proxy tests and the full suite**

  Run targeted tests, then `npm test`, `npm run typecheck`, and `npm run lint`. Expected result: all tests pass and the handlers compile without exposing secrets.

- [ ] **Step 9: Commit**

  ```bash
  git add proxy.ts src/lib/auth src/app/api/auth
  git commit -m "feat: add secure login session and role guards"
  ```

### Task 5: 实现登录、首次改密与角色首页 UI

**Files:**
- Modify: `src/app/layout.tsx` and `src/app/globals.css`。
- Modify: `src/app/page.tsx` to redirect by Session.
- Create: `src/app/login/page.tsx`、`src/app/login/login-form.tsx`。
- Create: `src/app/change-password/page.tsx`、`src/app/change-password/change-password-form.tsx`。
- Create: `src/app/teacher/page.tsx`、`src/app/member/page.tsx`。
- Create: `src/components/empty-dashboard.tsx`、`src/components/logout-button.tsx`。
- Create: `src/components/ui.test.tsx` and `src/test/setup.ts`.

**Interfaces:**
- Login form submits only to `/api/auth/login`; it has username/password fields, pending state, and a generic error message.
- Change-password form submits only to `/api/auth/change-password`; it requires current password, new password, and confirmation.
- Teacher/member pages call `requireRole("teacher")` / `requireRole("member")` on the server and render a shared empty dashboard shell with the current user's name and logout action.

- [ ] **Step 1: Write failing UI tests**

  In `src/components/ui.test.tsx`, render the client components with React Testing Library and pin the visible behavior: `LoginForm` has username/password fields and no registration link; the first-login copy directs the user to change password; `EmptyDashboard` renders distinct teacher/member titles; `LogoutButton` posts to `/api/auth/logout`; `ChangePasswordForm` renders current/new/confirmation fields.

- [ ] **Step 2: Run UI tests and confirm RED**

  Run `npm test -- --run src/components/ui.test.tsx`; expected failure is missing components.

- [ ] **Step 3: Implement the minimal responsive Tailwind UI**

  Keep the visual scope intentionally small: centered login card, clear field labels, accessible errors, role-specific empty state, and one logout control. Do not add registration, certificate, finance, or unrelated modules. Use server-side redirects/guards as the source of truth; the client form only renders state.

- [ ] **Step 4: Run UI tests and static checks**

  Run `npm test -- --run src/components/ui.test.tsx`, then `npm test`, `npm run typecheck`, and `npm run lint`; expected result is green.

- [ ] **Step 5: Commit**

  ```bash
  git add src/app src/components
  git commit -m "feat: add login and role home pages"
  ```

### Task 6: 实现独立初始密码账号脚本与开发文档

**Files:**
- Create: `scripts/create-user.ts`。
- Create/modify: `README.md`。
- Modify: `.env.example` if setup instructions need additional values.
- Create: `scripts/create-user.test.ts` if CLI helpers are extracted into a testable module.

**Interfaces:**
- `npm run create-user -- --username <username> --role <teacher|member> --name <name>` creates one account and prints the generated initial password once.
- The script sets `must_change_password=true`, `failed_login_count=0`, and `locked_until=null` and never accepts a password argument or uses a shared default.

- [ ] **Step 1: Write failing provisioning tests**

  Test the extracted CLI argument parser rejects missing/invalid values, accepts only `teacher`/`member`, and the provisioning payload always marks the account for forced password change and uses a hash whose bcrypt rounds equal 12. Test that two generated provisioning calls do not reuse an initial password.

- [ ] **Step 2: Run provisioning tests and confirm RED**

  Run `npm test -- --run scripts/create-user.test.ts`; expected failure is missing script helpers.

- [ ] **Step 3: Implement `create-user.ts`**

  Load `.env.local` with `dotenv`, validate CLI arguments, generate a fresh random password with the shared password primitive, hash it with cost 12, insert through the service-only Admin Client, and print the username/name/role plus one-time password. Never log the hash, Service Role Key, or raw password anywhere except the intentional one-time terminal output.

- [ ] **Step 4: Run provisioning tests and full checks**

  Run the targeted test, `npm test`, and `npm run typecheck`; expected result is green.

- [ ] **Step 5: Write README setup instructions**

  Document copying `.env.example` to `.env.local`, obtaining the Supabase URL and server-only Service Role/secret values, applying the migration, creating separate teacher/member accounts, running `npm run dev`, and changing each initial password on first login. Explicitly warn never to expose the Service Role Key in `NEXT_PUBLIC_` variables.

- [ ] **Step 6: Commit**

  ```bash
  git add scripts README.md .env.example
  git commit -m "feat: add secure user provisioning workflow"
  ```

### Task 7: Final verification and delivery review

**Files:**
- Modify only if verification finds a real issue; otherwise no source changes.

**Interfaces:**
- Consumes all completed tasks and the Supabase project `epsxsbskwlewmsstrzfu`.
- Produces verified source, migration, tests, documentation, and a concise list of any environment-dependent checks the user must perform.

- [ ] **Step 1: Run the complete local verification suite**

  Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` from a clean working tree state. Read each exit code and full summary; do not claim completion from a partial command.

- [ ] **Step 2: Run Supabase verification queries and advisors**

  Confirm table columns, role constraint, RLS, grants, function grants, and lockout behavior with read-only queries. Run both security and performance advisors and record any remaining notice with its remediation link.

- [ ] **Step 3: Inspect the final diff for secret leakage and scope**

  Run `git status --short`, inspect the diff, and confirm there are no `.env.local` files, Service Role Keys, generated initial passwords, registration pages, or unrelated modules. Confirm every user requirement maps to code or a documented setup step.

- [ ] **Step 4: Run the final review pass**

  Perform a fresh self-review of the plan/spec against the final tree, focusing on lockout concurrency, Session tampering, forced password change, cookie flags, and server-only secret boundaries. If a material issue is found, add a failing test first, fix it, and rerun the complete suite.

- [ ] **Step 5: Commit verification-only fixes, if any**

  ```bash
  git add <verified-fix-files>
  git commit -m "fix: address final auth verification findings"
  ```
