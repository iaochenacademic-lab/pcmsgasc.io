# Codex 協作說明

## 現行架構

國際議題研習學會管理工具，React/TypeScript/Vite 前端、Cloudflare Workers API、D1、SQLite Durable Objects。開始前閱讀 README.md、docs/PROJECT_STATUS.md、docs/rebuild-plan.md、docs/REBUILD_PROGRESS.md，以實際程式和驗證紀錄為準。

舊 Next.js/Supabase 原型保留於 Git 歷史；2026-10-12 使用者明確批准第一版經 Code Review 後提交推送 GitHub，並清理 Git 歷史已保存的舊版檔案。其他任務仍不得在未獲授權時自行提交或推送。

## 安全邊界

- 無公開註冊，帳號由管理員預建；不得讀取或输出 `.env.local`、真實成員資料、真實密碼、密碼雜湊或憑證。
- `.env.local`、`.dev.vars*`、`.superpowers/`、`private/` 不提交、不清理。未明確要求時不讀取其內容。
- bcrypt cost 12；初始學生密碼逐人安全隨機生成、僅一次性交付、首次登入強制改密。來源 admin 密碼依批准的私人匯入流程保留。
- 10次登入失敗鎖5分鐘，並發操作透過每帳號 DO 與原子資料庫條件執行。
- jose Session，Cookie Secure/HttpOnly/SameSite=Lax；每次API在伺服器檢查身份、角色、帳號有效性及Session撤銷。
- 私人請假、備註僅本人與管理員；排行榜僅社內登入成員可見。
- 積分以百分之一分整數保存，修改需理由與操作者；結課、來源分數與快照保持原子性。
- 結算僅逐一處理固定快照，不自動連鎖停用其他成員。
- Cloudflare 只用免費方案，不自動升級。遠端資料變更與正式匯入需符合使用者授權。
- 不把 design/ 的展示數據及假操作當作正式產品功能。

## 協作與驗證

- 開始先檢查git status，保留已有未提交改動。資料、安全、認證變更先寫測試再實作。
- 不讀取 `.superpowers/`；執行進度記錄在 docs/REBUILD_PROGRESS.md。
- 每次完成更新 docs/PROJECT_STATUS.md，逐項記錄實際執行的驗證，未跑不得聲稱通過。
- 依次运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run worker:check`；不得並行啟動測試和型別檢查。
- 部署前另驗證本機Worker、D1 migrations、權限、Cookie、手機版及公開產物敏感資料掃描。
- 不將密碼、hash或憑證寫入審計與日誌；錯誤訊息不透露内部資料。
