import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Countdown } from "@/components/attendance/countdown";
import { panelClass, secondaryClass } from "@/components/attendance/form-styles";
import { StatusBadge, leaveTypeLabel } from "@/components/attendance/status-badge";
import { MeetingActions, MeetingForm, ReviewLeave } from "@/components/attendance/teacher-forms";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { getTeacherDashboard } from "@/lib/attendance/service";
import { formatClubDateTime, getClubTimeZone } from "@/lib/attendance/time";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function TeacherHomePage() {
  const user = await requireRole("teacher");
  const now = new Date();
  const result = await getTeacherDashboard(user, { repository: createSupabaseAttendanceRepository(createAdminClient()), now });
  if (!result.ok) throw new Error("Dashboard unavailable");
  const { dashboard } = result;
  const next = dashboard.upcomingMeetings.find((entry) => entry.phase === "upcoming");
  const allMeetings = [...dashboard.upcomingMeetings, ...dashboard.recentMeetings];
  return <AppShell title="老师控制台" user={user}>
    <section aria-labelledby="current-heading" className="space-y-4">
      <div className="flex items-baseline justify-between gap-3"><h2 id="current-heading" className="text-lg font-semibold text-slate-900">当前签到</h2><span className="text-xs text-slate-600">时间：{getClubTimeZone()}</span></div>
      {dashboard.openMeetings.length ? <div className="grid gap-4 lg:grid-cols-2">{dashboard.openMeetings.map(({ meeting, checkedInCount, rosterCount }) => <article key={meeting.id} className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">{meeting.title}</h3><StatusBadge status="open" /></div>
        <p className="mt-2 text-sm text-slate-600">{meeting.location || "地点待定"} · {formatClubDateTime(meeting.startsAt)}</p>
        <p className="mt-6 text-xs font-semibold tracking-wider text-slate-600">六位签到码</p><p className="my-2 font-mono text-5xl font-bold tracking-[0.18em] text-indigo-700 sm:text-6xl">{meeting.checkinCode}</p>
        <div className="my-5 text-sm text-slate-700"><Countdown until={meeting.endsAt} now={now.toISOString()} refresh /><p className="mt-2">已签到 <strong>{checkedInCount}</strong> / {rosterCount} 人</p><progress className="mt-2 h-2 w-full accent-indigo-600" value={checkedInCount} max={Math.max(1, rosterCount)} aria-label="签到进度" /></div>
        <div className="mb-3 flex flex-wrap gap-2"><Link className={secondaryClass} href={`/teacher/meetings/${meeting.id}`}>查看名单</Link><Link className={secondaryClass} target="_blank" rel="noopener noreferrer" href={`/teacher/meetings/${meeting.id}/display`}>投影模式 ↗</Link></div><MeetingActions meetingId={meeting.id} />
      </article>)}</div> : <div className={panelClass}><p className="font-medium text-slate-700">当前没有开放签到的场次。</p>{next ? <div className="mt-3 space-y-1 text-sm text-slate-600"><p>下一场：{next.meeting.title} · {formatClubDateTime(next.meeting.startsAt)}</p><Countdown label="距离签到开放" until={new Date(Date.parse(next.meeting.startsAt) - 15 * 60_000).toISOString()} now={now.toISOString()} refresh /></div> : <p className="mt-2 text-sm text-slate-600">在下方新建场次，安排下一次社团活动。</p>}</div>}
    </section>
    <section className={panelClass} aria-labelledby="leave-heading"><h2 id="leave-heading" className="mb-4 text-lg font-semibold">待审批请假 <span className="text-indigo-700">{dashboard.pendingLeaves.length}</span></h2>
      {!dashboard.pendingLeaves.length ? <p className="text-sm text-slate-600">暂无待审批申请。</p> : <ul className="divide-y divide-slate-200">{dashboard.pendingLeaves.map((leave) => <li key={leave.id} className="flex flex-col justify-between gap-4 py-4 sm:flex-row"><div className="min-w-0"><p className="font-semibold">{leave.memberName} <span className="ml-2 text-sm font-normal text-slate-600">{leaveTypeLabel[leave.leaveType]}</span>{leave.lateSubmission && <span className="ml-2 text-xs font-semibold text-amber-800">补交申请</span>}</p><Link href={`/teacher/meetings/${leave.meetingId}`} className="mt-1 block text-sm text-indigo-700 underline">{leave.meetingTitle}</Link><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{leave.reason}</p><p className="mt-2 text-xs text-slate-500">申请于 {formatClubDateTime(leave.createdAt)}</p></div><ReviewLeave leaveId={leave.id} /></li>)}</ul>}
    </section>
    <section className={panelClass} aria-labelledby="new-heading"><h2 id="new-heading" className="mb-5 text-lg font-semibold">新建场次</h2><MeetingForm /></section>
    <section id="meetings" className={panelClass} aria-labelledby="meetings-heading"><h2 id="meetings-heading" className="mb-4 text-lg font-semibold">场次管理</h2><p className="mb-4 text-sm text-slate-600">全部未结束场次与最近 20 场历史记录。</p>
      {!allMeetings.length ? <p className="text-sm text-slate-600">暂无场次，创建后将在这里显示。</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-200 text-slate-600"><tr><th className="p-3">场次与地点</th><th className="p-3">开始时间</th><th className="p-3">状态</th><th className="p-3">已到／迟到／请假／缺勤</th><th className="p-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{allMeetings.map(({ meeting, phase, summary }) => <tr key={meeting.id}><td className="p-3"><p className="font-medium">{meeting.title}</p><p className="mt-1 text-xs text-slate-600">{meeting.location || "地点待定"}</p></td><td className="whitespace-nowrap p-3">{formatClubDateTime(meeting.startsAt)}</td><td className="p-3"><StatusBadge status={phase} /></td><td className="p-3 tabular-nums">{phase === "cancelled" ? "—" : `${summary.present} / ${summary.late} / ${summary.excused} / ${summary.absent}`}</td><td className="p-3"><Link className="whitespace-nowrap font-semibold text-indigo-700 underline" href={`/teacher/meetings/${meeting.id}`}>查看详情<span className="sr-only">：{meeting.title}</span></Link></td></tr>)}</tbody></table></div>}
    </section>
  </AppShell>;
}
