# 社团管理工具

面向学生社团的内部管理工具，由指导老师与开发同伴共同维护。账号由老师预先创建并分发；网站不开放注册。项目使用 Next.js（App Router、TypeScript）、Supabase 与 Tailwind CSS，后续计划部署到 Vercel。

## 当前进度

第二阶段的认证加固、账号管理脚本、签到与请假功能已实现，包括老师与成员首页、场次详情和投屏页。活动报名、评分排行榜及 Vercel 部署尚未实现。实现状态与测试验收分开记录；本地检查、远端迁移和端到端冒烟的准确结果以 [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) 为准。

当前已具备：

- 预建账号登录；没有注册入口。
- 老师与成员角色的数据库校验守卫、老师概览与成员首页。
- bcrypt 密码哈希（cost 12）、连续 10 次失败锁定 5 分钟、首次登录强制改密。
- 使用 `jose` 加密的 Session Cookie；设置 `Secure`、`HttpOnly`、`SameSite=Lax`，受保护请求刷新 30 天空闲期限。
- 自定义 Supabase `public.users` 表与迁移；RLS/权限限制为服务端使用。
- 服务器每次检查账号启用状态与 Session 版本；改密、管理员重置或停用账号可撤销旧 Session。
- 未知/停用账号的固定 bcrypt 比较、原子成功登录清锁、改密接口同源校验与空闲续期。
- 单账号创建、CSV 原子批量导入、密码重置及账号启停脚本，支持 dry-run。
- 老师创建、修改、取消场次，重置签到码，查看名单和出勤统计，登记或恢复自动出勤状态。
- 成员输入 6 位签到码签到，提交事假、病假、公假及撤回待审批申请；老师批准或填写意见后驳回。
- 场次详情与投屏页、加载与错误重试状态；成员查询与响应不包含签到码。

账号由服务端命令预置，使用方法见下方「账号管理」。运行前需配置服务端凭据并应用仓库内迁移；Service Role Key 不得放入浏览器。

## 本地开发

需要 Node.js `20.9.0` 或更新版本及 npm。

```powershell
npm ci
if (-not (Test-Path .env.local)) {
  Copy-Item .env.example .env.local
} else {
  Write-Host ".env.local 已存在；为保护现有密钥，跳过复制。"
}
```

编辑 `.env.local`，按模板填写：

- `SUPABASE_URL`：目标 Supabase 项目的 URL。
- `SUPABASE_SERVICE_ROLE_KEY`：仅供服务端使用的密钥，绝不可改名为 `NEXT_PUBLIC_*` 或提交到 Git。
- `CLUB_TIME_ZONE`：俱乐部的 IANA 时区，默认 `Asia/Shanghai`。场次日期、时间输入与展示均使用这个时区，详见下方「签到与请假」。
- `SESSION_SECRET`：为当前环境生成独立的 32 字节 Base64URL 值。可运行：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

启动开发服务器：

```powershell
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次启动前，确认目标 Supabase 项目已应用 `supabase/migrations/` 中的迁移。`.env.local` 已被 Git 忽略；请保留该规则，不要上传密钥。

常用检查命令：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

登录需要已预置的账号。通过下方脚本创建账号，再用一次性显示的初始密码登录并完成首次改密。

## 账号管理

在仓库根目录运行。脚本静默读取 `.env.local` 中的 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`，也可使用已有进程环境变量；环境变量优先。执行前会在 stderr 显示目标 Supabase 主机名，请核对目标项目。

```powershell
npm run create-user -- --username alice --name "Alice" --role member
npm run create-user -- --csv members.csv
npm run create-user -- --reset alice
npm run create-user -- --deactivate alice
npm run create-user -- --activate alice
npm run create-user -- --username alice --name "Alice" --role member --dry-run
npm run create-user -- --csv members.csv --dry-run
```

`--username`、`--csv`、`--reset`、`--deactivate` 与 `--activate` 每次只能选一种。创建单账号须同时提供姓名与角色。用户名会去除首尾空格并转成小写，需为 3–32 位，以字母或数字开头，后续只允许小写字母、数字、`.`、`_`、`-`；姓名去除首尾空格后为 1–40 个字符，角色只能是 `teacher` 或 `member`。

CSV 使用 UTF-8，表头及顺序固定为 `username,name,role`，例如：

```csv
username,name,role
alice,Alice,member
teacher-li,李老师,teacher
```

支持 UTF-8 BOM、CRLF、双引号字段及 `""` 转义。脚本先校验全部行、文件内重复及库内已有账号；出现问题时按源行号报告，整批不写。通过后仅执行一次批量插入；若校验后发生并发重名，整批插入失败。

每个新账号及重置账号均独立随机生成密码，以 bcrypt cost 12 存储，并强制下次登录改密。仅在数据库写入成功后，stdout 才显示一次 `用户名 | 姓名 | 角色 | 初始密码` 表格；脚本不保存密码文件或日志，失败时不显示密码。请在可信终端运行并当场安全分发，不要把 stdout 重定向到文件、提交记录或共享日志。

重置密码会立即撤销账号已有的全部 Session。停用账号也会原子递增 Session 版本，使旧 Session 失效；重新启用不会恢复旧 Session。

任意命令均可追加 `--dry-run`：执行格式、重复或账号存在检查，不生成密码、不写库。dry-run 仍需要有效服务端配置以完成数据库检查；配置缺失或查库失败会以非零状态退出，不会报告校验通过。

## 签到与请假

老师登录后进入 `/teacher`，可查看正在签到的场次、待审批请假、未结束及最近结束的场次，并创建新场次。`/teacher/meetings/[id]` 提供场次编辑、名单、有效出勤状态、签到时间、请假审批和老师登记。`/teacher/meetings/[id]/display` 为投屏页，每 10 秒刷新；签到窗口开放时显示大号签到码，未开放、结束或取消时显示相应状态。

成员登录后进入 `/member`，可签到、查看未来 14 天的场次、申请请假，以及查看自己的出勤率、最近记录和请假审批结果。页面与接口均由服务端校验角色、账号启用状态和 Session 版本；老师权限相同。

- 签到窗口为开始前 15 分钟至结束时间之前。超过开始时间加迟到阈值后记为迟到，默认阈值为 10 分钟。每位成员每场最多输入错误 5 次；老师重置签到码会同时清零该场错误次数。
- 只有签到窗口尚未开放且未取消的场次可修改时间与其他信息；取消场次会同时取消其待审批请假。老师可在签到窗口开放后登记出勤，已结束场次仍可更正；已取消场次不能修改出勤。
- 请假类型为事假、病假、公假，需在场次结束前提交；开始后提交会标记为「补交」。成员只能撤回自己的待审批申请，老师驳回时必须填写意见。
- 有效出勤状态优先采用签到或老师登记，其次是已批准请假；其余成员在场次结束前为未签到，结束后为缺勤。恢复自动会删除当前登记，再按请假与场次时间计算，不会恢复此前被覆盖的签到记录。
- 名单包含当前启用、且账号创建时间早于场次结束时间的成员。停用成员不计入名单或统计，历史记录保留。出勤率为 `(已到 + 迟到) / (已结束场次数 − 请假)`；已取消场次不计入，分母为 0 时显示「—」。

所有时间在数据库中使用 `timestamptz` 保存，服务端使用 `CLUB_TIME_ZONE` 转换输入及格式化显示，例如「10月12日 周一 15:30」。该变量使用 `Intl` 校验，非法时区会报错。采用夏令时的时区中，如果本地时间位于跳转造成的不存在时段，或回拨造成的重复时段，表单会拒绝该时间并要求重新选择，避免自动猜测对应时刻。时区配置只在服务端使用。

## 技术与安全边界

- 登录凭证保存在自定义 `public.users` 表中，不使用 Supabase Auth 邮箱登录。
- Service Role Key 仅能用于服务端 Supabase Admin Client；客户端组件、`NEXT_PUBLIC_*` 变量和浏览器响应不得包含它。
- `public.users` 开启 RLS，匿名及普通认证角色没有表访问权限；认证逻辑在服务端执行。
- 角色授权必须由服务端守卫完成，不能依赖客户端隐藏按钮。
- 签到与请假四张表开启 RLS，撤销匿名和普通认证角色访问权限；所有读取和写入均经服务端 Admin Client。并发敏感写操作通过受限 RPC 完成，复核角色、启用状态和 Session 版本，并锁定场次以串行处理签到、请假及码重置。
- 新业务写接口要求 JSON 和同源 `Origin`，响应不缓存。面向成员的场次查询明确列出字段，禁止返回签到码。
- 数据库结构变更放入新的 Supabase migration，并检查权限/RLS；不要把真实凭证、初始密码或用户数据写入仓库。
- 当前仍在第二阶段实施，尚未完成生产部署；验收与审查遗留项见 [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)。

## 产品路线

1. **登录与角色基础**：认证加固、Session 撤销与账号脚本已实现；验收状态见进度文档。
2. **签到与请假**：领域服务、接口、老师与成员界面已实现；远端验证及冒烟结果见进度文档。
3. **下一步：活动与比赛报名**：老师发布活动，成员在线报名。
4. **后续：评分与排行榜**：依据签到、请假、参与和比赛成绩维护综合评分，并展示公开排行榜。
5. **部署**：完成验收与生产环境配置后再部署；当前尚未部署到 Vercel。

本项目的实现思路参考了 [Clunite.club](https://github.com/Omen-bit/Clunite.club)（MIT License），只作为认证/角色区分的参考；本仓库不包含其证书生成、财务管理等模块。

## 文档说明

`docs/_to_remove/planning/` 暂存旧的设计与实施计划，供仓库维护者确认后自行删除；它们不是当前开发状态的权威说明。协作约定见 [`AGENTS.md`](AGENTS.md)。

## 许可证

本项目采用 GNU Affero General Public License v3.0-only（AGPL-3.0-only）；完整条款见 [LICENSE](LICENSE)。
