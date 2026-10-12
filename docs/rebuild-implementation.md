# 國際議題研習學會重建實作計畫

> 執行：依已批准規格直接實作；獨立模組分工，整合後統一審查。規格：`docs/rebuild-plan.md`。

**目標：** 建立可部署於免費 Cloudflare Workers 的社團管理網站，交付新設計、可測試的功能、管理文件及部署程序。

**架構：** React/Vite 介面使用同源 `/api`；Worker 驗證每次身份與角色，D1 保存業務資料。每帳號的 SQLite Durable Object 負責 bcrypt 與登入並發控制。所有積分以百分之一分整數保存。

## 全域限制

- 不讀取 `.env.local`、`.superpowers/`、真實成員或密碼。生成設計與測試只用虛構資料。
- 無公開註冊；bcrypt 12；10 次失敗鎖定 5 分鐘；30 天閒置期限及強制首次改密。
- Cookie Secure / HttpOnly / SameSite=Lax；停用及改密撤銷其他登入；所有寫操作要求同源。
- 不自動升級付費；正式資料匯入前必須通過功能、安全與並發驗證。
- 保留舊原型和 AGPL 歷史；目前僅有兩份未追蹤重建文件，均保留。
- 使用者於 2026-10-12 明確授權第一版經 Code Review 後提交推送 GitHub，並刪除已保留於 Git 歷史的舊版程式；目前使用既有 `codex/rebuild-club` 分支。

## 檔案與介面

- `web/`：React 介面與 Local Codex 設計整合。
- `worker/index.ts`：HTTP、同源防護、API 分流、錯誤與安全標頭。
- `worker/auth.ts`、`worker/account.ts`：身份、Session、密碼與帳號管理。
- `worker/business.ts`、`shared/domain.ts`：課次、活動、積分、排名、週期與審計。
- `worker/env.ts`：共用 binding 與 Actor 型別。
- `migrations/0001_accounts.sql`、`migrations/0002_club.sql`：分別由帳號及業務模組維護。
- `tests/`：規則、HTTP、真實 SQLite 資料及 runtime 整合測試。
- `docs/REBUILD_PROGRESS.md`：執行紀錄，不使用受保護的本機技能資料夾。

Actor：`{ id, studentId, name, className, role: 'admin'|'member', active: boolean, mustChangePassword: boolean, sessionVersion: number, joinedAt: number }`。

共用 bindings：`DB: D1Database`、`AUTH: DurableObjectNamespace<Account>`、`ASSETS: Fetcher`、`SESSION_SECRET: string`、`CHECKIN_SECRET: string`。

帳號模組：`handleAuth(request, env, path): Promise<Response|null>`；`requireActor(request, env, allowMustChange?): Promise<Actor>`；`refreshCookie(request, env, response): Promise<Response>`。

業務模組：`handleBusiness(request, env, actor, path): Promise<Response|null>`。所有身份由入口提供，模組仍檢查管理員角色。各自回傳可理解的 JSON 錯誤。

## 任務

### 1. 新設計與可執行底座

- [x] Local Codex 全新專案完成，取得完整設計來源並校正正式名稱。
- [x] 建立 Vite/Workers 本機建置與 sequential 測試命令；舊原型保留在 Git 歷史。
- [x] 桌面及手機檢查登入、導航、表格、表單、空狀態。

### 2. 帳號與身份（獨立模組）

- [x] 先測試未知帳號、鎖定邊界、並發登入、Session 撤銷、首次改密與越權。
- [x] 實作 D1 帳號 migration、每帳號 DO bcrypt 12、jose Cookie、管理帳號 API。
- [x] 重複匯入不覆寫密碼；隨機初始密碼僅一次回傳，審計不含秘密。
- [x] 測試從紅轉綠，回報實際命令與結果。

### 3. 社團業務（獨立模組）

- [x] 先測試 12:55 邊界、重複/過期簽到、出席+分享=250、遲到+分享=100、取消無扣分。
- [x] 實作課次、請假補登、結課、活動參與與更正、積分來源及审計。
- [x] 測試同分紅線、無記錄不警示、門檻重疊、截止快照、逐人決定、封存新期歸零。
- [x] 實作排行榜快照、週期設定、資料匯出；原子操作防止重複計分。

### 4. 設計整合與端到端流程

- [x] React 串接真實 API，學生與管理員功能依伺服器授權顯示。
- [x] 設計稿與獨立本機測試使用虛構資料；正式程式不內建展示帳號或假成功。
- [x] 完成 QR、數字碼、積分紀錄、活動詳情、管理表單、門檻與封存流程。

### 5. 驗收、部署準備與交付

- [x] 依次跑測試、型別、lint、build、Worker dry run、runtime 冒煙及敏感資料掃描。
- [x] 獨立審查安全與需求，修正重大問題後重驗相關測試。
- [ ] 驗證免費 Cloudflare 權限與部署；帳戶讀取遭自動審核拒絕，待明確授權。
- [x] 更新 README、PROJECT_STATUS、REBUILD_PROGRESS、管理與回退說明。

## 審查重點

1. 同時登入及停用/重設密碼：不得再簽發有效舊 Session。
2. 結課與重複請求同時發生：不漏分、不重複、快照一致。
3. 多位學生同分：紅線包含整個群組，管理決定不連鎖。
4. 非本人讀取請假或備註：拒絕，排行榜僅公開社內所需欄位。
5. 封存後更正或重送舊請求：拒絕改動封存資料，新期獨立。

## 執行決定

- 2026-10-12：正式名稱由使用者修正為「國際議題研習學會」。已在生成中的設計會於完成後同步修正文案。
- 2026-10-12：按已批准需求直接執行，不再重啟需求訪談。舊原型不再代表新系統狀態。
