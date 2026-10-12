import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Countdown } from "@/components/attendance/countdown";
import { StatusBadge, leaveTypeLabel } from "@/components/attendance/status-badge";
import { AttendanceEditor, MeetingActions, MeetingForm, ReviewLeave } from "@/components/attendance/teacher-forms";
import { requireRole } from "@/lib/auth/guards";
import { CHECKIN_OPENS_BEFORE_MINUTES } from "@/lib/attendance/constants";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { getMeetingDetail } from "@/lib/attendance/service";
import { formatClubDateTime, getClubTimeZone, toClubDateTimeParts } from "@/lib/attendance/time";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function TeacherMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("teacher");
  const { id } = await params;
  const now = new Date();
  const result = await getMeetingDetail(id, user, {
    repository: createSupabaseAttendanceRepository(createAdminClient()), now,
  });
  if (!result.ok) notFound();

  const { meeting, phase, summary, roster } = result.detail;
  const zone = getClubTimeZone();
  const start = toClubDateTimeParts(meeting.startsAt, zone);
  const end = toClubDateTimeParts(meeting.endsAt, zone);
  const canEditMeeting = phase === "upcoming";
  const canManageMeeting = phase === "upcoming" || phase === "open";
  const canEditAttendance = phase !== "upcoming" && phase !== "cancelled";
  const opensAt = new Date(Date.parse(meeting.startsAt) - CHECKIN_OPENS_BEFORE_MINUTES * 60_000).toISOString();
  const statistics = [
    ["已到", summary.present, "text-emerald-800"],
    ["迟到", summary.late, "text-amber-900"],
    ["请假", summary.excused, "text-sky-800"],
    ["缺勤", summary.absent, "text-rose-800"],
    ["未签到", summary.pending, "text-slate-700"],
  ] as const;

  return <AppShell title="场次详情" user={user}>
    <Link href="/teacher#meetings" className="inline-block text-sm font-semibold text-indigo-700 underline-offset-4 hover:underline">返回场次列表</Link>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="meeting-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3"><StatusBadge status={phase} /></div>
          <h2 id="meeting-heading" className="text-2xl font-semibold text-slate-900">{meeting.title}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">{formatClubDateTime(meeting.startsAt, zone)} — {formatClubDateTime(meeting.endsAt, zone)}</p>
          <p className="text-sm leading-6 text-slate-600">地点：{meeting.location || "未填写"} · 迟到阈值：开始后 {meeting.lateAfterMinutes} 分钟</p>
          <p className="mt-1 text-xs text-slate-500">俱乐部时区：{zone} · 签到于 {formatClubDateTime(opensAt, zone)} 开放</p>
        </div>
        <Link href={`/teacher/meetings/${meeting.id}/display`} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">投屏展示（新窗口）</Link>
      </div>
      <div className="mt-6 grid gap-6 rounded-xl bg-indigo-50 p-5 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-indigo-900">本场签到码</p>
          {canManageMeeting ? <>
            <p className="mt-2 text-5xl font-bold tracking-[0.15em] text-indigo-700 tabular-nums sm:text-6xl">{meeting.checkinCode}</p>
            <div className="mt-3 text-sm text-indigo-900"><Countdown until={phase === "upcoming" ? opensAt : meeting.endsAt} now={now.toISOString()} label={phase === "upcoming" ? "距离签到开放" : "剩余签到时间"} /></div>
          </> : <p className="mt-3 font-medium text-slate-700">{phase === "cancelled" ? "场次已取消，签到码已停用。" : "场次已结束，签到码已停用。"}</p>}
          <p className="mt-3 text-sm text-indigo-900">已签到 {summary.present + summary.late} / {roster.length} 人</p>
        </div>
        <div className="self-center"><MeetingActions meetingId={meeting.id} disabled={!canManageMeeting} /></div>
      </div>
    </section>

    <section aria-label="场次出勤统计" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {statistics.map(([label, count, color]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">{label}</p><p className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{count}</p></div>)}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">出勤率</p><p className="mt-2 text-3xl font-semibold text-indigo-700">{summary.attendanceRate === null ? "—" : `${Math.round(summary.attendanceRate * 100)}%`}</p><p className="mt-1 text-xs text-slate-500">已结束场次计入统计</p></div>
    </section>
    {phase === "cancelled" && <p className="text-sm text-slate-600">已取消场次保留历史记录，不计入出勤统计。</p>}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="edit-heading">
      <h2 id="edit-heading" className="mb-4 text-lg font-semibold text-slate-900">编辑场次</h2>
      {!canEditMeeting && <p className="mb-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{phase === "cancelled" ? "场次已取消，不能修改场次信息。" : "签到窗口已开放，不能再修改场次信息。"}</p>}
      <MeetingForm key={meeting.updatedAt} meetingId={meeting.id} disabled={!canEditMeeting} initial={{
        title: meeting.title, location: meeting.location ?? "", date: start.date,
        startTime: start.time, endTime: end.time, lateAfterMinutes: meeting.lateAfterMinutes,
      }} />
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="roster-heading">
      <h2 id="roster-heading" className="text-lg font-semibold text-slate-900">成员名单 · {roster.length} 人</h2>
      <p className="mt-2 text-sm text-slate-600">名单包含场次结束前已创建的当前启用成员。老师登记优先于请假与自动计算状态。</p>
      {!canEditAttendance && <p className="mt-2 text-sm text-slate-600">{phase === "cancelled" ? "场次已取消，不能修改出勤登记。" : "签到窗口开放后，老师可以修改出勤登记。"}</p>}
      {roster.length === 0 ? <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600">本场次暂无符合条件的成员。</p> : <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
          <caption className="sr-only">{meeting.title}的成员出勤与请假登记</caption>
          <thead><tr className="border-b border-slate-200 text-slate-600">{["成员", "有效状态", "签到时间", "请假信息", "备注", "登记操作"].map((label) => <th key={label} scope="col" className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
          <tbody>{roster.map((entry) => {
            const leave = entry.leave;
            const lateSubmission = leave !== null && Date.parse(leave.createdAt) >= Date.parse(meeting.startsAt);
            return <tr key={entry.member.id} className="border-b border-slate-100 align-top last:border-0">
              <th scope="row" className="px-3 py-5 font-medium text-slate-900">{entry.member.name}<span className="mt-1 block text-xs font-normal text-slate-500">{entry.member.username}</span></th>
              <td className="px-3 py-5"><StatusBadge status={entry.status} /></td>
              <td className="px-3 py-5 text-slate-600">{entry.checkedInAt ? formatClubDateTime(entry.checkedInAt, zone) : "—"}</td>
              <td className="max-w-xs px-3 py-5">{leave ? <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-800">{leaveTypeLabel[leave.leaveType]}</span><StatusBadge status={leave.status} leave />{lateSubmission && <span className="text-xs font-semibold text-amber-900">补交</span>}</div>
                <p className="whitespace-pre-wrap break-words text-slate-700">{leave.reason}</p>
                <p className="text-xs text-slate-500">提交：{formatClubDateTime(leave.createdAt, zone)}</p>
                {leave.reviewComment && <p className="whitespace-pre-wrap break-words text-slate-700">老师意见：{leave.reviewComment}</p>}
                {leave.reviewedAt && <p className="text-xs text-slate-500">审批：{formatClubDateTime(leave.reviewedAt, zone)}</p>}
                {leave.status === "pending" && phase !== "cancelled" && <ReviewLeave leaveId={leave.id} />}
              </div> : <span className="text-slate-500">无请假申请</span>}</td>
              <td className="max-w-48 whitespace-pre-wrap break-words px-3 py-5 text-slate-700">{entry.note || "—"}</td>
              <td className="px-3 py-5"><AttendanceEditor key={`${entry.status}-${entry.note}`} meetingId={meeting.id} userId={entry.member.id} currentStatus={entry.status} initialNote={entry.note ?? ""} disabled={!canEditAttendance} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </section>
  </AppShell>;
}
