import { notFound } from "next/navigation";
import { Countdown } from "@/components/attendance/countdown";
import { requireRole } from "@/lib/auth/guards";
import { CHECKIN_OPENS_BEFORE_MINUTES } from "@/lib/attendance/constants";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { getMeetingDetail } from "@/lib/attendance/service";
import { formatClubDateTime, getClubTimeZone } from "@/lib/attendance/time";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function MeetingDisplayPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("teacher");
  const { id } = await params;
  const now = new Date();
  const result = await getMeetingDetail(id, user, {
    repository: createSupabaseAttendanceRepository(createAdminClient()), now,
  });
  if (!result.ok) notFound();

  const { meeting, phase, summary, roster } = result.detail;
  const zone = getClubTimeZone();
  const opensAt = new Date(Date.parse(meeting.startsAt) - CHECKIN_OPENS_BEFORE_MINUTES * 60_000).toISOString();
  const checkedIn = summary.present + summary.late;

  return <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-5 py-10 text-center text-white sm:px-12">
    <p className="text-sm font-semibold tracking-[0.25em] text-indigo-300">CLUB PORTAL</p>
    <h1 className="mt-5 max-w-6xl text-3xl font-semibold leading-tight sm:text-5xl">{meeting.title}</h1>
    <p className="mt-5 text-base leading-7 text-slate-300 sm:text-2xl">{formatClubDateTime(meeting.startsAt, zone)} — {formatClubDateTime(meeting.endsAt, zone)}</p>
    <p className="mt-2 text-base text-slate-300 sm:text-2xl">地点：{meeting.location || "未填写"}</p>

    {phase === "open" ? <section className="my-10 w-full" aria-label="正在签到">
      <h2 className="text-xl font-medium text-indigo-200 sm:text-3xl">请在成员首页输入签到码</h2>
      <p className="mt-2 whitespace-nowrap text-[clamp(4.5rem,18vw,20rem)] leading-none font-bold tracking-[0.08em] text-white tabular-nums" aria-label={`签到码 ${meeting.checkinCode.split("").join(" ")}`}>{meeting.checkinCode}</p>
    </section> : <section className="my-14" role="status">
      <h2 className="text-4xl font-semibold text-indigo-200 sm:text-7xl">{phase === "upcoming" ? "签到尚未开放" : phase === "cancelled" ? "场次已取消" : "签到已结束"}</h2>
      <p className="mt-6 text-lg leading-8 text-slate-300 sm:text-2xl">{phase === "upcoming" ? `将于 ${formatClubDateTime(opensAt, zone)} 开放签到。` : phase === "cancelled" ? "本场次不再接受签到。" : "本场次签到窗口已关闭。"}</p>
    </section>}

    <div className="space-y-4 text-xl text-slate-200 sm:text-3xl">
      {phase === "open" || phase === "upcoming" ? <Countdown until={phase === "upcoming" ? opensAt : meeting.endsAt} now={now.toISOString()} refresh label={phase === "upcoming" ? "距离签到开放" : "剩余签到时间"} /> : <div className="hidden" aria-hidden="true"><Countdown until={meeting.endsAt} now={now.toISOString()} refresh /></div>}
      <p>已签到 <span className="font-bold text-emerald-300 tabular-nums">{checkedIn}</span> / <span className="tabular-nums">{roster.length}</span> 人</p>
    </div>
    <p className="mt-8 text-sm text-slate-400">每 10 秒自动更新 · 时间按 {zone} 显示</p>
  </main>;
}
