# 帳號 API 契約

國際議題研習學會；同源 JSON API。所有寫入需 `Content-Type: application/json` 與同源 `Origin`。Cookie 由瀏覽器管理；前端使用 `credentials: 'same-origin'`。不設註冊 API。

`Actor`：`{ id, studentId, name, className, role: 'admin' | 'member', active, mustChangePassword, sessionVersion, joinedAt }`，時間為 Unix 毫秒。回應從不包含密碼雜湊。錯誤為 `{ error: string }`；401 未登入／登入失敗，403 權限不足／須先改密，409 學號重複，429 暫時鎖定，400 輸入無效。

| 方法與路徑 | JSON 輸入 | 成功 JSON |
| --- | --- | --- |
| `POST /api/auth/login` | `{ studentId, password }` | `{ user: Actor }` |
| `POST /api/auth/logout` | `{}` | `{ ok: true }`；撤銷目前 Session |
| `GET /api/auth/me` | 無 | `{ user: Actor }` |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword }` | `{ user: Actor }`；撤銷舊 Session 並建立新 Session |
| `GET /api/admin/members` | 無 | `{ members: Actor[] }` |
| `POST /api/admin/members` | `{ studentId, name, className, role?: 'member'|'admin', joinedAt?: number }` | HTTP 201 `{ member: Actor, initialPassword: string }` |
| `PATCH /api/admin/members/:id` | `{ name?, className?, role?, active? }` | `{ member: Actor }` |
| `POST /api/admin/members/:id/reset-password` | `{}` | `{ member: Actor, initialPassword: string }` |

學生首次登入只能呼叫 me、logout、change-password；所有社團功能及管理功能均禁止。前端收到 `mustChangePassword: true` 必須轉到改密畫面。管理員建立或重設的隨機初始密碼只在該次回應交付，不提供查回介面；重設後再次強制改密。

學號為 1–64 個英數字、`.`、`_` 或 `-`，不可修改；姓名 1–80 字、班別最多 40 字。新增管理員允許空班別。新密碼至少 12 個字元且 UTF-8 最多 72 bytes，允許空白及中文；登入現存密碼不追溯套用最少長度。連續 10 次錯誤鎖定 5 分鐘，成功登入清零；停用、改密、重設及角色更改撤銷既有 Session。不得停用或降級最後一位有效管理員。

Cookie 為 `__Host-club_session`，`Secure; HttpOnly; SameSite=Lax; Path=/`，30 天閒置期限。每次已驗證 API 請求重新檢查 D1 帳號與 Session，並在回應時更新期限；被撤銷、過期、停用的 Session 不續期。API 回應須由入口設定 `Cache-Control: no-store`。

資料匯入使用維護者的本機脚本連接 Cloudflare D1，沒有公開匯入或初始管理員建立路由。正式資料及一次性交付檔必須保存在受控私人位置，禁止加入版本控制。腳本保留來源管理員密碼，學生逐一產生隨機初始密碼，重複學號不更新既有密碼。

## 私人匯入程序

`scripts/import-accounts.ts` 只在明確帶入 `--remote` 時寫入指定 D1。執行前必須完成目標資料庫 migration，確認目標是已批准的環境，並在維護者終端環境設定具有該 D1 寫入權限的 `CLOUDFLARE_API_TOKEN`；不要將 token 放入命令列、原始碼或輸出文件。此腳本不載入 `.env.local`。

可先執行 `node --import tsx scripts/import-accounts.ts --help` 查看參數；此模式不讀取來源檔案、環境中的憑證或遠端資料。

來源 JSON 是陣列，每筆有 `studentId`、`name`、`className`、`role`（`admin` 或 `member`），可加 `joinedAt`（Unix 毫秒）。管理員需在私人來源檔內提供 `password`，會保留該密碼並以 bcrypt cost 12 儲存；學生初始密碼由腳本產生，來源中的學生密碼不會使用。管理員保留來源密碼且不強制首次改密；學生必須首次改密。

命令中的路徑為維護者自行指定的私人檔案，來源與輸出均必須在本專案目錄之外：

```powershell
node --import tsx scripts/import-accounts.ts --remote --account-id ACCOUNT_ID --database-id DATABASE_ID --input C:\Private\accounts.json --output C:\Private\initial-accounts.jsonl
```

輸出檔使用排他建立，拒絕覆寫既有交付檔。POSIX 設為 0600；Windows 應先限制私人目錄 ACL，只讓受信任維護者存取。終端只顯示新增／略過筆數，不顯示學號、姓名、密碼、雜湊、SQL 或 API 錯誤內容。輸出檔本身是含密碼的私人交付文件，不得作為公開日誌、部署資源或 Git 檔案。

每筆輸出先保存 `type: credential`（狀態 `pending`）；資料庫確認後追加 `type: result`。以同一 `id` 的最後 result 為準，**只有 `created` 的學生資料可交付**；`skipped` 和 `pending` 不可分發。管理員輸出不重複包含來源密碼。資料庫使用 `ON CONFLICT(student_id) DO NOTHING`，即使另一個匯入同時插入，也不覆寫現有密碼。

若網路中斷，保留該私人交付檔，執行以下唯讀核對（只會追加本機確認結果）：

```powershell
node --import tsx scripts/import-accounts.ts --remote --account-id ACCOUNT_ID --database-id DATABASE_ID --output C:\Private\initial-accounts.jsonl --recover
```

恢復流程以私有交付檔的隨機帳號 ID 與 D1 比對，確認 `pending` 到底已新增或應略過；不查詢密碼雜湊、不重設密碼。若仍有未插入成員，之後使用新輸出檔重新匯入，已存在學號會直接略過。交付完成後，由維護者依校內保存政策處理含密碼的私人來源與輸出文件。

## 實作與驗證邊界

- `members` 與 `auth_sessions` 由 D1 保存。每學號一個 SQLite Durable Object 保存固定路由身份，在 DO 內執行 bcrypt；D1 條件更新保護外部結算停用和版本變更。
- 改密、重設、停用及角色變更撤銷 Session；角色／有效狀態每次讀取資料庫現況。最後一位有效管理員由資料庫 trigger 保護。
- 帳號操作紀錄為 `account_audit`，只含操作者、目標、動作和時間，沒有密碼或雜湊。登入資料不写入操作紀錄。
- 已於本機以真實 SQLite、bcrypt 與 jose 驗證核心及 HTTP 行為；Cloudflare 上的實際執行、集中登入負載與正式私人資料匯入需另行驗證，不能由單元測試結果推定已完成。

平台參考：[Durable Object RPC 與基底類別](https://developers.cloudflare.com/durable-objects/api/base/)、[D1 資料庫與批次交易](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[維護者 D1 查詢 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)。
