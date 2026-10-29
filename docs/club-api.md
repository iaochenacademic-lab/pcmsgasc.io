# 社團業務 API 契約

所有時間為 Unix 毫秒；分數為百分之一分整數（50 = 0.5 分）。日期欄位 `date` 用 `YYYY-MM-DD`，時間 `HH:mm`，以 UTC+8 解讀。伺服器驗證管理員、有效帳號及首次改密。寫操作由入口檢查同源。錯誤為 `{error: string}`。

所有列表回傳命名屬性，可加 `?cycleId=...` 查封存週期；省略則當期。封存週期唯讀。以下欄位採 camelCase。

所有出勤`shared`與參與`active`欄位（含寫入後回傳、個人／管理列表、詳情、首頁與匯出）均為JSON布林值`true`/`false`，不回傳資料庫整數0/1。不存在的個人紀錄回傳`null`。

## 學生與共用

- `GET /api/overview` → `{cycle, stats:{score,rank,memberCount,classCount,eventCount}, nextClass, recentLedger, rankings}`。`rankings` 同排行榜內容。
- `GET /api/cycles` → `{cycles:[{id,name,status,createdAt,archivedAt,redMode,redScore,yellowScore,cutoffAt}]}`。
- `GET /api/classes` → `{classes:[{id,cycleId,title,date,opensAt,lateAt,closesAt,status,openedAt,closedAt,myAttendance}]}`。`myAttendance` 僅本人 `{status,shared,note,checkedInAt}`；管理員另外讀取出勤明細。
- `GET /api/events` → `{events:[{id,cycleId,title,kind,description,location,startsAt,endsAt,points,status,myParticipation}]}`，kind=`lecture|visit|spectating|competition`，status=`published|cancelled`。非比賽固定 50 分。
- `GET /api/events/:id` → `{event}`；myParticipation 僅本人 `{points,result,note,active}`。
- `POST /api/checkin` `{classId,code}` → `{attendance,alreadyCheckedIn}`。code 必須為 6 位數字；每課一組，開啟簽到後整個窗口內有效。只有已開啟且窗口內可簽到，12:55（可修改）起遲到。重複簽到不覆寫既有狀態。每位學生每課最多 10 次提交（含成功），不隨時間重置，超出回傳 429，需由管理員補登。
- `GET /api/ledger` → `{ledger:[{id,cycleId,memberId,sourceType,sourceId,delta,reason,createdAt}],score}`。學生只取得本人，管理員可加 `memberId` 查指定學生。
- `GET /api/rankings` → `{cycle,rows:[{memberId,name,className,score,rank,tieGroup,pending,qualified}],redScore,yellowScore,hasScores,overlap,snapshots:[{id,kind,classId,createdAt,cutoffAt}]}`。無計分不提示待定；同分同名次。`?snapshotId=...` 讀固定快照，固定快照不隨停用改變。公開欄位不含學號、請假、備註。

## 管理課次

- `GET /api/admin/classes` 同 classes，另每課帶 `attendance:[{memberId,name,className,status,shared,note,checkedInAt}]`。
- `POST /api/admin/classes` `{title,date,openTime?:'12:45',lateTime?:'12:55',closeTime?:'13:10'}` → `{class}`，初始 draft。
- `PATCH /api/admin/classes/:id` `{title?,date?,openTime?,lateTime?,closeTime?,status?:'open'|'cancelled',reason}` → `{class}`。時間只能在草稿改；取消可撤回已發布分數並留下紀錄。
- `GET /api/admin/classes/:id/code` → `{code,classId,opensAt,lateAt,closesAt}`。僅已開啟課次可取得，否則 409。code 由 CHECKIN_SECRET 對課次編號與開啟時間做 HMAC 導出，同一次開啟內不變；不提供 QR。
- `PUT /api/admin/classes/:id/attendance` `{memberId,status,shared?:boolean,note?:string,reason}` → `{attendance}`。status=`present|late|absent|official_leave|sick_leave|personal_leave`。每次完整替換該學生狀態，可更正已結課項目；修改已發布分數會產生新排行快照。
- 批量：同一路徑改傳 `{memberIds:string[],status,note?:string,reason}` → `{updated}`。1–200 位、重複自動去除；任一成員不存在、非學生或加入晚於該課則整批拒絕。只改出勤狀態，不改已登記的分享；未傳 note 時保留原備註。已結課則同批重發分數與快照。每人各寫一筆審計。
- `POST /api/admin/classes/:id/close` `{reason}` → `{class,snapshotId}`。僅已開啟可結课；自動補當時已加入且在籍學生缺席，發布分數及快照，重送不重複。

## 管理活動與分數

- `GET /api/admin/events` 同 events，各項含 `participants:[{memberId,name,className,points,result,note,active}]`。
- `POST /api/admin/events` `{title,kind,description?,location?,startsAt,endsAt?,points?}` → `{event}`。
- `PATCH /api/admin/events/:id` `{title?,description?,location?,startsAt?,endsAt?,status?:'cancelled',reason}` → `{event}`。取消撤回所有參與分數。
- `PUT /api/admin/events/:id/participants` `{memberId,active:boolean,points?:number,result?:string,note?:string,reason}` → `{participation}`。非比賽固定50，比賽可逐人自定；active=false撤回且保留歷史。
- 批量：同一路徑改傳 `{memberIds:string[],points?:number,reason}` → `{added}`。只新增未登記或已撤銷的成員，已登記者的分數、成績與備註不變，也不寫審計；比賽用統一 points，其他類別固定 0.5 分。活動已取消回傳 409。
- `POST /api/admin/adjustments` `{memberId,points,reason,idempotencyKey}` → `{ok:true}`。points為有正負的整數分，idempotencyKey 使用 `crypto.randomUUID()`，網路重送沿用同一值。

## 設定、結算、封存與審計

- `GET /api/admin/settings` → `{cycle}`。
- `PATCH /api/admin/settings` `{redMode?:'automatic'|'manual',redScore?:number|null,yellowScore?:number|null,cutoffAt?:number|null,reason}` → `{cycle}`。手動紅線須填分數。重疊仍可保存但禁止結算，畫面提示修正。
- `POST /api/admin/settlement` `{reason}` → `{snapshotId}`。必須設定已到達的截止時間，按截止時間已發布的流水計分，重複相同截止不另建快照；紅黃重疊或無計分時拒絕。
- `GET /api/admin/settlement` → `{snapshots:[{id,cycleId,createdAt,cutoffAt,redScore,yellowScore,rows:[ranking row + decision?:'retain'|'eliminate',decisionReason?:string,decidedAt?:number]}]}`。
- `POST /api/admin/settlement/:snapshotId/decisions` `{memberId,decision:'retain'|'eliminate',reason}` → `{ok:true}`。僅固定待定群組逐人決定，決定一次；eliminate停用並撤銷session，不連鎖下一人。
- `POST /api/admin/cycles` `{name,reason}` → `{cycle}`。原子封存當期及新建週期，全部分數重新由0開始。
- `GET /api/admin/audit` → `{audit:[{id,actorId,action,targetId,reason,createdAt}]}`，最近500筆，合併週期業務與該週期時間內的帳號操作；帳號操作action前綴為`account.`。
- `GET /api/admin/export?cycleId=...` → JSON `{exportedAt,cycle,members,classes,attendance,events,participation,ledger,snapshots,decisions,audit,accountAudit}`，提供附件下載。成員使用明確白名單欄位，無密碼/hash/session等認證秘密。帳號操作類別（如重設密碼）僅是事件名稱，不含憑證。匯出含請假備註，僅管理員可用。匯出資料列保留資料庫snake_case欄名。

## 原子性與截止解釋

結課填補缺席、發布來源分數、更新不可變流水及保存快照，均在同一 D1 batch 交易完成。簽到唯一键為 `(class_id,member_id)`。結課與封存快照使用交易內的完整當前來源，包含請求開始後、交易執行前提交的計分；只有資格結算快照按`cutoffAt`過濾歷史流水。截止後修正保留在當前積分但不改既定截止快照。封存前應完成資料校對；封存不刪除任何紀錄。課次與活動的條件狀態更新若因其他操作先完成而失敗，不會寫成功操作紀錄、撤分或新增快照。

有效計分與分數是否非零分開判斷：已發布且有效的課次（含請假0分或出勤與分享相抵）是有效來源；取消課次、撤回參與則不算有效來源。來源狀態和分數差額一起留在流水中，截止快照依截止當時的最後狀態判斷。
