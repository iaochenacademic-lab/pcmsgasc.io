import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CancelLeaveButton, CheckInForm, LeaveForm } from "@/components/attendance/member-forms";
import { panelClass } from "@/components/attendance/form-styles";
import { StatusBadge, leaveTypeLabel } from "@/components/attendance/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { getMemberDashboard } from "@/lib/attendance/service";
import { formatClubDateTime, getClubTimeZone } from "@/lib/attendance/time";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function MemberHomePage() {
  const session = await requireRole("member");
  const now = new Date();
  const timeZone = getClubTimeZone();
  const result = await getMemberDashboard(session, {
    repository: createSupabaseAttendanceRepository(createAdminClient()),
    now,
    timeZone,
  });
  if (!result.ok) redirect("/auth/expired");
  const { dashboard } = result;
  const { summary } = dashboard;
  const rate = summary.attendanceRate === null ? "—" : (summary.attendanceRate * 100).toFixed(1).replace(/\.0$/, "") + "%";
  const counts = [
    { status: "present", label: "已到", value: summary.present, classes: "bg-emerald-50 text-emerald-900" },
    { status: "late", label: "迟到", value: summary.late, classes: "bg-amber-50 text-amber-900" },
    { status: "excused", label: "请假", value: summary.excused, classes: "bg-sky-50 text-sky-900" },
    { status: "absent", label: "缺勤", value: summary.absent, classes: "bg-rose-50 text-rose-900" },
  ];

  return <AppShell title="成员首页" user={session}>
    <section aria-label="欢迎" className="px-1">
      <p className="text-sm font-medium text-indigo-700">我的社团生活</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">欢迎回来，{session.name}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">查看近期场次，完成签到，也可以在这里提交请假。时间均按社团时区 {timeZone} 显示。</p>
    </section>

    {dashboard.openMeetings.length > 0 && <section aria-labelledby="member-check-in-title" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="member-check-in-title" className="text-lg font-semibold text-slate-900">现在签到</h2>
        <span className="text-sm text-slate-600">{dashboard.openMeetings.length} 个场次开放中</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{dashboard.openMeetings.map(({ meeting }) => <article key={meeting.id} className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm sm:p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{meeting.title}</h3>
          <StatusBadge status="open" />
        </div>
        <p className="text-sm leading-6 text-slate-600"><time dateTime={meeting.startsAt}>{formatClubDateTime(meeting.startsAt, timeZone)}</time> 开始</p>
        <p className="text-sm leading-6 text-slate-600"><time dateTime={meeting.endsAt}>{formatClubDateTime(meeting.endsAt, timeZone)}</time> 截止签到</p>
        <p className="mb-5 mt-1 text-sm text-slate-600">{meeting.location || "地点待老师说明"} · 开始 {meeting.lateAfterMinutes} 分钟后记为迟到</p>
        <CheckInForm key={meeting.updatedAt} meetingId={meeting.id} />
      </article>)}</div>
    </section>}

    <div className="grid items-start gap-6 lg:grid-cols-5">
      <section aria-labelledby="member-upcoming-title" className={panelClass + " lg:col-span-3"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="member-upcoming-title" className="text-lg font-semibold text-slate-900">接下来</h2>
          <span className="text-xs font-medium text-slate-500">当前与未来 14 天</span>
        </div>
        {dashboard.upcomingMeetings.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
          <p className="font-medium text-slate-700">近期暂无场次</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">老师发布场次后，会在这里显示。</p>
        </div> : <ul className="mt-4 divide-y divide-slate-100">{dashboard.upcomingMeetings.map((entry) => {
          const { meeting, attendance, leave, phase } = entry;
          const canRequestLeave = phase !== "cancelled"
            && now.getTime() < Date.parse(meeting.endsAt)
            && attendance?.status !== "present" && attendance?.status !== "late"
            && leave?.status !== "pending" && leave?.status !== "approved";
          return <li key={meeting.id} className="py-5 first:pt-1 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="font-semibold text-slate-900">{meeting.title}</h3>
              <div className="flex flex-wrap gap-2"><StatusBadge status={phase} />{phase !== "cancelled" && <StatusBadge status={entry.status} />}</div>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600"><time dateTime={meeting.startsAt}>{formatClubDateTime(meeting.startsAt, timeZone)}</time><span className="px-1">至</span><time dateTime={meeting.endsAt}>{formatClubDateTime(meeting.endsAt, timeZone)}</time></p>
            <p className="mt-1 text-sm text-slate-500">{meeting.location || "地点待老师说明"}</p>
            {leave && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600"><span>{leaveTypeLabel[leave.leaveType]}申请</span><StatusBadge status={leave.status} leave /></div>}
            {phase === "cancelled" ? <p className="mt-3 text-sm text-slate-500">场次已取消，不再接受签到或请假。</p> : canRequestLeave ? <div className="mt-4"><LeaveForm meetingId={meeting.id} lateSubmission={now.getTime() >= Date.parse(meeting.startsAt)} /></div> : attendance && (attendance.status === "present" || attendance.status === "late") ? <p className="mt-3 text-sm text-slate-500">已经完成签到。</p> : null}
          </li>;
        })}</ul>}
        {dashboard.openMeetings.length === 0 && dashboard.upcomingMeetings.length > 0 && <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">当前没有需要签到的场次。签到窗口会在场次开始前 15 分钟开放。</p>}
      </section>

      <section aria-labelledby="member-attendance-title" className={panelClass + " lg:col-span-2"}>
        <h2 id="member-attendance-title" className="text-lg font-semibold text-slate-900">我的出勤</h2>
        <div className="mt-5">
          <p className="text-sm text-slate-500">出勤率</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight text-indigo-700" aria-label={"出勤率 " + (rate === "—" ? "暂无可统计场次" : rate)}>{rate}</p>
          <p className="mt-3 text-xs leading-5 text-slate-500">统计 {summary.total} 个已结束场次，有效状态为「请假」的场次不计入分母；已取消的场次不计入统计。</p>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3">{counts.map((count) => <div key={count.status} className={"rounded-xl px-4 py-3 " + count.classes}>
          <dt className="text-sm font-medium">{count.label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count.value}</dd>
        </div>)}</dl>
        <div className="mt-6 border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">最近出勤记录</h3>
          {dashboard.recentRecords.length === 0 ? <p className="mt-3 text-sm leading-6 text-slate-500">还没有已结束场次的出勤记录。</p> : <ul className="mt-2 divide-y divide-slate-100">{dashboard.recentRecords.map((entry) => <li key={entry.meeting.id} className="py-3">
            <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-slate-800">{entry.meeting.title}</p><StatusBadge status={entry.status} /></div>
            <p className="mt-1 text-xs leading-5 text-slate-500"><time dateTime={entry.meeting.startsAt}>{formatClubDateTime(entry.meeting.startsAt, timeZone)}</time></p>
            {entry.attendance?.checkedInAt && <p className="mt-1 text-xs text-slate-500">签到：<time dateTime={entry.attendance.checkedInAt}>{formatClubDateTime(entry.attendance.checkedInAt, timeZone)}</time></p>}
            {entry.attendance?.note && <p className="mt-1 break-words text-xs leading-5 text-slate-600">老师备注：{entry.attendance.note}</p>}
          </li>)}</ul>}
        </div>
      </section>
    </div>

    <section aria-labelledby="member-leaves-title" className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="member-leaves-title" className="text-lg font-semibold text-slate-900">请假记录</h2>
        <span className="text-xs text-slate-500">最近 20 条申请</span>
      </div>
      {dashboard.leaveRequests.length === 0 ? <div className="mt-5 rounded-xl bg-slate-50 px-5 py-7 text-center">
        <p className="font-medium text-slate-700">暂无请假记录</p>
        <p className="mt-2 text-sm text-slate-500">需要请假时，可在「接下来」的对应场次中提交。</p>
      </div> : <ul className="mt-3 divide-y divide-slate-100">{dashboard.leaveRequests.map((leave) => <li key={leave.id} className="py-5 last:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">{leave.meetingTitle}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500"><time dateTime={leave.meetingStartsAt}>{formatClubDateTime(leave.meetingStartsAt, timeZone)}</time></p>
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-slate-600">{leaveTypeLabel[leave.leaveType]}</span><StatusBadge status={leave.status} leave />{leave.lateSubmission && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">补交</span>}</div>
        </div>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{leave.reason}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">提交于 <time dateTime={leave.createdAt}>{formatClubDateTime(leave.createdAt, timeZone)}</time></p>
        {leave.reviewComment && <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700"><span className="font-semibold">老师意见：</span><span className="whitespace-pre-wrap break-words">{leave.reviewComment}</span></div>}
        {leave.reviewedAt && <p className="mt-2 text-xs text-slate-500">审批于 <time dateTime={leave.reviewedAt}>{formatClubDateTime(leave.reviewedAt, timeZone)}</time></p>}
        {leave.status === "pending" && <div className="mt-4"><CancelLeaveButton leaveId={leave.id} /></div>}
      </li>)}</ul>}
    </section>
  </AppShell>;
}
