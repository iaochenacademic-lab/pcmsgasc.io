const STUDENT_NAV = [
  ["dashboard", "本期首頁"],
  ["checkin", "課堂簽到"],
  ["events", "活動一覽"],
  ["record", "我的紀錄"],
  ["leaderboard", "積分排行榜"],
  ["account", "帳號設定"],
  ["credits", "開發致謝"]
];

const ADMIN_NAV = [
  ["overview", "管理總覽"],
  ["members", "成員管理"],
  ["sessions", "課次與點名"],
  ["activities", "活動管理"],
  ["adjustments", "分數修正"],
  ["thresholds", "門檻設定"],
  ["decisions", "截止待審"],
  ["archives", "封存與新期"],
  ["logs", "操作紀錄"]
];

function readStored(key, fallback) {
  try { return window.localStorage.getItem(key) || fallback; }
  catch { return fallback; }
}

function writeStored(key, value) {
  try { window.localStorage.setItem(key, value); }
  catch {}
}

const state = {
  role: readStored("irss-role", "student"),
  page: readStored("irss-page", "dashboard"),
  checkin: "idle",
  qrSeconds: 18,
  sessionOpen: true,
  selectedEvent: "lecture",
  memberQuery: "",
  thresholdMode: "auto"
};

const demoMembers = [
  ["S260017", "林知遠", "一年甲班", "18.5", "啟用"],
  ["S260024", "陳雅文", "一年乙班", "16.0", "啟用"],
  ["S260031", "周以安", "二年甲班", "12.5", "啟用"],
  ["S260042", "黃思齊", "二年乙班", "10.0", "停用"],
  ["S260058", "許晴川", "一年甲班", "8.5", "啟用"]
];

const qrCells = Array.from({ length: 81 }, (_, index) => `<i style="${[0, 1, 7, 8, 9, 17, 18, 26, 54, 62, 63, 71, 72, 73, 79, 80].includes(index) ? "background:var(--fg)" : ""}"></i>`).join("");

const pageMeta = {
  dashboard: ["student / term 02", "本期首頁"], checkin: ["attendance", "課堂簽到"], events: ["programme", "活動一覽"],
  record: ["personal record", "我的紀錄"], leaderboard: ["ranking", "積分排行榜"], account: ["account", "帳號設定"], credits: ["acknowledgements", "開發致謝"],
  overview: ["admin / term 02", "管理總覽"], members: ["directory", "成員管理"], sessions: ["attendance ops", "課次與點名"],
  activities: ["programme ops", "活動管理"], adjustments: ["score ledger", "分數修正"], thresholds: ["thresholds", "門檻設定"],
  decisions: ["review snapshot", "截止待審"], archives: ["term archive", "封存與新期"], logs: ["audit & export", "操作紀錄"]
};

const el = (selector) => document.querySelector(selector);
const navForRole = () => state.role === "student" ? STUDENT_NAV : ADMIN_NAV;
const tag = (text, kind = "outline") => `<span class="tag tag-${kind}">${text}</span>`;
const pageHead = (index, kicker, title, description, actions = "") => `
  <header class="page-head" data-od-id="page-heading-${state.page}">
    <div><span class="eyebrow">${kicker}</span><h1>${title}</h1>${description ? `<p>${description}</p>` : ""}</div>
    <div class="page-index">${index}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}
  </header>`;

function renderShell() {
  const valid = navForRole().some(([id]) => id === state.page);
  if (!valid) state.page = state.role === "student" ? "dashboard" : "overview";
  renderRoleSwitch();
  renderNavigation();
  const [kicker, title] = pageMeta[state.page];
  el("#section-kicker").textContent = kicker;
  el("#section-title").textContent = title;
  el("#main-content").innerHTML = pages[state.page]();
  writeStored("irss-role", state.role);
  writeStored("irss-page", state.page);
  bindPageInputs();
}

function renderRoleSwitch() {
  el("#desktop-role").innerHTML = `
    <button type="button" data-action="role" data-role="student" data-od-id="role-student" aria-pressed="${state.role === "student"}">學生視角</button>
    <button type="button" data-action="role" data-role="admin" data-od-id="role-admin" aria-pressed="${state.role === "admin"}">管理員</button>`;
}

function renderNavigation() {
  const items = navForRole();
  el("#desktop-nav").innerHTML = items.map(([id, label], index) => `
    <button class="nav-button" type="button" data-action="navigate" data-page="${id}" data-od-id="desktop-nav-${id}" aria-current="${state.page === id ? "page" : "false"}">
      <span class="nav-number">${String(index + 1).padStart(2, "0")}</span><span>${label}</span>
    </button>`).join("");
  const mobileItems = items.slice(0, 4);
  el("#mobile-nav").innerHTML = mobileItems.map(([id, label], index) => `
    <button type="button" data-action="navigate" data-page="${id}" data-od-id="mobile-nav-${id}" data-index="${String(index + 1).padStart(2, "0")}" aria-current="${state.page === id ? "page" : "false"}">${label.replace("管理", "").replace("本期", "")}</button>`).join("") +
    `<button type="button" data-action="open-menu" data-od-id="mobile-nav-more" data-index="··" aria-current="${mobileItems.some(([id]) => id === state.page) ? "false" : "page"}">更多</button>`;
}

const studentDashboard = () => `
  <section class="dashboard-grid" data-od-id="student-dashboard">
    <div class="stack">
      <article class="card card-dark hero-panel" data-od-id="student-welcome">
        <span class="eyebrow">2026 春季學期 · 第 6 週</span>
        <h1>午安，林知遠。<br>從世界的脈絡，讀懂此刻。</h1>
        <p>下一堂研習將討論「國際組織的合法性」。請於 12:45 後完成簽到。</p>
        <div class="hero-meta"><div><span>today</span><strong>04.16 · 週四</strong></div><div><span>room</span><strong>人文館 203</strong></div><div><span>session</span><strong>第六課</strong></div></div>
      </article>
      <div class="grid grid-3" data-od-id="student-key-metrics">
        <article class="card metric"><span class="metric-label">本期積分</span><strong class="metric-value">18.5</strong><span class="metric-delta">較上週增加 2.5 分</span></article>
        <article class="card metric"><span class="metric-label">目前排名</span><strong class="metric-value">03</strong><span class="metric-delta">與第 2 名相差 1.0 分</span></article>
        <article class="card metric"><span class="metric-label">出勤狀態</span><strong class="metric-value">5/6</strong><span class="metric-delta">4 出席 · 1 遲到 · 1 公假</span></article>
      </div>
      <article class="card" data-od-id="today-session-card">
        <div class="section-heading"><div><span class="eyebrow">today's seminar</span><h2>今日課堂</h2></div>${tag("12:45 開放", "success")}</div>
        <div class="grid grid-2"><div><h3>國際組織的合法性</h3><p class="muted">以聯合國安理會改革為核心，閱讀制度代表性與效率之間的張力。</p></div><div class="notice"><strong>點名時段</strong>12:45–13:10；12:55 起登記為遲到。分享加分可與出勤分數相加。</div></div>
        <div class="page-actions" style="margin-top:20px"><button class="button button-primary" type="button" data-action="navigate" data-page="checkin">前往課堂簽到</button><button class="button button-quiet" type="button" data-action="show-toast" data-message="課綱已加入展示下載清單">查看本課綱要</button></div>
      </article>
    </div>
    <aside class="stack">
      <article class="card" data-od-id="recent-points-card">
        <div class="section-heading"><div><span class="eyebrow">recent points</span><h2>最近積分</h2></div><button class="link-button" type="button" data-action="navigate" data-page="record">全部</button></div>
        <ul class="list">
          <li class="list-row"><span class="date-block"><b>10</b>APR</span><span class="list-main"><strong>課堂分享</strong><span>區域整合的政治代價</span></span><span class="score-plus">+2.0</span></li>
          <li class="list-row"><span class="date-block"><b>10</b>APR</span><span class="list-main"><strong>準時出席</strong><span>第五課</span></span><span class="score-plus">+0.5</span></li>
          <li class="list-row"><span class="date-block"><b>03</b>APR</span><span class="list-main"><strong>遲到</strong><span>第四課 · 12:58</span></span><span class="score-minus">−1.0</span></li>
        </ul>
      </article>
      <article class="card" data-od-id="upcoming-events-card">
        <div class="section-heading"><div><span class="eyebrow">calendar</span><h2>即將活動</h2></div></div>
        <ul class="list">
          <li class="list-row"><span class="date-block"><b>24</b>APR</span><span class="list-main"><strong>外交現場講座</strong><span>人文館演講廳</span></span>${tag("講座", "outline")}</li>
          <li class="list-row"><span class="date-block"><b>08</b>MAY</span><span class="list-main"><strong>港口治理參訪</strong><span>校外集合</span></span>${tag("參觀", "outline")}</li>
        </ul>
      </article>
      <article class="card card-plain"><p class="muted">排行榜門檻每週更新一次；請假類別與備註僅你本人與管理員可見。</p></article>
    </aside>
  </section>`;

function checkinPage() {
  const status = state.checkin === "success"
    ? `<div class="notice notice-success"><strong>簽到成功 · 12:49</strong>本課出席 +0.5 分。若管理員更改紀錄，將顯示於「我的紀錄」。</div>`
    : state.checkin === "closed"
      ? `<div class="notice notice-error"><strong>簽到尚未開啟</strong>本課簽到將於 12:45 開放；請勿重複輸入非本課代碼。</div>`
      : `<div class="notice"><strong>輸入教室螢幕上的 6 位數碼</strong>QR 碼每 30 秒更新；若掃描未成功，可改用數字碼。</div>`;
  return `${pageHead("02 / 07", "attendance", "課堂簽到", "點名窗口 12:45–13:10；12:55 起完成的紀錄標示為遲到。")}
    <div class="grid grid-2" data-od-id="checkin-workspace">
      <section class="card"><span class="eyebrow">session 06</span><h2 style="margin-top:8px">國際組織的合法性</h2><p class="muted">04 月 16 日 · 人文館 203 · 指導老師：謝老師</p>
        <div style="margin:22px 0">${status}</div>
        <form id="checkin-form" class="field"><label for="checkin-code">6 位數碼</label><input id="checkin-code" class="input code-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" placeholder="000000" aria-describedby="checkin-help"><small id="checkin-help">展示有效碼為 482731</small><span id="checkin-error" class="field-error" hidden></span><button class="button button-primary" type="submit">確認簽到</button></form>
        <div class="divider-label">狀態預覽</div><div class="page-actions"><button class="button" type="button" data-action="checkin-state" data-state="success">成功</button><button class="button" type="button" data-action="checkin-state" data-state="closed">未開啟</button><button class="button button-quiet" type="button" data-action="checkin-state" data-state="idle">重設</button></div>
      </section>
      <aside class="card" style="text-align:center"><span class="eyebrow">rotating qr</span><div class="qr-box" aria-label="展示 QR 圖樣">${qrCells}</div><strong>QR 將於 <span id="qr-countdown">${state.qrSeconds}</span> 秒後更新</strong><p class="muted">QR 僅作介面展示，不包含真實簽到連結。請使用裝置相機掃描管理員投放畫面。</p></aside>
    </div>`;
}

const eventData = {
  lecture: { title: "外交現場：從談判桌到政策現場", type: "講座", date: "2026.04.24 · 18:30–20:10", place: "人文館演講廳", score: "+0.5", intro: "從多邊談判案例拆解議題設定、非正式協商與文本形成。", note: "參與名單由管理員於活動後登記；學生端不提供站內報名。" },
  visit: { title: "港口治理與區域安全參訪", type: "參觀", date: "2026.05.08 · 09:00–15:30", place: "校門集合 · 校外參訪", score: "+0.5", intro: "觀察跨境物流、港口治理與安全議題如何在實務現場交織。", note: "集合與保險資料由社團幹部另行通知。" },
  match: { title: "校際國際議題辯論交流賽", type: "比賽", date: "2026.05.23 · 10:00–17:00", place: "綜合大樓 4 樓", score: "另訂", intro: "以制度改革與國際責任為題，進行三輪交流賽。", note: "比賽成績由管理員依賽制指定，不採固定加分。" }
};

function eventsPage() {
  const event = eventData[state.selectedEvent];
  return `${pageHead("03 / 07", "programme", "活動一覽", "活動參與由管理員登記；此處僅提供已發布資訊與個人參與狀態。")}
    <div class="grid grid-3" data-od-id="event-cards">${Object.entries(eventData).map(([id, item], index) => `<article class="card" data-od-id="event-card-${id}"><span class="eyebrow">0${index + 1} / ${item.type}</span><h2 style="margin-top:12px">${item.title}</h2><p class="muted">${item.date}<br>${item.place}</p><button class="button ${state.selectedEvent === id ? "button-primary" : ""}" type="button" data-action="select-event" data-event="${id}">查看詳情</button></article>`).join("")}</div>
    <section class="card" style="margin-top:20px" data-od-id="event-detail"><div class="grid grid-2"><div><span class="eyebrow">selected event / ${event.type}</span><h2 style="margin-top:10px">${event.title}</h2><p>${event.intro}</p><div class="notice"><strong>參與方式</strong>${event.note}</div></div><div><ul class="list"><li class="list-row"><span class="muted">日期</span><strong class="list-main">${event.date}</strong></li><li class="list-row"><span class="muted">地點</span><strong class="list-main">${event.place}</strong></li><li class="list-row"><span class="muted">積分</span><strong class="list-main">${event.score}</strong></li><li class="list-row"><span class="muted">我的狀態</span><span>${tag("尚無紀錄", "outline")}</span></li></ul></div></div></section>`;
}

const recordPage = () => `${pageHead("04 / 07", "personal record", "我的活動與積分", "本頁彙整課堂出勤、分享與活動積分；請假細節僅你本人與管理員可見。")}
  <div class="grid grid-3"><article class="card metric"><span class="metric-label">本期總分</span><strong class="metric-value">18.5</strong><span class="metric-delta">已發布 11 筆紀錄</span></article><article class="card metric"><span class="metric-label">課堂積分</span><strong class="metric-value">14.0</strong><span class="metric-delta">含 4 次分享</span></article><article class="card metric"><span class="metric-label">活動積分</span><strong class="metric-value">4.5</strong><span class="metric-delta">講座 5 · 參觀 4</span></article></div>
  <div class="section-heading"><div><span class="eyebrow">ledger</span><h2>積分明細</h2></div><p>最近更新：2026.04.10 16:20</p></div>
  <div class="table-wrap" data-od-id="personal-score-table"><table><thead><tr><th>日期</th><th>類別</th><th>項目</th><th>狀態／備註</th><th>分數</th></tr></thead><tbody>
    <tr><td>04.10</td><td>課堂</td><td>第五課 · 分享</td><td>${tag("每課一次", "success")}</td><td class="score-plus">+2.0</td></tr>
    <tr><td>04.10</td><td>出勤</td><td>第五課</td><td>出席 · 12:48</td><td class="score-plus">+0.5</td></tr>
    <tr><td>04.03</td><td>出勤</td><td>第四課</td><td>遲到 · 12:58</td><td class="score-minus">−1.0</td></tr>
    <tr><td>03.27</td><td>請假</td><td>第三課</td><td>${tag("公假", "outline")} <span class="muted">校隊集訓（私人）</span></td><td class="score-neutral">0</td></tr>
    <tr><td>03.20</td><td>活動</td><td>區域研究講座</td><td>${tag("已登記", "success")}</td><td class="score-plus">+0.5</td></tr>
  </tbody></table></div>`;

const leaderboardPage = () => `${pageHead("05 / 07", "ranking", "積分排行榜", "排名採實名與班別顯示；同分者為同一名次群組。無有效紀錄者不列入門檻警示。")}
  <div class="grid grid-2"><article class="card"><span class="eyebrow">your position</span><div class="callout-number">03</div><h2>林知遠 · 18.5 分</h2><p class="muted">一年甲班 · 與前一名相差 1.0 分</p></article><article class="card"><h2>門檻說明</h2><p><span class="tag tag-danger">紅線 · 8.5 分</span> 倒數第二分數，包含同分者，尚待截止快照確認。</p><p><span class="tag tag-warning">黃線 · 15 分</span> 達標者免面試；本期為展示設定。</p></article></div>
  <div class="section-heading"><div><span class="eyebrow">live table</span><h2>本期名次</h2></div><p>共 24 位有效成員</p></div>
  <div class="table-wrap" data-od-id="leaderboard-table"><table><thead><tr><th>名次</th><th>姓名</th><th>班別</th><th>分數</th><th>備註</th></tr></thead><tbody>
    <tr><td class="rank">01</td><td>張允衡</td><td>二年甲班</td><td>22.0</td><td>${tag("領先", "success")}</td></tr>
    <tr><td class="rank">02</td><td>陳雅文</td><td>一年乙班</td><td>19.5</td><td></td></tr>
    <tr class="rank-group"><td class="rank">03</td><td><strong>林知遠</strong></td><td>一年甲班</td><td><strong>18.5</strong></td><td>${tag("你", "outline")}</td></tr>
    <tr><td class="rank">03</td><td>周以安</td><td>二年甲班</td><td>18.5</td><td>${tag("同分", "outline")}</td></tr>
    <tr class="threshold-yellow"><td class="rank">07</td><td>許晴川</td><td>一年甲班</td><td>15.0</td><td>${tag("免面試線", "warning")}</td></tr>
    <tr class="threshold-red"><td class="rank">23</td><td>黃思齊</td><td>二年乙班</td><td>8.5</td><td>${tag("紅線待定", "danger")}</td></tr>
    <tr><td class="rank">—</td><td>吳念初</td><td>一年乙班</td><td>—</td><td>${tag("無有效紀錄", "outline")}</td></tr>
  </tbody></table></div>`;

const accountPage = () => `${pageHead("06 / 07", "account", "帳號設定", "管理登入密碼與裝置安全。姓名、學號與班別由管理員維護。")}
  <div class="grid grid-2"><section class="card"><span class="eyebrow">identity</span><h2 style="margin-top:8px">基本資料</h2><div class="form-grid" style="margin-top:20px"><div class="field"><label for="profile-id">學號</label><input id="profile-id" class="input" value="S260017" disabled></div><div class="field"><label for="profile-name">姓名</label><input id="profile-name" class="input" value="林知遠" disabled></div><div class="field field-full"><label for="profile-class">班別</label><input id="profile-class" class="input" value="一年甲班" disabled></div></div><p class="muted">如需更正，請直接聯絡管理員。</p></section>
  <section class="card"><span class="eyebrow">security</span><h2 style="margin-top:8px">變更密碼</h2><form id="password-form" class="field" style="margin-top:20px"><label for="current-password">目前密碼</label><input id="current-password" class="input" type="password" autocomplete="current-password"><label for="new-password">新密碼</label><input id="new-password" class="input" type="password" minlength="10" autocomplete="new-password" aria-describedby="password-rule"><small id="password-rule">至少 10 碼，並包含英文與數字。</small><button class="button button-primary" type="submit">儲存新密碼</button></form></section></div>
  <section class="card" style="margin-top:20px"><div class="switch-row"><div><strong>在這部裝置保留登入</strong><div class="muted">30 天後自動登出；公用裝置建議關閉。</div></div><button class="switch" type="button" role="switch" aria-checked="false" data-action="toggle-switch" aria-label="在這部裝置保留登入"></button></div><div class="switch-row"><div><strong>最近一次登入</strong><div class="muted">2026.04.16 12:31 · 行動裝置 · 展示紀錄</div></div><button class="button" type="button" data-action="show-toast" data-message="其他展示工作階段已登出">登出其他裝置</button></div></section>`;

const creditsPage = () => `${pageHead("07 / 07", "acknowledgements", "開發致謝", "這個展示原型以學會的閱讀、討論與治理需求為出發點。")}
  <article class="card card-dark hero-panel" data-od-id="credits-message"><span class="eyebrow">made for thoughtful practice</span><h1>把每一次出席、分享與交流，留下清楚而公平的紀錄。</h1><p>感謝學會幹部、指導老師與測試同學提供流程建議。本頁所有姓名、分數與操作紀錄皆為虛構展示資料。</p></article>
  <div class="grid grid-3" style="margin-top:20px"><article class="card"><span class="eyebrow">01 / content</span><h2 style="margin-top:8px">制度整理</h2><p class="muted">將出勤、活動、分享與門檻規則轉為可追蹤的資訊架構。</p></article><article class="card"><span class="eyebrow">02 / design</span><h2 style="margin-top:8px">介面與研究</h2><p class="muted">以可讀性、無障礙與高密度管理操作為核心。</p></article><article class="card"><span class="eyebrow">03 / build</span><h2 style="margin-top:8px">原型實作</h2><p class="muted">單一入口、無後端、無真實資料連線的瀏覽器原型。</p></article></div>`;

const adminOverview = () => `${pageHead("01 / 09", "admin / term 02", "管理總覽", "掌握本期出勤、積分與待辦；所有操作僅影響本地展示狀態。", `<button class="button button-primary" type="button" data-action="navigate" data-page="sessions">開啟今日點名</button>`)}
  <div class="grid grid-4" data-od-id="admin-metrics"><article class="card metric"><span class="metric-label">啟用成員</span><strong class="metric-value">28</strong><span class="metric-delta">本期新增 3 人</span></article><article class="card metric"><span class="metric-label">今日應到</span><strong class="metric-value">26</strong><span class="metric-delta">2 人已登記公假</span></article><article class="card metric"><span class="metric-label">待發布紀錄</span><strong class="metric-value">06</strong><span class="metric-delta">第五課分享與出勤</span></article><article class="card metric"><span class="metric-label">待審名單</span><strong class="metric-value">04</strong><span class="metric-delta">截止後逐一決定</span></article></div>
  <div class="dashboard-grid" style="margin-top:20px"><section class="card"><div class="section-heading"><div><span class="eyebrow">term pulse</span><h2>六週出勤概況</h2></div><p>有效成員 28 人</p></div><div class="chart-bars" aria-label="六週出席人次長條圖"><div class="chart-bar" style="height:88%"><span>W1</span></div><div class="chart-bar" style="height:94%"><span>W2</span></div><div class="chart-bar" style="height:81%"><span>W3</span></div><div class="chart-bar" style="height:91%"><span>W4</span></div><div class="chart-bar" style="height:86%"><span>W5</span></div><div class="chart-bar" style="height:62%;background:var(--border)"><span>W6</span></div></div><p class="muted" style="margin-top:34px">第六週為尚未結課的暫存值，不列入正式統計。</p></section>
  <aside class="card"><div class="section-heading"><div><span class="eyebrow">priority queue</span><h2>今日待辦</h2></div></div><div class="timeline"><div class="timeline-item"><strong>12:45 開啟第六課點名</strong><span>系統將產生 6 位數碼與輪替 QR</span></div><div class="timeline-item"><strong>核對 2 筆請假</strong><span>分類與備註只對本人及管理員可見</span></div><div class="timeline-item"><strong>發布第五課成績</strong><span>26 筆出勤 · 6 筆分享</span></div></div></aside></div>`;

function membersPage() {
  const rows = demoMembers.filter(row => row.join(" ").includes(state.memberQuery.trim()));
  return `${pageHead("02 / 09", "directory", "成員管理", "新增、編輯、重設密碼與停用成員；停用不刪除歷史紀錄。", `<button class="button button-primary" type="button" data-action="member-modal" data-mode="add">新增成員</button>`)}
    <div class="toolbar"><div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg><input id="member-search" class="input" type="search" placeholder="搜尋姓名、學號或班別" value="${state.memberQuery}" aria-label="搜尋成員"></div><div class="toolbar-group"><select class="select" aria-label="狀態篩選"><option>全部狀態</option><option>啟用</option><option>停用</option></select><button class="button" type="button" data-action="show-toast" data-message="展示名冊已匯出">匯出名冊</button></div></div>
    ${rows.length ? `<div class="table-wrap" data-od-id="member-table"><table><thead><tr><th>學號</th><th>姓名</th><th>班別</th><th>本期分數</th><th>狀態</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${rows.map((row, index) => `<tr><td><span class="eyebrow">${row[0]}</span></td><td><strong>${row[1]}</strong></td><td>${row[2]}</td><td>${row[3]}</td><td>${tag(row[4], row[4] === "啟用" ? "success" : "outline")}</td><td><div class="table-actions"><button class="button button-quiet" type="button" data-action="member-modal" data-mode="edit" data-name="${row[1]}">編輯</button><button class="button button-quiet" type="button" data-action="reset-password" data-name="${row[1]}">重設密碼</button><button class="button button-quiet" type="button" data-action="toggle-member" data-name="${row[1]}" data-status="${row[4]}">${row[4] === "啟用" ? "停用" : "恢復"}</button></div></td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty-state"><div><div class="empty-symbol">∅</div><h2>找不到符合的成員</h2><p>請調整姓名、學號或班別關鍵字。這不是警示，也不會改動名冊。</p></div></div>`}`;
}

function sessionsPage() {
  return `${pageHead("03 / 09", "attendance ops", "課次與點名", "開啟後產生 6 位數碼與每 30 秒輪替 QR；結課發布前可修正狀態。", `<button class="button ${state.sessionOpen ? "button-danger" : "button-primary"}" type="button" data-action="toggle-session">${state.sessionOpen ? "取消本次點名" : "開啟本次點名"}</button>`)}
    <section class="card ${state.sessionOpen ? "card-dark" : ""}" data-od-id="active-session"><div class="grid grid-2"><div><span class="eyebrow">session 06 · ${state.sessionOpen ? "live" : "not open"}</span><h2 style="margin-top:10px">國際組織的合法性</h2><p class="muted">2026.04.16 · 12:45–13:10 · 12:55 起遲到</p><div class="session-code">${state.sessionOpen ? "482731" : "—— ——"}</div><p class="muted">${state.sessionOpen ? `數字碼與 QR 將於 ${state.qrSeconds} 秒後更新` : "點名尚未開啟；學生端將顯示未開啟狀態。"}</p></div><div>${state.sessionOpen ? `<div class="qr-box" style="margin:0 auto">${qrCells}</div>` : `<div class="empty-state"><div><div class="empty-symbol">06</div><p>準備完成後開啟本課點名。</p></div></div>`}</div></div></section>
    <div class="section-heading"><div><span class="eyebrow">attendance register</span><h2>即時點名冊</h2></div><p>18 已到 · 2 遲到 · 6 未記錄</p></div>
    <div class="table-wrap" data-od-id="attendance-table"><table><thead><tr><th>成員</th><th>班別</th><th>簽到時間</th><th>出勤狀態</th><th>分享</th></tr></thead><tbody>
      ${[["林知遠","一年甲班","12:49","出席"],["陳雅文","一年乙班","12:57","遲到"],["周以安","二年甲班","—","公假"],["黃思齊","二年乙班","—","未記錄"]].map((row, index) => `<tr><td><strong>${row[0]}</strong></td><td>${row[1]}</td><td>${row[2]}</td><td><select class="select" aria-label="${row[0]}出勤狀態"><option ${row[3]==="出席"?"selected":""}>出席 +0.5</option><option ${row[3]==="遲到"?"selected":""}>遲到 −1</option><option>缺席 −2</option><option ${row[3]==="公假"?"selected":""}>公假 0</option><option>病假 0</option><option>事假 0</option><option ${row[3]==="未記錄"?"selected":""}>未記錄</option></select></td><td><button class="switch" type="button" role="switch" aria-checked="${index === 0}" data-action="toggle-switch" aria-label="${row[0]}本課分享加 2 分"></button></td></tr>`).join("")}
    </tbody></table></div><div class="page-actions" style="margin-top:18px"><button class="button button-primary" type="button" data-action="publish-session">結課並發布</button><button class="button" type="button" data-action="show-toast" data-message="暫存完成；尚未發布至學生端">暫存變更</button></div>`;
}

const activitiesAdminPage = () => `${pageHead("04 / 09", "programme ops", "活動管理", "發布活動詳情、登記參與、設定每人成績；撤銷紀錄時必須留下理由。", `<button class="button button-primary" type="button" data-action="activity-modal">發布新活動</button>`)}
  <div class="grid grid-3"><article class="card"><span class="eyebrow">published · lecture</span><h2 style="margin-top:8px">外交現場講座</h2><p class="muted">04.24 · 0 位已登記 · 預設 +0.5</p><button class="button" type="button" data-action="show-toast" data-message="已開啟外交現場講座名單">管理名單</button></article><article class="card"><span class="eyebrow">published · visit</span><h2 style="margin-top:8px">港口治理參訪</h2><p class="muted">05.08 · 0 位已登記 · 預設 +0.5</p><button class="button" type="button" data-action="show-toast" data-message="已開啟港口治理參訪名單">管理名單</button></article><article class="card"><span class="eyebrow">draft · match</span><h2 style="margin-top:8px">校際辯論交流賽</h2><p class="muted">05.23 · 比賽成績需逐人指定</p><button class="button" type="button" data-action="show-toast" data-message="展示草稿已開啟">繼續編輯</button></article></div>
  <div class="section-heading"><div><span class="eyebrow">participation register</span><h2>最近參與登記</h2></div><button class="button" type="button" data-action="participant-modal">登記參與</button></div>
  <div class="table-wrap"><table><thead><tr><th>成員</th><th>活動</th><th>類別</th><th>成績</th><th>登記者</th><th></th></tr></thead><tbody><tr><td>林知遠</td><td>區域研究講座</td><td>講座</td><td>+0.5</td><td>管理員 A</td><td><button class="button button-quiet" type="button" data-action="revoke-modal">撤銷</button></td></tr><tr><td>陳雅文</td><td>青年盃模擬談判</td><td>比賽</td><td>+3.0</td><td>管理員 A</td><td><button class="button button-quiet" type="button" data-action="revoke-modal">撤銷</button></td></tr></tbody></table></div>`;

const adjustmentsPage = () => `${pageHead("05 / 09", "score ledger", "分數修正", "不覆蓋原始紀錄；每次修正均以正負差額寫入並保留理由。")}
  <div class="grid grid-2"><section class="card"><h2>新增修正</h2><form id="adjustment-form" class="form-grid" style="margin-top:20px"><div class="field"><label for="adjust-member">成員</label><select id="adjust-member" class="select"><option>林知遠 · S260017</option><option>陳雅文 · S260024</option></select></div><div class="field"><label for="adjust-score">修正分數</label><input id="adjust-score" class="input" type="number" step="0.5" placeholder="例如 −0.5" required></div><div class="field field-full"><label for="adjust-reason">修正理由</label><textarea id="adjust-reason" class="textarea" placeholder="說明依據與需要修正的紀錄" required></textarea></div><div class="field-full"><button class="button button-primary" type="submit">確認新增修正</button></div></form></section>
  <aside class="card"><h2>計分規則</h2><ul><li>出席 +0.5；遲到 −1；缺席 −2。</li><li>公假、病假、事假皆為 0 分。</li><li>分享 +2，可與出勤相加，每人每課一次。</li><li>講座、參觀、觀賽 +0.5；比賽由管理員指定。</li></ul><div class="notice notice-warning"><strong>修正不改原紀錄</strong>如需改變出勤類別，請回到該課次處理。</div></aside></div>
  <div class="section-heading"><div><span class="eyebrow">adjustment history</span><h2>最近修正</h2></div></div><div class="table-wrap"><table><thead><tr><th>時間</th><th>成員</th><th>差額</th><th>理由</th><th>操作者</th></tr></thead><tbody><tr><td>04.11 09:42</td><td>陳雅文</td><td class="score-plus">+0.5</td><td>補登 03.20 講座參與</td><td>管理員 A</td></tr><tr><td>04.04 15:18</td><td>黃思齊</td><td class="score-minus">−0.5</td><td>更正重複匯入活動紀錄</td><td>管理員 B</td></tr></tbody></table></div>`;

function thresholdsPage() {
  return `${pageHead("06 / 09", "thresholds", "門檻設定", "紅線可依倒數第二分數自動計算並納入同分者，或改用手動分數；黃線預設不啟用。")}
    <div class="grid grid-2"><section class="card"><span class="eyebrow">red threshold</span><h2 style="margin-top:8px">淘汰參考紅線</h2><div class="segmented" style="margin:20px 0"><button type="button" data-action="threshold-mode" data-mode="auto" aria-pressed="${state.thresholdMode === "auto"}">自動</button><button type="button" data-action="threshold-mode" data-mode="manual" aria-pressed="${state.thresholdMode === "manual"}">手動</button></div>${state.thresholdMode === "auto" ? `<div class="notice"><strong>目前計算值：8.5 分</strong>取有效紀錄中倒數第二分數，4 位同分成員一併落在線上。</div>` : `<div class="field"><label for="manual-threshold">手動紅線分數</label><input id="manual-threshold" class="input" type="number" value="9" step="0.5"><small>截止快照仍會保留當下設定與受影響名單。</small></div>`}<div class="threshold-visual"><div class="threshold-track"><span></span></div><div class="threshold-marker"><em>8.5 分</em></div></div></section>
    <section class="card"><span class="eyebrow">yellow threshold</span><h2 style="margin-top:8px">免面試黃線</h2><div class="switch-row"><div><strong>啟用黃線</strong><div class="muted">目前未設定，學生端不顯示黃線。</div></div><button class="switch" type="button" role="switch" aria-checked="false" data-action="toggle-switch" aria-label="啟用黃線"></button></div><div class="field" style="margin-top:18px"><label for="yellow-threshold">黃線分數</label><input id="yellow-threshold" class="input" type="number" step="0.5" placeholder="尚未設定" disabled></div></section></div>
    <section class="card" style="margin-top:20px"><div class="section-heading"><div><span class="eyebrow">impact preview</span><h2>影響預覽</h2></div><p>以目前有效紀錄計算</p></div><div class="grid grid-3"><div><span class="metric-label">紅線上</span><strong class="metric-value">04</strong></div><div><span class="metric-label">紅線以下</span><strong class="metric-value">01</strong></div><div><span class="metric-label">無有效紀錄</span><strong class="metric-value">02</strong></div></div><p class="muted">無有效紀錄者不顯示警示，也不納入倒數第二分數計算。</p></section>`;
}

const decisionsPage = () => `${pageHead("07 / 09", "review snapshot", "截止待審快照", "快照鎖定截止時的分數、紅線與同分群組；管理員須逐一作出保留或淘汰決定。")}
  <div class="notice notice-warning"><strong>展示快照 · 2026.06.20 23:59</strong>紅線 8.5 分，影響 4 位同分成員。決定前請核對未發布紀錄與請假狀態。</div>
  <div class="section-heading"><div><span class="eyebrow">individual review</span><h2>待審名單</h2></div><p>0 / 4 已決定</p></div>
  <div class="table-wrap" data-od-id="review-table"><table><thead><tr><th>成員</th><th>班別</th><th>截止分數</th><th>狀態</th><th>逐一決定</th></tr></thead><tbody>${[["黃思齊","二年乙班","8.5"],["許晴川","一年甲班","8.5"],["簡安禾","一年乙班","8.5"],["羅予澄","二年甲班","8.5"]].map(row => `<tr><td><strong>${row[0]}</strong></td><td>${row[1]}</td><td>${row[2]}</td><td>${tag("待審", "warning")}</td><td><div class="table-actions"><button class="button" type="button" data-action="decision" data-name="${row[0]}" data-decision="保留">保留</button><button class="button button-danger" type="button" data-action="decision" data-name="${row[0]}" data-decision="淘汰">淘汰</button></div></td></tr>`).join("")}</tbody></table></div>`;

const archivesPage = () => `${pageHead("08 / 09", "term archive", "封存與新期歸零", "封存保留完整紀錄與決定；建立新期只歸零本期分數，不刪除成員與歷史。")}
  <div class="grid grid-2"><section class="card"><span class="eyebrow">current term</span><h2 style="margin-top:8px">2026 春季學期</h2><ul><li>28 位啟用成員</li><li>12 個課次 · 9 個活動</li><li>312 筆分數紀錄</li><li>待完成 4 筆截止決定</li></ul><button class="button button-primary" type="button" data-action="archive-modal">完成封存並建立新期</button></section><aside class="card"><div class="notice notice-error"><strong>封存前檢查</strong>尚有 4 位成員的截止決定未完成，正式流程應先完成逐一審核。</div><p class="muted">展示原型允許預覽確認畫面，但不會真的改變任何資料。</p></aside></div>
  <div class="section-heading"><div><span class="eyebrow">archive history</span><h2>歷史學期</h2></div></div><div class="table-wrap"><table><thead><tr><th>學期</th><th>成員</th><th>課次</th><th>活動</th><th>封存時間</th><th></th></tr></thead><tbody><tr><td><strong>2025 秋季</strong></td><td>26</td><td>12</td><td>7</td><td>2026.01.12</td><td><button class="button button-quiet" type="button" data-action="show-toast" data-message="已開啟 2025 秋季唯讀摘要">查看</button></td></tr><tr><td><strong>2025 春季</strong></td><td>24</td><td>11</td><td>8</td><td>2025.07.04</td><td><button class="button button-quiet" type="button" data-action="show-toast" data-message="已開啟 2025 春季唯讀摘要">查看</button></td></tr></tbody></table></div>`;

const logsPage = () => `${pageHead("09 / 09", "audit & export", "操作紀錄與匯出", "依時間、操作者與事件篩選管理操作；匯出只包含目前篩選結果。", `<button class="button button-primary" type="button" data-action="export-csv">匯出 CSV</button>`)}
  <div class="toolbar"><div class="toolbar-group"><select class="select" aria-label="事件類型"><option>全部事件</option><option>成員</option><option>點名</option><option>分數</option><option>封存</option></select><select class="select" aria-label="操作者"><option>全部操作者</option><option>管理員 A</option><option>管理員 B</option></select></div><span class="muted">保留 180 天 · 展示規則</span></div>
  <div class="table-wrap" data-od-id="audit-log-table"><table><thead><tr><th>時間</th><th>操作者</th><th>事件</th><th>對象</th><th>摘要</th></tr></thead><tbody><tr><td>04.16 12:45:02</td><td>管理員 A</td><td>${tag("點名", "success")}</td><td>第六課</td><td>開啟簽到窗口</td></tr><tr><td>04.16 10:18:44</td><td>管理員 B</td><td>${tag("成員", "outline")}</td><td>黃思齊</td><td>恢復成員帳號</td></tr><tr><td>04.11 09:42:17</td><td>管理員 A</td><td>${tag("分數", "warning")}</td><td>陳雅文</td><td>新增 +0.5 修正</td></tr><tr><td>04.10 16:20:08</td><td>管理員 A</td><td>${tag("發布", "success")}</td><td>第五課</td><td>發布 32 筆出勤與分享紀錄</td></tr></tbody></table></div>
  <div class="notice" style="margin-top:18px"><strong>資料邊界</strong>此原型不讀取真實成員檔、其他目錄、環境變數或憑證；匯出內容為頁面內的虛構展示資料。</div>`;

const pages = {
  dashboard: studentDashboard, checkin: checkinPage, events: eventsPage, record: recordPage,
  leaderboard: leaderboardPage, account: accountPage, credits: creditsPage, overview: adminOverview,
  members: membersPage, sessions: sessionsPage, activities: activitiesAdminPage, adjustments: adjustmentsPage,
  thresholds: thresholdsPage, decisions: decisionsPage, archives: archivesPage, logs: logsPage
};

function navigate(page) {
  state.page = page;
  renderShell();
  window.scrollTo({ top: 0, behavior: "smooth" });
  el("#main-content").focus({ preventScroll: true });
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  el("#toast-root").appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function openModal(content, extraClass = "") {
  el("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal-panel>${content}</section></div>`;
  const focusable = el("#modal-root button, #modal-root input, #modal-root select, #modal-root textarea");
  if (focusable) focusable.focus();
}

function closeModal() { el("#modal-root").innerHTML = ""; }

function modalHead(kicker, title) {
  return `<header class="modal-head"><div><span class="eyebrow">${kicker}</span><h2 id="modal-title">${title}</h2></div><button class="icon-button" type="button" data-action="close-modal" aria-label="關閉視窗">×</button></header>`;
}

function openAuth() {
  openModal(`${modalHead("student access", "以學號登入")}
    <div class="auth-mark"><svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="22"></circle><ellipse cx="28" cy="28" rx="10" ry="22"></ellipse><path d="M8 20h40M6 28h44M8 36h40M28 6v44"></path></svg></div>
    <form id="login-form" class="field"><label for="login-id">學號</label><input id="login-id" class="input" value="S260017" autocomplete="username"><label for="login-password">密碼</label><input id="login-password" class="input" type="password" value="demo2026" autocomplete="current-password"><div class="notice"><strong>無開放註冊</strong>帳號由管理員建立。首次登入後必須設定新密碼。</div><button class="button button-primary" type="submit">登入</button></form>`);
}

function openFirstPassword() {
  openModal(`${modalHead("first sign-in", "設定你的新密碼")}<p class="muted">這是此帳號首次登入。完成變更後才能進入學會系統。</p><form id="first-password-form" class="field"><label for="first-password">新密碼</label><input id="first-password" class="input" type="password" minlength="10" placeholder="至少 10 碼" autocomplete="new-password"><label for="confirm-password">再次輸入</label><input id="confirm-password" class="input" type="password" minlength="10" autocomplete="new-password"><span id="first-password-error" class="field-error" hidden></span><button class="button button-primary" type="submit">儲存並進入系統</button></form>`);
}

function openMobileMenu() {
  const items = navForRole();
  openModal(`${modalHead(state.role === "student" ? "student pages" : "admin pages", "全部頁面")}<div class="mobile-sheet-list">${items.map(([id, label], index) => `<button class="nav-button" type="button" data-action="navigate-modal" data-page="${id}" aria-current="${state.page === id ? "page" : "false"}"><span class="nav-number">${String(index + 1).padStart(2, "0")}</span>${label}</button>`).join("")}</div><div class="divider-label">視角</div><div class="role-switch"><button type="button" data-action="role-modal" data-role="student" aria-pressed="${state.role === "student"}">學生視角</button><button type="button" data-action="role-modal" data-role="admin" aria-pressed="${state.role === "admin"}">管理員</button></div>`, "mobile-sheet");
}

function openMemberModal(mode, name = "") {
  const isEdit = mode === "edit";
  openModal(`${modalHead("member record", isEdit ? `編輯 ${name}` : "新增成員")}<form id="member-form" class="form-grid"><div class="field"><label for="member-id">學號</label><input id="member-id" class="input" value="${isEdit ? "S260017" : ""}" required></div><div class="field"><label for="member-name">姓名</label><input id="member-name" class="input" value="${name}" required></div><div class="field field-full"><label for="member-class">班別</label><input id="member-class" class="input" value="${isEdit ? "一年甲班" : ""}" required></div><div class="field field-full"><label for="member-note">管理備註</label><textarea id="member-note" class="textarea" placeholder="僅管理員可見"></textarea></div><div class="modal-actions field-full"><button class="button" type="button" data-action="close-modal">取消</button><button class="button button-primary" type="submit">${isEdit ? "儲存變更" : "建立成員"}</button></div></form>`);
}

function openActivityModal() {
  openModal(`${modalHead("new programme", "發布新活動")}<form id="activity-form" class="form-grid"><div class="field field-full"><label for="activity-title">活動名稱</label><input id="activity-title" class="input" required></div><div class="field"><label for="activity-type">類別</label><select id="activity-type" class="select"><option>講座</option><option>參觀</option><option>觀賽</option><option>比賽</option></select></div><div class="field"><label for="activity-score">預設分數</label><input id="activity-score" class="input" type="number" value="0.5" step="0.5"></div><div class="field field-full"><label for="activity-detail">活動詳情</label><textarea id="activity-detail" class="textarea" required></textarea></div><div class="notice field-full"><strong>參與登記</strong>學生端不提供報名；活動後由管理員登記參與與個別成績。</div><div class="modal-actions field-full"><button class="button" type="button" data-action="close-modal">取消</button><button class="button button-primary" type="submit">發布活動</button></div></form>`);
}

function openParticipantModal() {
  openModal(`${modalHead("participation", "登記活動參與")}<form id="participant-form" class="form-grid"><div class="field"><label for="participant-name">成員</label><select id="participant-name" class="select"><option>林知遠</option><option>陳雅文</option><option>周以安</option></select></div><div class="field"><label for="participant-event">活動</label><select id="participant-event" class="select"><option>外交現場講座</option><option>港口治理參訪</option><option>校際辯論交流賽</option></select></div><div class="field field-full"><label for="participant-score">個人成績</label><input id="participant-score" class="input" type="number" value="0.5" step="0.5"></div><div class="modal-actions field-full"><button class="button" type="button" data-action="close-modal">取消</button><button class="button button-primary" type="submit">確認登記</button></div></form>`);
}

function openRevokeModal() {
  openModal(`${modalHead("revoke record", "撤銷參與紀錄")}<div class="notice notice-error"><strong>撤銷會建立反向紀錄</strong>原始登記仍保留於操作歷程。</div><form id="revoke-form" class="field" style="margin-top:18px"><label for="revoke-reason">撤銷理由</label><textarea id="revoke-reason" class="textarea" required placeholder="必填，說明撤銷依據"></textarea><div class="modal-actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button button-danger" type="submit">確認撤銷</button></div></form>`);
}

function openDecisionModal(name, decision) {
  openModal(`${modalHead("individual decision", `${decision} ${name}`)}<p>此決定只適用於 <strong>${name}</strong>，不會自動套用至同分成員。</p><form id="decision-form" class="field"><label for="decision-note">決定理由</label><textarea id="decision-note" class="textarea" required placeholder="記錄審查依據"></textarea><input type="hidden" value="${decision}"><div class="modal-actions"><button class="button" type="button" data-action="close-modal">返回</button><button class="button ${decision === "淘汰" ? "button-danger" : "button-primary"}" type="submit">確認${decision}</button></div></form>`);
}

function openArchiveModal() {
  openModal(`${modalHead("term transition", "封存並建立新期")}<div class="notice notice-error"><strong>仍有 4 筆截止決定未完成</strong>正式流程應先完成審核。此處僅預覽確認內容。</div><ul><li>2026 春季轉為唯讀封存。</li><li>新期分數歸零，歷史紀錄保留。</li><li>啟用成員沿用，停用狀態不變。</li></ul><div class="field"><label for="term-name">新學期名稱</label><input id="term-name" class="input" value="2026 秋季學期"></div><div class="modal-actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button button-danger" type="button" data-action="confirm-archive">確認展示流程</button></div>`);
}

function exportCsv() {
  const rows = [["時間","操作者","事件","對象","摘要"],["2026-04-16 12:45:02","管理員 A","點名","第六課","開啟簽到窗口"],["2026-04-16 10:18:44","管理員 B","成員","黃思齊","恢復成員帳號"]];
  const blob = new Blob(["\uFEFF" + rows.map(row => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "irss-demo-audit-log.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("虛構展示操作紀錄已匯出");
}

function bindPageInputs() {
  const memberSearch = el("#member-search");
  if (memberSearch) memberSearch.addEventListener("input", (event) => { state.memberQuery = event.target.value; el("#main-content").innerHTML = membersPage(); bindPageInputs(); el("#member-search").focus(); el("#member-search").setSelectionRange(state.memberQuery.length, state.memberQuery.length); });
}

document.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = event.target.id;
  if (id === "checkin-form") {
    const input = el("#checkin-code"); const error = el("#checkin-error");
    if (input.value !== "482731") { input.setAttribute("aria-invalid", "true"); error.hidden = false; error.textContent = "代碼不正確。請確認教室畫面上的最新 6 位數碼。"; input.focus(); return; }
    state.checkin = "success"; renderShell(); showToast("簽到成功，本課 +0.5 分");
  } else if (id === "login-form") openFirstPassword();
  else if (id === "first-password-form") {
    const first = el("#first-password"); const confirm = el("#confirm-password"); const error = el("#first-password-error");
    if (first.value.length < 10 || first.value !== confirm.value || !/[A-Za-z]/.test(first.value) || !/[0-9]/.test(first.value)) { error.hidden = false; error.textContent = "請輸入至少 10 碼且包含英文與數字的相同密碼。"; first.focus(); return; }
    closeModal(); showToast("首次密碼已更新；已進入展示首頁"); navigate("dashboard");
  } else if (["password-form","member-form","activity-form","participant-form","revoke-form","decision-form","adjustment-form"].includes(id)) {
    closeModal(); showToast("展示變更已儲存；未連接真實後端");
  }
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "navigate") navigate(target.dataset.page);
  if (action === "navigate-modal") { closeModal(); navigate(target.dataset.page); }
  if (action === "role" || action === "role-modal") { state.role = target.dataset.role; state.page = state.role === "student" ? "dashboard" : "overview"; closeModal(); renderShell(); }
  if (action === "open-auth") openAuth();
  if (action === "open-menu") openMobileMenu();
  if (action === "close-modal" && !event.target.closest("[data-modal-panel]") || target.matches("button[data-action='close-modal']")) closeModal();
  if (action === "show-toast") showToast(target.dataset.message);
  if (action === "checkin-state") { state.checkin = target.dataset.state; renderShell(); }
  if (action === "select-event") { state.selectedEvent = target.dataset.event; renderShell(); }
  if (action === "toggle-switch") { const next = target.getAttribute("aria-checked") !== "true"; target.setAttribute("aria-checked", String(next)); showToast(next ? "展示設定已開啟" : "展示設定已關閉"); }
  if (action === "member-modal") openMemberModal(target.dataset.mode, target.dataset.name);
  if (action === "reset-password") showToast(`${target.dataset.name} 的展示密碼已重設`);
  if (action === "toggle-member") showToast(`${target.dataset.name} 已${target.dataset.status === "啟用" ? "停用" : "恢復"}`);
  if (action === "toggle-session") { state.sessionOpen = !state.sessionOpen; renderShell(); showToast(state.sessionOpen ? "第六課點名已開啟" : "本次點名已取消"); }
  if (action === "publish-session") showToast("第六課已結課並發布至學生紀錄");
  if (action === "activity-modal") openActivityModal();
  if (action === "participant-modal") openParticipantModal();
  if (action === "revoke-modal") openRevokeModal();
  if (action === "threshold-mode") { state.thresholdMode = target.dataset.mode; renderShell(); }
  if (action === "decision") openDecisionModal(target.dataset.name, target.dataset.decision);
  if (action === "archive-modal") openArchiveModal();
  if (action === "confirm-archive") { closeModal(); showToast("已完成封存流程預覽；未改動展示資料"); }
  if (action === "export-csv") exportCsv();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && el("#modal-root").children.length) closeModal();
});

window.setInterval(() => {
  state.qrSeconds = state.qrSeconds <= 1 ? 30 : state.qrSeconds - 1;
  const countdown = el("#qr-countdown");
  if (countdown) countdown.textContent = state.qrSeconds;
}, 1000);

renderShell();
