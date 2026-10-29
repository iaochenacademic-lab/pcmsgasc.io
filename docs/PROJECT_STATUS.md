# 專案狀態

更新：2026-10-13。正式名稱：**國際議題研習學會**。

## 第一版重建

現行程式已改為 React / Vite、Cloudflare Workers、D1 與每帳號 SQLite Durable Object。舊 Next.js / Supabase 原型已依使用者授權移除，仍可從 Git commit `24a9095` 查回。AGPL 授權及原有致謝保留。

已實作：

- Local Codex 全新米白、深藍與金色設計，學生及管理員介面、手機導覽及表單。
- 預建帳號、隨機初始密碼、強制改密、bcrypt 12、登入鎖定、加密 Cookie、角色授權及 Session 撤銷；沒有自助註冊。
- 課次、每30秒 QR／數字簽到碼、出勤／請假／分享、結課及快照。
- 活動詳情、管理員登記參與、比賽分數、撤回及原因審計；沒有站內報名。
- 整數積分流水、分數修正、含同分群組的紅黃門檻、截止快照、逐人決定、封存及新期歸零。
- 歷史紀錄、管理操作查閱及不含認證秘密的私人資料匯出。
- 私人帳號匯入與中斷恢復工具；重複匯入不覆寫密碼。

## 驗證與審查

詳細結果以 [重建進度](REBUILD_PROGRESS.md) 為準。已用虛構資料在本機 workerd / D1 / Account Durable Objects 完成245次 API 驗收，包括100人實際登入與簽到。

獨立審查提出三項問題：結課與取消競態、封存快照漏掉交錯寫入分數、前端誤以即時分數阻止歷史截止結算。均已修正，審查者複核關閉；新增相應 SQLite 回歸。修正後65項測試及全套檢查通過，第一版 [GitHub PR #3](https://github.com/iaochenacademic-lab/pcmsgasc.io/pull/3) 已通過遠端 CI 並合併至 main（decb4a9）；Code Review 外掛連線失敗的限制已記錄於進度文件。

2026-10-13 部署前再驗證：Windows 沙箱執行遇到 Vitest 暫存檔 ENOENT，55項通過、2個測試檔未載入；同一份程式在一般本機環境重跑65/65通過。隨後依序執行 typecheck、lint、build、worker:check 全部通過。已重新啟動本機 Worker 並在內建瀏覽器確認測試帳號首頁。

2026-10-29 本機預覽：重新執行 `npm run build` 成功；以 `.claude/launch.json` 的 `worker-local`（`wrangler dev --local --persist-to .wrangler/acceptance`）啟動本機 Worker，內建瀏覽器以虛構 qa-admin 登入，確認總覽、成員管理、積分排行榜頁面正常顯示；主控台僅有登入前 Session 檢查的預期 401。本次未重跑 test、typecheck、lint、worker:check，亦未變更遠端資源。

2026-10-29 設計與功能評估：使用者決定記錄於 [設計與功能評估](DESIGN_REVIEW.md)，分七批實作。第 1 批視覺改版（只動前端）已完成，尚未提交：依序執行 `npm test`（7 檔 65/65 通過）、`npm run typecheck` 通過、`npm run lint` 首次回報 1 項未使用變數，修正後通過，再重跑 typecheck 通過、`npm run build` 成功、`npm run worker:check` 成功。內建瀏覽器以虛構 qa-admin、qa-000 檢查桌面版總覽、課次、排行榜及手機版登入、首頁、簽到、排行榜；手機排行榜表格寬 341px 等於容器寬度，無橫向捲動。點名彈窗的必選狀態只經型別檢查，未在瀏覽器操作。評估時曾於本機 acceptance 資料建立並取消一筆虛構課次「簽到流程測試（虛構）」。

2026-10-29 第 2 批簽到簡化（未提交）：先改寫 `tests/club.test.ts` 簽到測試，3 項新測試在舊實作下失敗；改 `worker/club-classes.ts` 後 club 測試 29/29 通過。之後依序 `npm test`（7 檔 67/67）、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run worker:check` 全部通過。內建瀏覽器實測：建立並開啟虛構課次「整堂數字碼測試（虛構）」，草稿時取碼回 409；管理員視窗只顯示 6 位數字；qa-003 在取碼 35 秒後輸入錯碼得到「簽到碼不正確」提示，輸入正確碼簽到成功（出席）；取消該課次後簽到頁顯示「目前沒有開放簽到的課堂」。手機寬度版面已檢查。`qrcode` 與 `@types/qrcode` 已移除，package.json 維持原格式。

2026-10-29 第 3 批批量登記（未提交）：先新增 4 項 `tests/club.test.ts` 測試並確認失敗，實作後 club 測試 33/33。之後依序 `npm test`（7 檔 71/71，耗時約 115 秒；慢在既有的 100 人 cost-12 bcrypt 並發登入測試約 50 秒，本批未改認證程式，新測試各 4–8ms）、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run worker:check` 全部通過。內建瀏覽器實測：在虛構課次「批量登記測試（虛構）」勾選 3 人批量登記病假與備註成功，未登記人數由 99 變 96；在虛構比賽「批量參與測試（虛構）」以搜尋加全選一次登記 8 人各 3 分，再開名單時已登記者不再出現（測試同學003 為停用帳號，不在可選名單）。兩筆測試資料隨後取消，排行榜回到全員 0 分。

第 1–3 批已提交於本機分支 `claude/design-review-batches-1-3`（3330913），尚未推送。

2026-10-29 第 4 批課次管理（未提交）：新增 migration `0003_checkin_closed.sql`，已以 `wrangler d1 migrations apply club-db --local --persist-to .wrangler/acceptance` 套用到本機驗收資料庫；遠端尚未套用，部署前須先跑遠端 migration。先新增 2 項測試並確認失敗，實作後 club 測試 35/35。之後依序 `npm test`（7 檔 73/73）、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run worker:check` 全部通過。內建瀏覽器實測：管理員首頁與課次頁提醒「有 1 節課需要處理」（10-19 國際新聞研習已過期未開啟）；總表列出全部課次與已登記人數；虛構課次「提前結束簽到測試（虛構）」提前結束簽到後，學生簽到頁不再列出、強制送出回 409「老師已結束本課簽到」，重新開放後學生可見，審計各記一筆；該課次隨後取消。同時更正 OPERATIONS.md 中第 2 批遺留的 QR／30 秒說明。第 4 批已提交（3132f60）。

2026-10-29 第 5 批請假與隱私（未提交）：新增 migration `0004_leave_requests.sql`，已套用到本機驗收資料庫，遠端尚未套用。先新增 4 項測試並確認失敗，實作後 club 測試 39/39。之後依序 `npm test`（7 檔 77/77，約 112 秒，主要耗時仍為既有 bcrypt 並發登入測試）、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run worker:check` 全部通過。內建瀏覽器實測（虛構課次「請假流程測試（虛構）」，測後取消）：qa-004 在學生頁送出病假申請；管理員總覽提示「有 1 筆請假申請待審核」，於請假管理一鍵核准，名冊記為病假；以「登記請假」替 qa-005 登記公假；qa-004 再申請事假，管理員填說明退回，學生端看到退回說明；qa-005 只看到自己的紀錄，課次資料不含他人請假理由。排行榜待定標記的隱私由單元測試驗證（本機資料目前無分數，無待定可看）。

2026-10-29 第 6 批規則設定（未提交，第 5 批亦未提交）：新增 migration `0005_cycle_rules.sql`。首版以「建新表再改名」重建 events，本機 D1 回報 internal error 並整批回滾；在暫存複本逐句重現，確認 DROP 後改名無法清除延後外鍵計數，改為「備份表 → 刪除 → 以原名建表 → 插回資料」，複本與本機驗收資料庫皆套用成功，`PRAGMA foreign_key_check` 無結果，events 3 筆、participation 9 筆保留。套用前的本機資料庫備份存於工作階段暫存目錄。先新增 3 項測試並確認失敗，實作後 club 測試 42/42。之後依序 `npm test`（7 檔 80/80）、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run worker:check` 全部通過。內建瀏覽器實測：門檻與計分頁顯示 N 與五項分值，改 N=3、出席 1 分後儲存，API 回傳一致；學生簽到須知顯示「出席 +1 分」。測試後已把設定改回 N=2、出席 0.5，並取消暫時課次「計分顯示測試（虛構）」。遠端 D1 尚未套用 0003–0005。

2026-10-29 第 7 批 CSV 匯出（未提交）：先新增 1 項測試並確認失敗（另修正測試以保留 BOM 解碼：`Response.text()` 會去除 BOM），實作後 club 測試 43/43。之後依序 `npm test`（7 檔 81/81）、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run worker:check` 全部通過。內建瀏覽器以管理員身份在頁面內請求三種 CSV：皆 200、`text/csv; charset=utf-8`、開頭為 UTF-8 BOM，分別 99、6、16 筆資料列；頁面顯示三個下載按鈕與 JSON 備份。未在內建瀏覽器實際點擊下載以免在使用者電腦存檔，也未用 Excel 實際開啟。設計評估七批至此全部完成，第 5–7 批尚未提交。

## 尚未完成的正式上線

- 尚未建立或部署本次重建的遠端 Cloudflare 資源。
- 尚未執行遠端遷移、雲端效能／Cookie驗收、正式成員匯入或私人帳號表交付。
- 使用者已明確授權讀取 Cloudflare 帳戶及免費部署；先前的授權阻礙已解除。
- 已讀取唯一連接帳戶：Worker 與 D1 清單皆空，尚未建立 workers.dev 子網域。外掛讀取訂閱方案回報 Authentication error；本機 Wrangler 未登入，官方登入流程尚未完成。需完成登入及確認 Workers Free 後才進行遠端建立與部署。
- 本次未讀取真實成員表；68名學生及1名管理員是先前文件的核對紀錄，並非本次匯入成果。

本機測試通過不代表已正式上線。操作方式見 [管理、部署與回退](OPERATIONS.md)。
