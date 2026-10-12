# 國際議題研習學會

繁體中文社團管理網站，採 React、TypeScript、Vite、Cloudflare Workers、D1 與 SQLite Durable Objects。帳號由管理員預建，沒有公開註冊。新設計由 Local Codex 生成，來源保存在 `design/`，正式程式位於 `web/` 與 `worker/`。

## 狀態與文件

- [重建規格](docs/rebuild-plan.md)
- [重建進度與驗證](docs/REBUILD_PROGRESS.md)
- [當前狀態](docs/PROJECT_STATUS.md)
- [帳號 API](docs/auth-api.md) / [社團 API](docs/club-api.md)
- [管理與部署](docs/OPERATIONS.md)

舊 Next.js/Supabase 原型已由使用者授權移除，仍保留在 Git 歷史的 `24a9095`。請勿將舊原型當作新系統的部署方式。

## 本機開發

需要 Node.js 24 與 npm。先安裝依賴，再初始化本機資料庫：

```powershell
npm ci
npm run db:migrate
```

在被 Git 忽略的 `.dev.vars` 設定 `SESSION_SECRET` 與 `CHECKIN_SECRET`，各自為獨立安全隨機值，不可使用真實正式憑證作測試。舊 `.env.local` 不再使用。

兩個終端分別啟動：

```powershell
npm run dev:api
npm run dev
```

瀏覽器開啟 Vite 顯示的本機網址。前端 `/api` 代理至本機 Worker。沒有帳號時登入會失敗，這是預期行為；管理員資料採私人離線匯入，詳見管理文件。

## 驗證

依次執行，不要並行啟動測試和型別檢查：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run worker:check
```

本機測試使用虛構資料與真實 SQLite adapter；遠端部署與真人帳號驗收狀態見進度文件。不可將本機通過等同遠端上線完成。

## 隱私与安全

- bcrypt cost 12、連續10次錯誤鎖定5分鐘、首次登入強制改密。
- jose Session；Cookie 為 Secure、HttpOnly、SameSite=Lax，30天滑動閒置期限。
- 伺服器逐次檢查身份與角色；改密、重設、停用及角色變更撤銷既有登入。
- 積分以百分之一分整數保存；請假備註只供本人與管理員存取。
- 不提交成員表、初始密碼、密碼雜湊、Session、匯出或密鑰；私人交付資料放在版本控制之外。
- 免費方案部署；沒有自動升級或付費服務設定。

## 授權

AGPL-3.0-only，詳見 [LICENSE](LICENSE)。舊原型曾參考 [Clunite.club](https://github.com/Omen-bit/Clunite.club) 的認證及角色分流概念，保留原有致謝。
