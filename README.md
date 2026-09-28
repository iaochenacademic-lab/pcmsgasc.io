# 社团管理工具

面向学生社团的内部管理工具，由指导老师与开发同伴共同维护。账号由老师预先创建并分发；网站不开放注册。项目使用 Next.js（App Router、TypeScript）、Supabase 与 Tailwind CSS，后续计划部署到 Vercel。

## 当前进度

目前处于第一阶段的认证与角色分流测试底座：应用框架、基础登录流程和角色首页已经搭好，但老师/成员首页仍为空，签到、请假、活动报名、评分与排行榜等社团业务尚未实现。详细状态和未完成事项见 [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)。

当前已具备：

- 预建账号登录；没有注册入口。
- 老师与成员角色的服务端页面守卫及空首页。
- bcrypt 密码哈希（cost 12）、连续 10 次失败锁定 5 分钟、首次登录强制改密。
- 使用 `jose` 加密的 Session Cookie；设置 `Secure`、`HttpOnly`、`SameSite=Lax`，受保护请求刷新 30 天空闲期限。
- 自定义 Supabase `public.users` 表与迁移；RLS/权限限制为服务端使用。

目前不能完整演示登录：`scripts/create-user.ts` 尚未实现，虽然 `package.json` 已声明 `npm run create-user` 命令；当前 Supabase 用户表上次检查时为空。请勿把这个命令当作可用的账号创建方式，也不要在浏览器端放置 Service Role Key。

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

登录需要已预置的账号。由于账号创建脚本尚未完成且当前没有测试账号，单纯启动应用不能完成登录冒烟测试；请先实现并审查安全的账号创建流程，不要通过公开注册或明文密码绕过它。

## 技术与安全边界

- 登录凭证保存在自定义 `public.users` 表中，不使用 Supabase Auth 邮箱登录。
- Service Role Key 仅能用于服务端 Supabase Admin Client；客户端组件、`NEXT_PUBLIC_*` 变量和浏览器响应不得包含它。
- `public.users` 开启 RLS，匿名及普通认证角色没有表访问权限；认证逻辑在服务端执行。
- 角色授权必须由服务端守卫完成，不能依赖客户端隐藏按钮。
- 数据库结构变更放入新的 Supabase migration，并检查权限/RLS；不要把真实凭证、初始密码或用户数据写入仓库。
- 当前实现是第一阶段原型，不应视为已经完成生产部署或完整安全验收。审查遗留项见 [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)。

## 产品路线

1. **登录与角色基础**：已搭建认证框架与老师/成员空首页，仍有账号创建和安全复核工作。
2. **签到与请假**：成员签到、提交请假申请，老师审批。
3. **活动与比赛报名**：老师发布活动，成员在线报名。
4. **评分与排行榜**：依据签到、请假、参与和比赛成绩维护综合评分，并展示公开排行榜。

本项目的实现思路参考了 [Clunite.club](https://github.com/Omen-bit/Clunite.club)（MIT License），只作为认证/角色区分的参考；本仓库不包含其证书生成、财务管理等模块。

## 文档说明

`docs/_to_remove/planning/` 暂存旧的设计与实施计划，供仓库维护者确认后自行删除；它们不是当前开发状态的权威说明。协作约定见 [`AGENTS.md`](AGENTS.md)。

## 许可证

本项目采用 GNU Affero General Public License v3.0-only（AGPL-3.0-only）；完整条款见 [LICENSE](LICENSE)。
