# Codex 协作说明

## 项目定位与当前阶段

这是一个面向学生社团的管理工具，由指导老师与开发同伴共同维护。当前是第一阶段的测试底座：Next.js、基础认证、角色区分和空首页已建立；签到/请假、活动报名、评分与排行榜尚未实现。开始工作前先读 `README.md` 和 `docs/PROJECT_STATUS.md`，以代码和当前状态文件为准，不要把路线图当成已实现功能。

账号由老师预先创建并分发，网站永远不开放自助注册。本项目使用自定义 Supabase `public.users` 用户表，而不是 Supabase Auth 邮箱登录。

## 不可违反的安全边界

- Service Role Key 只允许留在服务端环境；不得使用 `NEXT_PUBLIC_` 前缀，不得写入源码、测试快照、日志、README、提交或浏览器响应。
- 不读取、输出或提交 `.env.local`、真实密码、密码哈希或真实用户数据。`.env.local` 和 `.superpowers/` 是本地忽略文件/目录；除非用户另行要求，不要检查其内容或清理它们。
- 密码采用 bcrypt，cost factor 为 12；不得记录明文密码。预置账号的初始密码必须逐账号随机生成且仅一次性显示，首次登录后必须改密。
- 连续 10 次登录失败后锁定 5 分钟。涉及计数、解锁或成功登录清零的数据库操作必须考虑并发，使用受限、原子化的数据库接口。
- Session 使用成熟库 `jose`，Cookie 必须保持 `Secure`、`HttpOnly`、`SameSite=Lax`；服务端负责身份与角色授权。
- `public` schema 中的用户表必须启用 RLS，并仅向确有需要的服务端角色授权。数据库结构变更要添加 migration；对已连接的远端 Supabase 项目执行迁移前，先确认用户明确要求。
- `docs/_to_remove/` 是维护者暂存待删资料的目录。未经用户明确要求，不要将其中内容当作现行规范，也不要擅自删除或恢复。

## 开发与协作

- 开始前检查 `git status` 和相关文件；保留所有已有及未提交改动，不要覆盖其他开发者的工作。
- 修改应围绕用户当前明确指定的范围；先补测试再实现认证、安全或数据行为变更。
- 不要自行执行 `git commit`、`git push`、创建 PR 或上传 GitHub。仓库维护者会手动提交和上传。
- 功能完成后更新 `docs/PROJECT_STATUS.md`，如实写清实现内容、未完成事项和验证结果；不把未运行的测试写成通过。
- 账号脚本 `scripts/create-user.ts` 尚未实现。尽管 `package.json` 已声明 `create-user` 命令，在该文件真正实现并通过测试前，不要建议或依赖该命令。

## 验证命令

按改动范围运行适当验证；全量检查可依次运行：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

不要并行启动测试与类型检查；曾出现过 Vitest worker 启动超时。涉及 Supabase 的改动还需验证迁移、RLS/权限及相关安全顾问结果，并在进度文档中记录远端验证是否执行。
