# 第二阶段执行计划：认证收尾 · 账号脚本 · 签到与请假

> 写给 Codex 的执行规格。放在 `docs/PHASE2_PLAN.md`。按顺序执行，每个阶段的「验收门」全部通过才进入下一阶段。
> 本文已替你做完产品与技术决策；文中没写到的小决定，选最简单且与本文一致的做法，并记入 `PROJECT_STATUS.md` 的「决策记录」，不要停下来问。
> 运行配置（用户在 Codex 端设置）：6.1 sol，推理 ultra，不开倍速。用户要求使用 @ponytail：开始前按其自身说明加载并遵循。

## 0. 授权范围与硬性规则

用户本次明确授权（覆盖 `AGENTS.md` 中「不要提交/不要动远端」的默认限制，仅限本任务）：

- **@GitHub**：新建分支 `codex/phase2-auth-attendance`，每个阶段一个 commit，完成后开 **Draft PR** 到 `main`。禁止 merge、禁止 force push、禁止改 `main`。
- **@Supabase**：可对当前连接的项目执行本文列出的 migration、生成类型、跑安全顾问、建/删 `smoke-` 前缀测试数据。不得修改与本项目无关的既有对象（包括顾问提到的那个旧公开函数）。
- **@OpenDesign**：只用于第 C4 节的页面设计。

其余 `AGENTS.md` 规则照旧，尤其：不读/不输出 `.env.local`；不在任何地方写入真实密码、哈希或 Service Role Key；测试先行；验证命令**串行**运行；进度文档如实记录。

开始前：
1. `git status`。本地 `src/lib/auth/service.test.ts` 可能有未提交修改——**保留**，它们是 A1/A2 的回归测试。只有在本文要求改接口时，才最小化调整测试夹具（memory repository），不得删改已有断言。
2. 跑一次基线：`npm test`、`npm run typecheck`（预期 A1/A2 相关失败），记录结果后开始。

## 1. 全局决策记录（已拍板，直接执行）

| 主题 | 决定 |
|---|---|
| Session 撤销 | `users` 增加 `session_version int` 与 `is_active bool`。Session 载荷带 `sessionVersion`；**服务端守卫**每次请求按主键查一次用户，版本不符或已停用即失效。Proxy 不查库，只做解密、路由和续期。 |
| 改密 | 改密原子地 `session_version + 1`，当前浏览器拿到新版本 Session，其他设备全部下线。 |
| 失效跳转 | 新增 `GET /auth/expired`：清 Cookie 后 302 到 `/login?reason=expired`（Server Component 不能删 Cookie，且直接跳 `/login` 会被 Proxy 弹回首页造成循环）。 |
| 改密接口续期 | Proxy 继续跳过 `/api/auth/*`；改密路由在**所有非 401 响应**上自行重设 Session Cookie。 |
| CSRF | 所有新写接口与改密接口：要求 `Content-Type: application/json`，且 `Origin` 必须存在并等于 `request.nextUrl.origin`，否则 403。 |
| 数据访问 | 延续现有架构：全部经服务端 Admin Client；新表开 RLS、撤销 anon/authenticated、仅授权 service_role。并发敏感操作写成 `SECURITY INVOKER` + `SET search_path = ''` 的 RPC。 |
| 时区 | 新环境变量 `CLUB_TIME_ZONE`，默认 `Asia/Shanghai`（UTC+8）。数据库一律 `timestamptz`，输入输出在服务端按该时区换算。 |
| 签到方式 | 每个场次一个服务端生成的 6 位数字签到码，老师投屏，成员输入。窗口：开始前 15 分钟至结束。超过开始时间 + `late_after_minutes`（默认 10）记「迟到」。每人每场最多错 5 次；老师重置签到码会清零错误次数。 |
| 请假 | 按场次请假。类型：事假 `personal`、病假 `sick`、公假 `official`。可提交至场次结束前；开始后提交标记为「补交」。成员只能撤回待审批的申请。老师驳回必须填写意见。 |
| 状态优先级 | 签到/老师登记记录 > 已批准请假（记为「请假」）> 场次未结束（「未签到」）> 场次已结束（「缺勤」）。缺勤不入库，按需计算。 |
| 名单 | 场次名单 = 当前 `is_active` 的成员，且 `created_at < 场次结束时间`。停用成员不出现在任何名单与统计中（历史数据保留）。 |
| 出勤率 | `(已到 + 迟到) / (已结束场次数 − 请假)`；分母为 0 时显示「—」。 |
| 老师权限 | 所有老师权限相同。 |
| 新依赖 | 不加运行时依赖。校验手写（沿用 auth 模块风格），时区用 `Intl`。 |
| 本阶段不做 | 活动报名、评分排行榜、CSV 导出、实时推送、通知、网页端成员管理、Vercel 部署。 |

## 阶段 A：认证审查遗留项（commit: `fix(auth): close review findings`）

### A-迁移 `supabase/migrations/<ts>_auth_hardening.sql`

```sql
ALTER TABLE public.users
  ADD COLUMN session_version integer NOT NULL DEFAULT 1,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT users_session_version_positive CHECK (session_version >= 1);

CREATE OR REPLACE FUNCTION public.reset_login_failures(p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  WITH updated AS (
    UPDATE public.users AS t
    SET failed_login_count = 0, locked_until = NULL, updated_at = pg_catalog.now()
    WHERE t.id = p_user_id AND t.is_active
      AND (t.locked_until IS NULL OR t.locked_until <= pg_catalog.now())
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$function$;

-- 改密：返回新 session_version；用户不存在/停用返回 NULL
CREATE OR REPLACE FUNCTION public.change_user_password(p_user_id uuid, p_password_hash text)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  UPDATE public.users AS t
  SET password_hash = p_password_hash, must_change_password = false,
      failed_login_count = 0, locked_until = NULL,
      session_version = t.session_version + 1, updated_at = pg_catalog.now()
  WHERE t.id = p_user_id AND t.is_active
  RETURNING t.session_version;
$function$;

-- 脚本重置密码：强制下次登录改密并踢下线
CREATE OR REPLACE FUNCTION public.admin_reset_password(p_username text, p_password_hash text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  WITH updated AS (
    UPDATE public.users AS t
    SET password_hash = p_password_hash, must_change_password = true,
        failed_login_count = 0, locked_until = NULL,
        session_version = t.session_version + 1, updated_at = pg_catalog.now()
    WHERE t.username = p_username
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$function$;
```
三个函数都要：`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`

迁移流程（本文所有迁移通用）：先写本地文件 → @Supabase `apply_migration`（同名）→ `list_migrations` 核对版本号，若与本地文件名时间戳不同，把本地文件重命名为远端版本 → `generate_typescript_types` 覆盖 `src/lib/supabase/database.types.ts` → `get_advisors(security)`，新出现的告警必须处理，旧告警只记录。

### A1 未知用户名计时均衡
- `constants.ts` 新增 `DUMMY_PASSWORD_HASH`：用 bcryptjs 对一个随机丢弃的字符串做 cost-12 哈希后硬编码（注释说明它不对应任何密码、非机密）。
- `authenticateUser`：用户不存在 **或** `!user.isActive` 时，执行 `verify(password, DUMMY_PASSWORD_HASH)` 后返回 `invalid_credentials`。被锁定用户仍按现有测试要求不做比较直接返回 `locked`。

### A2 成功登录原子清锁
- `UserRepository.resetLoginFailures(userId): Promise<boolean>`，Supabase 实现改为调用 RPC `reset_login_failures`。
- 服务：密码正确后调用它；返回 `false` → 返回 `{ ok:false, reason:"locked" }`，**不签发 Session**。
- 现有测试「does not clear a lock created while a valid password comparison is in flight」必须通过。

### A3 Session 版本与停用
- `UserRecord` 增加 `sessionVersion`、`isActive`；`SessionPayload` 增加 `sessionVersion: number`，`isSessionPayload` 校验为正整数（旧 Cookie 自然失效）。
- `UserRepository.updatePassword` 改名 `changePassword(userId, hash): Promise<number | null>`（调用 RPC），`changeUserPassword` 用返回的新版本构造 Session。
- 新建 `src/lib/auth/current-user.ts`（`server-only`）：
  - `loadValidUser(session, repo)`：查库，存在且 `isActive` 且版本一致才返回 `UserRecord`，否则 `null`。
  - `requireSession()`（迁到这里或改 `guards.ts`）：无效 → `redirect("/auth/expired")`。返回值的 `role/name/mustChangePassword` **以数据库为准**。
  - `requireRole(role)` 行为不变，但基于数据库值。
- 新建 `src/app/auth/expired/route.ts`（GET）。登录页在 `reason=expired` 时显示「登录已失效，请重新登录」。

### A4 改密接口续期 + 同源校验
- 新建 `src/lib/http/api.ts`：`assertJsonSameOrigin(request)`、`jsonResponse(body, status)`（统一带 `Cache-Control: no-store`）。
- 改密路由：先同源校验；再用 `loadValidUser` 校验 Session（无效 → 401 + 清 Cookie）；所有 400/500 响应都 `setSessionCookie(response, session)` 续期。

### A 测试（先写）
service：未知/停用用户做 dummy 比较；并发锁定不发 Session；改密返回新版本。route：改密失败响应带续期 Cookie；Origin 缺失/不符 403；版本不符 401。guards：版本不符/停用跳 `/auth/expired`。

**验收门 A**：`npm test` → `npm run typecheck` → `npm run lint` → `npm run build` 全部通过（串行）。

## 阶段 B：账号脚本（commit: `feat(accounts): create-user script`）

### 结构
- 把 `normalizeUsername` 和新用户名规则移到 **不含 `server-only`** 的 `src/lib/auth/username.ts`，`validation.ts` 重新导出。规则：`^[a-z0-9][a-z0-9._-]{2,31}$`（规范化后）。姓名：trim 后 1–40 字符。
- 纯逻辑放 `src/lib/accounts/cli.ts`（不导入 `server-only` 模块）：参数解析、CSV 解析、行校验、构造插入行、输出格式化。数据库操作通过注入的接口完成，便于测试。
- `scripts/create-user.ts`：`dotenv` 读取 `.env.local`，自行用 `@supabase/supabase-js` 建客户端（同 `admin.ts` 的 URL 协议检查，但不导入它），调用 `cli.ts`。

### 用法（写进 README）
```
npm run create-user -- --username alice --name "Alice" --role member
npm run create-user -- --csv members.csv            # 表头：username,name,role
npm run create-user -- --reset alice                # 新随机密码 + 强制改密 + 踢下线
npm run create-user -- --deactivate alice | --activate alice
任意命令可加 --dry-run（只校验不写库）
```

### 行为
- 每个新账号/重置：`generateInitialPassword()` 独立随机，cost-12 哈希，`must_change_password = true`。
- CSV：先校验全部行（格式、文件内重复、库内已存在），**任一失败则整批不写**并列出问题行；通过后单次批量 insert（原子）。
- 写库成功后才在 stdout 打印一次 `用户名 | 姓名 | 角色 | 初始密码` 表格，并提示「仅显示这一次」。不写文件、不写日志；失败路径绝不输出密码。
- 执行前打印目标 Supabase 主机名（不打印密钥）。
- `--deactivate`：`is_active=false` 且 `session_version+1`（可直接 update + 再读，或补一个小 RPC，自行选）。

### 测试
参数/CSV 解析与错误信息；构造的行哈希 cost=12、两账号密码不同、`must_change_password=true`；校验失败时注入的 insert 未被调用；输出函数只在成功后调用。

**验收门 B**：四项检查通过 + 用 `--dry-run` 实跑一次 + 创建 `smoke-teacher`、`smoke-m1`、`smoke-m2` 三个真实测试账号（供 C5 冒烟，最后删除）。

## 阶段 C：签到与请假

### C1 迁移 `<ts>_attendance_and_leave.sql`（commit: `feat(db): attendance and leave schema`）

```sql
CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  title text NOT NULL,
  location text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  late_after_minutes integer NOT NULL DEFAULT 10,
  checkin_code text NOT NULL,
  cancelled_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT meetings_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 60),
  CONSTRAINT meetings_location_len CHECK (location IS NULL OR char_length(location) <= 60),
  CONSTRAINT meetings_time_order CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '12 hours'),
  CONSTRAINT meetings_late_range CHECK (late_after_minutes BETWEEN 0 AND 120),
  CONSTRAINT meetings_code_format CHECK (checkin_code ~ '^[0-9]{6}$')
);
CREATE INDEX meetings_starts_at_idx ON public.meetings (starts_at);

CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('present','late','excused','absent')),
  checked_in_at timestamptz,
  source text NOT NULL CHECK (source IN ('self','teacher')),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT attendance_one_per_member UNIQUE (meeting_id, user_id),
  CONSTRAINT attendance_self_has_time CHECK (source <> 'self' OR checked_in_at IS NOT NULL)
);
CREATE INDEX attendance_user_idx ON public.attendance_records (user_id);

CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  leave_type text NOT NULL CHECK (leave_type IN ('personal','sick','official')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  review_comment text CHECK (review_comment IS NULL OR char_length(review_comment) <= 200),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT leave_review_consistency CHECK ((status IN ('approved','rejected')) = (reviewed_at IS NOT NULL)),
  CONSTRAINT leave_reject_has_comment CHECK (status <> 'rejected' OR review_comment IS NOT NULL)
);
CREATE UNIQUE INDEX leave_one_active_per_meeting
  ON public.leave_requests (meeting_id, user_id) WHERE status IN ('pending','approved');
CREATE INDEX leave_status_idx ON public.leave_requests (status, created_at);

CREATE TABLE public.checkin_code_failures (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  failed_count integer NOT NULL CHECK (failed_count BETWEEN 1 AND 5),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (meeting_id, user_id)
);

-- 成员签到：一次调用完成窗口、错误次数、校验码、写入，返回结果码
CREATE OR REPLACE FUNCTION public.member_check_in(p_meeting_id uuid, p_user_id uuid, p_code text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_m public.meetings%ROWTYPE;
  v_now timestamptz := pg_catalog.now();
  v_fail integer;
  v_status text;
BEGIN
  SELECT * INTO v_m FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND OR v_m.cancelled_at IS NOT NULL THEN RETURN 'not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.role = 'member'
                 AND u.is_active AND u.created_at < v_m.ends_at) THEN RETURN 'forbidden'; END IF;
  IF v_now < v_m.starts_at - interval '15 minutes' THEN RETURN 'not_open'; END IF;  -- 与 CHECKIN_OPENS_BEFORE_MINUTES 同步
  IF v_now > v_m.ends_at THEN RETURN 'closed'; END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_records r
             WHERE r.meeting_id = p_meeting_id AND r.user_id = p_user_id) THEN RETURN 'already_recorded'; END IF;
  SELECT f.failed_count INTO v_fail FROM public.checkin_code_failures f
   WHERE f.meeting_id = p_meeting_id AND f.user_id = p_user_id;
  IF COALESCE(v_fail, 0) >= 5 THEN RETURN 'too_many_attempts'; END IF;
  IF p_code IS DISTINCT FROM v_m.checkin_code THEN
    INSERT INTO public.checkin_code_failures AS f (meeting_id, user_id, failed_count, updated_at)
    VALUES (p_meeting_id, p_user_id, 1, v_now)
    ON CONFLICT (meeting_id, user_id)
    DO UPDATE SET failed_count = LEAST(f.failed_count + 1, 5), updated_at = v_now
    RETURNING f.failed_count INTO v_fail;
    RETURN CASE WHEN v_fail >= 5 THEN 'too_many_attempts' ELSE 'wrong_code' END;
  END IF;
  v_status := CASE WHEN v_now > v_m.starts_at + pg_catalog.make_interval(mins => v_m.late_after_minutes)
                   THEN 'late' ELSE 'present' END;
  INSERT INTO public.attendance_records (meeting_id, user_id, status, checked_in_at, source, updated_by)
  VALUES (p_meeting_id, p_user_id, v_status, v_now, 'self', p_user_id)
  ON CONFLICT (meeting_id, user_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'already_recorded'; END IF;
  RETURN v_status;
END;
$function$;
```
四张表都：`ENABLE ROW LEVEL SECURITY`；`REVOKE ALL ... FROM PUBLIC, anon, authenticated`；`GRANT SELECT, INSERT, UPDATE, DELETE ... TO service_role`；`CREATE POLICY <表>_service_role_all ... FOR ALL TO service_role USING (true) WITH CHECK (true)`。RPC 同 A 的授权方式。

迁移后用 @Supabase `execute_sql` 在 smoke 数据上验证 RPC 的每个返回码（not_open / wrong_code ×5 → too_many_attempts / present / late / already_recorded / closed），记录结果。

### C2 领域层 `src/lib/attendance/`（commit: `feat(attendance): domain services`）

| 文件 | 内容 |
|---|---|
| `constants.ts` | `CHECKIN_OPENS_BEFORE_MINUTES=15`、`MAX_CODE_ATTEMPTS=5`、`TEXT_MAX=200`、`TITLE_MAX=60`、`DEFAULT_LATE_MINUTES=10` |
| `time.ts` | `getClubTimeZone()`（读 env，`Intl` 校验，非法则抛错）；`zonedLocalToUtc(date, time, tz)`；`formatClubDateTime(iso)`。测试须含 `America/New_York` 夏令时切换日。 |
| `status.ts`（纯函数） | `meetingPhase(m, now)`: `upcoming / open / closed / cancelled`；`effectiveStatus(record, leave, m, now)`: `present / late / excused / absent / pending`；`summarize(statuses)` → 计数与出勤率 |
| `code.ts` | `generateCheckinCode()`：`crypto.randomInt(0, 1_000_000)` 补零到 6 位 |
| `validation.ts` | `isUuid`、`parseMeetingInput`、`parseLeaveInput`、`parseReviewInput`、`parseOverrideInput`，失败返回带字段名的错误 |
| `repository.ts` | 接口 + Supabase 实现。**面向成员的查询必须显式列出列且不含 `checkin_code`**（加测试断言） |
| `service.ts` | 下列用例，返回判别联合（`{ok:true,...} \| {ok:false, reason}`），`now` 可注入 |

服务用例与规则：
- **老师**
  - `createMeeting`：标题 1–60，地点 ≤60 可空，日期+开始/结束时间按俱乐部时区换算；结束 > 开始，时长 ≤12h；开始时间 ≥ 现在−7天、≤ 现在+365天；迟到阈值 0–120。
  - `updateMeeting`：仅在签到窗口打开前、未取消时可改上述字段。
  - `cancelMeeting`：结束前、未取消时；同时把该场所有 `pending` 请假置为 `cancelled`。
  - `regenerateCode`：未取消且未结束；更新签到码并删除该场 `checkin_code_failures`。
  - `setAttendance(meetingId, userId, status | null, note)`：窗口已打开后的未取消场次；目标须是名单内成员；`null` = 删除记录（回到自动计算）；upsert，`source='teacher'`、`updated_by`。
  - `reviewLeave(id, decision, comment)`：条件更新 `WHERE status='pending'`，0 行 → `already_reviewed`；驳回必须有意见。
  - 读取：`getTeacherDashboard(now)`（进行中场次 + 已签到数/名单数；全部待审批请假含成员名与场次；未结束场次 + 最近 20 个已结束场次）；`getMeetingDetail(id)`（场次信息含签到码、名单每人的有效状态、签到时间、请假信息、备注）。
- **成员**
  - `checkIn(meetingId, userId, code)`：code 先做 `^\d{6}$` 格式校验，再调用 RPC，透传结果码。
  - `submitLeave`：场次未取消且 `now < ends_at`；未签到（无 present/late 记录）；唯一索引冲突（23505）→ `duplicate`；`late_submission = now >= starts_at` 计算后返回给 UI 展示（不入库）。
  - `cancelLeave(id, userId)`：条件更新 `WHERE user_id=$ AND status='pending'`。
  - `getMemberDashboard(userId, now)`：当前可签到且未记录的场次；未来 14 天场次及我的状态/请假；我的请假记录（最近 20）；已结束场次统计 + 最近 10 条记录。

测试：用内存 repository（仿照 `service.test.ts` 的写法）覆盖每条规则的成功与失败分支；`status.ts`、`time.ts` 表驱动测试。

### C3 接口（commit: `feat(attendance): api routes`）

`src/lib/http/api.ts` 增加包装器 `withApi(role, handler)`：同源 + JSON 校验 → `loadValidUser`（无效 401 并清 Cookie；`mustChangePassword` 或角色不符 403）→ 执行 → 未知异常 500「操作失败，请稍后重试」。全部响应 `no-store`。Next 16 中动态参数 `params` 是 Promise，需 `await`；所有 id 先 `isUuid`。

| 方法 | 路径 | Body |
|---|---|---|
| POST | `/api/teacher/meetings` | `{title, location?, date, startTime, endTime, lateAfterMinutes?}` |
| PATCH | `/api/teacher/meetings/[id]` | `{action:"update", ...字段}` / `{action:"cancel"}` / `{action:"regenerate_code"}` |
| PUT | `/api/teacher/meetings/[id]/attendance/[userId]` | `{status: "present"\|"late"\|"excused"\|"absent"\|null, note?}` |
| POST | `/api/teacher/leave-requests/[id]/review` | `{decision:"approved"\|"rejected", comment?}` |
| POST | `/api/member/check-in` | `{meetingId, code}` |
| POST | `/api/member/leave-requests` | `{meetingId, leaveType, reason}` |
| POST | `/api/member/leave-requests/[id]/cancel` | — |

错误码 → HTTP：校验失败 400（附 `fieldErrors`）；不存在 404；状态冲突（已审批、已签到、已结束等）409；`too_many_attempts` 429；其余按上。每个 reason 映射一条简短中文提示，集中在 `src/lib/attendance/messages.ts`。

测试：每个路由至少覆盖 成功 / 未登录 401 / 错角色 403 / Origin 不符 403 / 校验 400 / 一个业务冲突。成员接口响应中不得出现 `checkin_code`。

### C4 界面（commit: `feat(ui): teacher and member dashboards`）

**先用 @OpenDesign 出稿，再实现。** 把下面的设计简报原样交给 OpenDesign，产出 4 个画面：老师首页（桌面 1280）、场次详情（桌面）、投屏页（1920 横屏）、成员首页（手机 390 + 桌面）。稿件导出/链接记录到 PR 描述。若 OpenDesign 不可用，直接按简报实现并在 PR 中注明。

设计简报：
- 定位：学校社团内部工具，干净、可信、信息密度适中。延续现有视觉：背景 `#f4f6fb`、白色卡片 `rounded-2xl` + `border-slate-200` + 轻阴影、主色 indigo-600、正文 slate。中文界面，字体沿用现有设置。
- 状态色（**必须同时有文字**，不能只靠颜色）：已到 emerald、迟到 amber、请假 sky、缺勤 rose、未签到 slate、待审批 violet。
- 公共外壳 `AppShell`：顶栏（CLUB PORTAL 标识、页面标题、姓名 + 角色标签、退出）；老师端顶栏下有二级导航：「概览」「场次」。替换并删除 `EmptyDashboard`（同步更新 `ui.test.tsx`）。
- 老师首页 `/teacher`：
  1. 「正在签到」卡：标题、时间地点、**大号签到码**（默认显示，带「投屏」按钮→新标签打开投屏页、「重置签到码」需二次确认）、进度条「已签到 x / y」。无进行中场次时显示下一场的倒计时或空状态。
  2. 「待审批请假」列表：成员、场次、类型、理由、是否补交、提交时间；行内「批准」「驳回」（驳回展开必填意见框）。空状态「暂无待审批请假」。
  3. 「场次」：「新建场次」表单（标题、地点、日期、开始、结束、迟到阈值）+ 未结束场次列表 + 最近已结束场次；每行显示阶段标签和出勤概况，点击进入详情。
- 场次详情 `/teacher/meetings/[id]`：信息头（含编辑/取消，按规则禁用并给出原因）、签到码区、名单表格（姓名、有效状态、签到时间、请假信息、备注、「修改」下拉：已到/迟到/请假/缺勤/恢复自动 + 备注）。顶部状态计数小卡。
- 投屏页 `/teacher/meetings/[id]/display`：全屏、无导航，超大签到码、场次标题、剩余签到时间、已签到人数；每 10 秒 `router.refresh()`。
- 成员首页 `/member`（移动优先）：
  1. 顶部「现在签到」卡（仅在有可签到场次时出现）：6 个数字输入格（`inputMode="numeric"`、支持粘贴）、提交后显示结果（已到/迟到/码错误剩余次数/次数用尽请联系老师）。
  2. 「接下来」：未来 14 天场次卡，显示我的状态与请假状态；可请假时显示「请假」按钮→ 底部抽屉/展开表单（类型分段选择、理由 200 字计数、补交提示）。
  3. 「我的出勤」：出勤率大数字 + 四项计数 + 最近 10 条记录。
  4. 「请假记录」：状态标签、老师意见，待审批可「撤回」（需确认）。
- 所有页面：加载/空/错误三种状态都要设计；按钮提交中禁用并显示进行中文案；成功后 `router.refresh()`；表单错误显示在字段下方；键盘可达，对比度满足 WCAG AA；时间统一显示为 `10月12日 周一 15:30` 格式（俱乐部时区）。

实现要求：页面为 Server Component，通过 `requireRole` + 服务层取数；交互部分拆成小的 Client Component，用 `fetch` 调 C3 接口。为签到输入、请假表单、审批操作、名单修改写组件测试。

### C5 端到端冒烟（无单独 commit，结果写入状态文档）

用 B 阶段的 smoke 账号在 `npm run dev` 上走完（有浏览器工具就用，没有就用 curl + cookie jar）：
登录与首次改密 → 老师建一场「现在开始」的场次 → 成员 m1 输错码 2 次再输对（已到）→ 改 `late_after_minutes=0` 的另一场验证迟到 → m2 请假，老师驳回（无意见被拒、有意见成功），m2 再请假，老师批准 → 老师把 m1 改为缺勤再恢复自动 → 成员页看不到签到码（查看页面源/接口响应）→ 一台设备改密后另一 cookie 被踢到 `/login?reason=expired` → 停用 m2 后其无法登录。

完成后清理：删除 smoke 老师创建的 meetings（级联删除记录/请假/失败次数），再删除 `username LIKE 'smoke-%'` 的用户。清理后确认 `public.users` 中不再有 smoke 账号。

**验收门 C**：四项检查通过；`get_advisors(security)` 无新增告警；冒烟全部通过。

## 阶段 D：文档与 PR（commit: `docs: phase 2 status`）

- `docs/PROJECT_STATUS.md`：更新日期；把审查遗留项 1–4 标为已解决并说明做法；第 5 项保持「待维护者决定」；新增「签到与请假」已完成内容、决策记录（第 1 节 + 执行中自行拍板的小决定）、迁移清单、远端验证与冒烟记录（如实写测试数量与命令结果）；下一步：活动报名 → 评分排行榜 → 部署。
- `README.md`：当前进度、`create-user` 用法、`CLUB_TIME_ZONE`。
- `AGENTS.md`：删除「create-user 尚未实现」相关句子；补一句「签到/请假数据只经服务端访问，成员端查询不得返回签到码」。
- `.env.example`：加 `CLUB_TIME_ZONE=Asia/Shanghai`。
- 开 Draft PR：标题 `Phase 2: auth hardening, account script, attendance & leave`；描述含：变更摘要、迁移列表（标明已应用到远端）、OpenDesign 稿件、验证结果、未做事项。

## 停止条件

只有以下情况才停下并说明：需要删除或改写非 smoke 的真实数据；需要修改与本项目无关的数据库对象；迁移在远端失败且无法用新迁移前向修复；需要 force push 或改 `main`；需要新增运行时依赖。其他问题自行解决并记录。
