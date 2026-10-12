import { CHECKIN_OPENS_BEFORE_MINUTES } from "@/lib/attendance/constants";
import type { AttendanceSummary, EffectiveStatus, MeetingPhase } from "@/lib/attendance/types";

type MeetingTime = { startsAt: string; endsAt: string; cancelledAt: string | null };

export function meetingPhase(meeting: MeetingTime, now: Date): MeetingPhase {
  if (meeting.cancelledAt !== null) return "cancelled";
  const timestamp = now.getTime();
  if (timestamp >= Date.parse(meeting.endsAt)) return "closed";
  if (timestamp >= Date.parse(meeting.startsAt) - CHECKIN_OPENS_BEFORE_MINUTES * 60_000) return "open";
  return "upcoming";
}

export function effectiveStatus(
  record: { status: Exclude<EffectiveStatus, "pending"> } | null | undefined,
  leave: { status: string } | null | undefined,
  meeting: MeetingTime,
  now: Date,
): EffectiveStatus {
  if (record) return record.status;
  if (leave?.status === "approved") return "excused";
  return meetingPhase(meeting, now) === "closed" ? "absent" : "pending";
}

/** Supply concluded, non-cancelled roster entries for an attendance-rate report. */
export function summarize(statuses: EffectiveStatus[]): AttendanceSummary {
  const result: AttendanceSummary = { present: 0, late: 0, excused: 0, absent: 0, pending: 0, total: statuses.length, attendanceRate: null };
  for (const status of statuses) result[status]++;
  const denominator = result.present + result.late + result.absent;
  result.attendanceRate = denominator > 0 ? (result.present + result.late) / denominator : null;
  return result;
}
