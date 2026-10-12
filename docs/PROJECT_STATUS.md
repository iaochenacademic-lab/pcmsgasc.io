# 项目进度

最后更新：2026-09-27

## 总体状态

**第一阶段测试底座，尚非可交付的完整社团管理产品。** Next.js App Router、TypeScript、Tailwind、Supabase、自定义用户名密码登录及老师/成员角色分流框架已经搭好。老师和成员首页目前是空页面；核心社团业务尚未实现。

## 已完成的基础

- Next.js App Router 项目、Tailwind CSS、Vitest 测试工具链。
- 登录、登出、首次登录改密流程和老师/成员角色首页。
- 自定义 `public.users` schema，角色为 `teacher` / `member`；账号不通过网站注册。
- bcrypt cost 12、10 次失败后锁定 5 分钟、首次登录强制改密。
- 使用 `jose` 的加密 Session Cookie，30 天滑动空闲期限，Cookie 带 `Secure`、`HttpOnly`、`SameSite=Lax`。
- Supabase 用户表开启 RLS；数据库迁移位于 `supabase/migrations/`。

## 尚未完成／当前阻塞

- `scripts/create-user.ts` 未创建，但 `package.json` 已存在 `npm run create-user` 脚本入口；该命令目前不可用。实现安全的预置账号创建及测试是下一项优先工作。
- 上次检查时，当前连接 Supabase 项目的 `public.users` 表为 0 行，因此没有可登录的预置账号；网站没有注册页是预期行为。
- 签到、请假及审批、活动/比赛发布与报名、评分和排行榜均未实现。
- Vercel 部署、生产环境配置和完整端到端冒烟测试未完成。

## 代码审查待处理

以下事项来自上一轮认证代码审查，当前工作树尚未完成对应实现修复：

1. **未知用户名的登录耗时差异**：当前认证服务在用户不存在时直接返回；应进行固定 bcrypt cost-12 虚拟哈希比较，避免用户名枚举的明显计时信号。`src/lib/auth/service.test.ts` 中有未提交的回归测试修改，必须保留并继续完成。
2. **成功登录与并发锁定的竞态**：当前成功路径使用普通更新清零失败计数；需要用原子数据库操作确认账号仍未锁定，且只有成功清零后才签发 Session。
3. **改密后的其他 Session**：加密的自包含 Session 不会因密码变化自动全局撤销；现有设计只更新当前浏览器 Session。若产品要求改密立即让其他设备下线，需要另行设计 Session 版本/撤销检查。
4. **改密 API 的空闲续期**：Proxy 当前跳过 `/api/auth/*`；有效登录态调用改密 API 但请求失败时，Session Cookie 不会按其他受保护请求的方式续期。应在改密请求路径补上安全的续期处理。
5. **Supabase 安全顾问遗留项**：上次检查还发现一个与本项目用户表无关的既有公开函数安全告警；未在本次范围内修改。正式上线前应由项目维护者复核并决定如何处理。

## 最近验证记录

- 在最近一次审查回归测试修改之前，完整验证曾通过：37 个测试、TypeScript 类型检查、ESLint 和生产构建。
- 随后 `src/lib/auth/service.test.ts` 有未提交修改，添加了上述计时均衡和并发锁定测试；修改后尚未重新跑完整验证。不要把之前的通过结果当作当前工作树的验证结论。
- Supabase 迁移及表权限曾针对连接的项目验证；本文件没有记录任何密钥或真实账号信息。

## 建议后续顺序

1. 完成并测试认证审查中的计时均衡和原子成功登录清锁。
2. 实现并测试 `scripts/create-user.ts`，安全创建独立随机初始密码的老师/成员账号。
3. 对当前工作树重新运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build`，并完成登录、改密、锁定、角色守卫和登出的冒烟验证。
4. 明确账号停用/Session 撤销需求后，进入签到与请假模块；之后依次实现活动报名、评分和排行榜。
5. 在产品和安全验收完成后再配置 Vercel 生产部署。

## 临时暂存资料

`docs/_to_remove/planning/` 保存旧设计稿和实现计划，仅供维护者确认后整体删除；当前进度以本文件、README 和实际代码为准。

## 第二阶段执行中（2026-10-12）

- 目标仓库由用户提供：iaochenacademic-lab/pcmsgasc.io；起点 main `24a9095c43e50ed9b3b4a34af319f81ac022dd22`，新本地分支 `codex/phase2-auth-attendance`。
- 克隆后的工作树干净；原文所述两项回归测试已包含在远端 main，完整保留其断言。
- 依赖：`npm ci --no-audit --no-fund` 成功，安装 457 个既有锁定包。
- 修改前基线（串行）：`npm test` 共 39 项，37 通过，2 项失败（未知账号虚拟比较、并发锁定不应签发 Session）；`npm run typecheck` 失败 1 项，resetLoginFailures 的 Promise<void> 与夹具 Promise<boolean> 不一致。
- 远端 Supabase 项目与仓库现有两项迁移一致，public.users 的元数据行数为 0。安全顾问基线仅有既有 public.rls_auto_enable 函数的 anon/authenticated 可执行 SECURITY DEFINER 两类警告；本次不修改该函数。
- 当前尚未通过阶段 A 验收。新克隆没有本地服务端配置，已向用户询问既有配置文件所在路径，不读取或展示其内容。

### 阶段 A 验收结果

- 认证计时均衡、原子成功清锁、Session版本/停用检查、改密续期和同源校验已实现；旧回归断言保留。
- 本地四项验收串行通过：89 tests / 10 files；typecheck 通过；lint 通过；Next.js 16.3.6 生产构建通过。
- 已应用远端迁移 `20261012040521_auth_hardening`，本地迁移文件与远端版本一致；已重新生成数据库类型。
- 已复核三个新 RPC 均 SECURITY INVOKER / search_path=''，anon/authenticated 不可执行，service_role 可执行；安全顾问无新增告警。
- 决策：改密 RPC 增加预期 session_version 条件，阻止已撤销的在途改密；Proxy 只负责 Cookie 与登录路由，角色及强制改密以数据库守卫为准；改密请求显式挑选密码字段，客户端不能覆盖会话身份。
- 决策：同源403按规格仅续期可解密Cookie，不查库、不授权、不执行业务；无法解密配置时500/no-store且不签发Cookie。
- 用户已提供本地配置文件，已复制至 Git 忽略位置；仅确认目标主机为 epsxsbskwlewmsstrzfu.supabase.co 及必要配置存在，未读取或展示内容。
