# 社团管理工具

面向学生社团的内部管理工具，由指导老师与开发同伴共同维护。账号由老师预先创建并分发；网站不开放注册。项目使用 Next.js（App Router、TypeScript）、Supabase 与 Tailwind CSS，后续计划部署到 Vercel。

## 当前进度

目前正在执行第二阶段：认证审查修复已完成，账号创建、批量导入、重置与启停脚本已实现；老师/成员首页仍为空，签到与请假正在后续阶段建设，活动报名、评分排行榜与部署尚未完成。各阶段验收与远端验证的准确状态见 [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)。

当前已具备：

- 预建账号登录；没有注册入口。
- 老师与成员角色的服务端页面守卫及空首页。
- bcrypt 密码哈希（cost 12）、连续 10 次失败锁定 5 分钟、首次登录强制改密。
- 使用 `jose` 加密的 Session Cookie；设置 `Secure`、`HttpOnly`、`SameSite=Lax`，受保护请求刷新 30 天空闲期限。
- 自定义 Supabase `public.users` 表与迁移；RLS/权限限制为服务端使用。
- 服务器每次检查账号启用状态与 Session 版本；改密、管理员重置或停用账号可撤销旧 Session。
- 未知/停用账号的固定 bcrypt 比较、原子成功登录清锁、改密接口同源校验与空闲续期。

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

## 技术与安全边界

- 登录凭证保存在自定义 `public.users` 表中，不使用 Supabase Auth 邮箱登录。
- Service Role Key 仅能用于服务端 Supabase Admin Client；客户端组件、`NEXT_PUBLIC_*` 变量和浏览器响应不得包含它。
- `public.users` 开启 RLS，匿名及普通认证角色没有表访问权限；认证逻辑在服务端执行。
- 角色授权必须由服务端守卫完成，不能依赖客户端隐藏按钮。
- 数据库结构变更放入新的 Supabase migration，并检查权限/RLS；不要把真实凭证、初始密码或用户数据写入仓库。
- 当前仍在第二阶段实施，尚未完成生产部署；验收与审查遗留项见 [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)。

## 产品路线

1. **登录与角色基础**：认证框架、Session 撤销与账号脚本已实现；验收状态见进度文档。
2. **签到与请假**：成员签到、提交请假申请，老师审批。
3. **活动与比赛报名**：老师发布活动，成员在线报名。
4. **评分与排行榜**：依据签到、请假、参与和比赛成绩维护综合评分，并展示公开排行榜。

本项目的实现思路参考了 [Clunite.club](https://github.com/Omen-bit/Clunite.club)（MIT License），只作为认证/角色区分的参考；本仓库不包含其证书生成、财务管理等模块。

## 文档说明

`docs/_to_remove/planning/` 暂存旧的设计与实施计划，供仓库维护者确认后自行删除；它们不是当前开发状态的权威说明。协作约定见 [`AGENTS.md`](AGENTS.md)。

## 许可证

本项目采用 GNU Affero General Public License v3.0-only（AGPL-3.0-only）；完整条款见 [LICENSE](LICENSE)。
