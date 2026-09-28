# 社团管理网站第一阶段认证与角色首页设计

## 目标

在一个全新的 Next.js App Router + TypeScript + Tailwind CSS 项目中，接入现有 Supabase 项目 `pcmsgasc.io`，实现仅允许预先创建账号登录的社团管理网站基础认证流程：老师进入空后台首页，成员进入空成员首页。

本阶段明确不包含注册、证书生成、财务管理、用户管理后台或其他业务模块。

## 已确认的约束

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

## 架构方案

### 应用层

- 使用 Next.js App Router。
- `/login` 是唯一登录入口。
- `/teacher` 为老师空后台首页。
- `/member` 为成员空首页。
- `/change-password` 为首次登录强制修改密码页面。
- `/` 根据 Session 跳转到对应首页；未登录跳转 `/login`。
- 登录、登出和改密使用 Route Handler；受保护页面在服务端校验 Session 与角色。
- 使用一个受保护路由层在请求时验证并刷新 Session Cookie，从而实现 30 天无操作自动过期和活动续期。

### Session

Session 使用 `jose` 的 `EncryptJWT` / `jwtDecrypt`，采用 AES-GCM（`A256GCM`）保护以下最小字段：

- `userId`
- `username`
- `role`
- `name`
- `mustChangePassword`

密钥通过 `SESSION_SECRET` 环境变量提供，应用启动或首次使用时校验其长度/格式；应用代码不实现自定义加密逻辑。Session 有效期为 30 天，Cookie 采用 `Secure`、`HttpOnly`、`SameSite=Lax`。

### Supabase 数据层

`public.users` 包含以下字段：

- `id uuid primary key`
- `username text unique not null`
- `password_hash text not null`
- `role text not null check (role in ('teacher', 'member'))`
- `name text not null`
- `must_change_password boolean not null default true`
- `failed_login_count integer not null default 0`
- `locked_until timestamptz null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

启用 RLS，并撤销 `anon` 与 `authenticated` 对该表的访问；只有服务端 Supabase Admin Client 使用 Service Role Key 读取和更新用户。密码哈希、锁定计数和锁定时间不会通过浏览器或公开 Data API 暴露。

为保证并发登录失败计数不会丢失，迁移增加一个仅授予 `service_role` 执行权限的原子数据库函数，用于记录失败次数并在第 10 次失败时设置 5 分钟锁定时间。该函数使用 `SECURITY INVOKER`，不使用公开的 `SECURITY DEFINER` 绕过权限。

### 账号创建

`create-user.ts`：

1. 从命令行读取 `username`、`role` 和 `name`。
2. 使用 Node 的安全随机源生成独立初始密码。
3. 使用 bcrypt cost factor 12 生成哈希。
4. 以 `must_change_password=true` 写入 Supabase。
5. 仅在终端输出一次初始密码，不写入源码、日志文件或数据库明文。

首次改密需要输入当前初始密码和新密码；成功后更新哈希、将 `must_change_password` 设为 `false`，并清除失败计数与锁定状态。

## 错误与安全行为

- 用户名不存在、密码错误统一返回登录失败，不向浏览器返回密码哈希或数据库错误详情。
- 已锁定账号不会继续执行密码校验，直到 `locked_until` 结束。
- 过期锁定状态在下一次失败尝试时重置计数并重新开始累计。
- 非法、过期或无法解密的 Session 会被清除并跳转登录页。
- 已登录但角色不匹配时返回到自己的角色首页，不允许跨角色访问。
- `must_change_password=true` 时，除改密页、登出接口和必要的静态资源外，其他受保护页面都跳转到 `/change-password`。
- 不在仓库中提交 `.env.local`、Service Role Key 或实际账号密码。

## 测试与验证

- 单元测试：密码生成/哈希 cost factor、密码校验、Session 加密解密、Session 30 天 TTL、锁定阈值和过期重置逻辑。
- 静态验证：TypeScript 类型检查、ESLint、生产构建。
- 数据库验证：迁移后检查表字段、约束、RLS、权限和登录失败原子函数；不读取或输出真实密码。
- 手动冒烟路径：预创建一个老师账号和一个成员账号，分别验证登录跳转、首次改密、错误密码累计 10 次锁定、角色越权跳转和登出。

## 明确不做的内容

- 不启用 Supabase Auth 的 `auth.users` 作为本阶段登录凭证存储；本阶段按已确认的自定义 `users.password_hash` 方案实现。
- 不提供注册、找回密码、邮箱验证、OAuth、验证码、用户管理页面。
- 不添加与登录/角色首页无关的社团业务模块。
