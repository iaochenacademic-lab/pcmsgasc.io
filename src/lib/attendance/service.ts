import "server-only";
import type { SessionPayload, UserRole } from "@/lib/auth/types";
import { generateCheckinCode } from "@/lib/attendance/code";
import { effectiveStatus, meetingPhase, summarize } from "@/lib/attendance/status";
import { getClubTimeZone, zonedLocalToUtc } from "@/lib/attendance/time";
import {
  isUuid, parseLeaveInput, parseMeetingInput, parseOverrideInput, parseReviewInput,
  type FieldErrors,
} from "@/lib/attendance/validation";
import type {
  AttendanceFailureReason, AttendanceMutationResult, AttendanceRecord, AttendanceRepository,
  AttendanceSummary, LeaveRequest, LeaveView, Meeting, MeetingDetail, MeetingFields,
  MeetingRosterEntry, MemberDashboard, MemberMeetingView, RosterMember,
  TeacherDashboard, TeacherMeeting, TeacherMeetingOverview,
} from "@/lib/attendance/types";

export interface AttendanceDependencies {
  repository: AttendanceRepository;
  now?: Date | (() => Date);
  timeZone?: string;
}
export type ServiceFailure = {
  ok: false;
  reason: AttendanceFailureReason | "wrong_code" | "too_many_attempts";
  fieldErrors?: FieldErrors;
  remainingAttempts?: number | null;
};
export type ServiceResult<T extends object> = ({ ok: true } & T) | ServiceFailure;
export type MutationResult = ServiceResult<{
  meetingId?: string;
  leaveId?: string;
  lateSubmission?: boolean;
  status?: "present" | "late";
  remainingAttempts?: number | null;
}>;

const DAY = 86_400_000;
function nowFor(deps: AttendanceDependencies): Date {
  return typeof deps.now === "function" ? deps.now() : deps.now ?? new Date();
}
function allowed(actor: SessionPayload, role: UserRole): boolean {
  return actor.role === role && !actor.mustChangePassword;
}
function failure(reason: ServiceFailure["reason"]): ServiceFailure {
  return { ok: false, reason };
}
function invalid(fieldErrors: FieldErrors): ServiceFailure {
  return { ok: false, reason: "invalid_input", fieldErrors };
}
function invalidId(id: unknown, field = "id"): ServiceFailure | null {
  return isUuid(id) ? null : invalid({ [field]: "编号格式不正确。" });
}

function mapMutation(result: AttendanceMutationResult): MutationResult {
  switch (result.result) {
    case "created": return { ok: true, meetingId: result.meetingId };
    case "submitted": return { ok: true, leaveId: result.leaveId, lateSubmission: result.lateSubmission };
    case "present":
    case "late": return { ok: true, status: result.result, remainingAttempts: result.remainingAttempts };
    case "wrong_code":
    case "too_many_attempts": return { ok: false, reason: result.result, remainingAttempts: result.remainingAttempts };
    case "updated":
    case "meeting_cancelled":
    case "code_regenerated":
    case "saved":
    case "restored":
    case "reviewed":
    case "leave_cancelled": return { ok: true };
    default: return failure(result.result);
  }
}

function meetingFields(input: unknown, deps: AttendanceDependencies, now: Date): ServiceResult<{ data: MeetingFields }> {
  const parsed = parseMeetingInput(input);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const zone = deps.timeZone ?? getClubTimeZone();
  const fieldErrors: FieldErrors = {};
  let startsAt = "";
  let endsAt = "";
  try { startsAt = zonedLocalToUtc(parsed.value.date, parsed.value.startTime, zone); }
  catch (error) { fieldErrors.startTime = error instanceof RangeError ? error.message : "开始时间无效。"; }
  try { endsAt = zonedLocalToUtc(parsed.value.date, parsed.value.endTime, zone); }
  catch (error) { fieldErrors.endTime = error instanceof RangeError ? error.message : "结束时间无效。"; }
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (end <= start || end - start > 12 * 60 * 60_000) fieldErrors.endTime = "结束须晚于开始，且总时长不能超过 12 小时。";
  if (start < now.getTime() - 7 * DAY || start > now.getTime() + 365 * DAY) fieldErrors.date = "开始时间须在过去 7 天至未来 365 天内。";
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);
  return { ok: true, data: { title: parsed.value.title, location: parsed.value.location, startsAt, endsAt, lateAfterMinutes: parsed.value.lateAfterMinutes } };
}

async function teacherMeeting(id: string, deps: AttendanceDependencies) {
  return (await deps.repository.listTeacherMeetings()).find((entry) => entry.id === id) ?? null;
}
async function memberMeeting(id: string, deps: AttendanceDependencies) {
  return (await deps.repository.listMemberMeetings()).find((entry) => entry.id === id) ?? null;
}
function activeBeforeEnd(member: RosterMember, meeting: Meeting): boolean {
  return Date.parse(member.createdAt) < Date.parse(meeting.endsAt);
}
async function eligibleMember(userId: string, meeting: Meeting, deps: AttendanceDependencies): Promise<boolean> {
  return (await deps.repository.listActiveMembers()).some((entry) => entry.id === userId && activeBeforeEnd(entry, meeting));
}
function openForChanges(meeting: Meeting, now: Date): ServiceFailure | null {
  if (meeting.cancelledAt !== null) return failure("cancelled");
  if (now.getTime() >= Date.parse(meeting.endsAt)) return failure("closed");
  return null;
}

export async function createMeeting(input: unknown, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "teacher")) return failure("forbidden");
  const fields = meetingFields(input, deps, nowFor(deps));
  if (!fields.ok) return fields;
  return mapMutation(await deps.repository.createMeeting(actor, { ...fields.data, checkinCode: generateCheckinCode() }));
}

export async function updateMeeting(id: string, input: unknown, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "teacher")) return failure("forbidden");
  const invalidIdentifier = invalidId(id);
  if (invalidIdentifier) return invalidIdentifier;
  const now = nowFor(deps);
  const fields = meetingFields(input, deps, now);
  if (!fields.ok) return fields;
  const meeting = await teacherMeeting(id, deps);
  if (!meeting) return failure("not_found");
  if (meeting.cancelledAt !== null) return failure("cancelled");
  if (meetingPhase(meeting, now) !== "upcoming") return failure("not_editable");
  return mapMutation(await deps.repository.manageMeeting(actor, id, { action: "update", data: fields.data }));
}

export async function cancelMeeting(id: string, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "teacher")) return failure("forbidden");
  const invalidIdentifier = invalidId(id);
  if (invalidIdentifier) return invalidIdentifier;
  const meeting = await teacherMeeting(id, deps);
  if (!meeting) return failure("not_found");
  const blocked = openForChanges(meeting, nowFor(deps));
  if (blocked) return blocked;
  return mapMutation(await deps.repository.manageMeeting(actor, id, { action: "cancel" }));
}

export async function regenerateCode(id: string, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "teacher")) return failure("forbidden");
  const invalidIdentifier = invalidId(id);
  if (invalidIdentifier) return invalidIdentifier;
  const meeting = await teacherMeeting(id, deps);
  if (!meeting) return failure("not_found");
  const blocked = openForChanges(meeting, nowFor(deps));
  if (blocked) return blocked;
  return mapMutation(await deps.repository.manageMeeting(actor, id, { action: "regenerate_code", checkinCode: generateCheckinCode() }));
}

export async function setAttendance(meetingId: string, userId: string, input: unknown, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "teacher")) return failure("forbidden");
  const invalidIdentifier = invalidId(meetingId, "meetingId") ?? invalidId(userId, "userId");
  if (invalidIdentifier) return invalidIdentifier;
  const parsed = parseOverrideInput(input);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const meeting = await teacherMeeting(meetingId, deps);
  if (!meeting) return failure("not_found");
  const phase = meetingPhase(meeting, nowFor(deps));
  if (phase === "cancelled") return failure("cancelled");
  if (phase === "upcoming") return failure("not_open");
  if (!await eligibleMember(userId, meeting, deps)) return failure("forbidden");
  return mapMutation(await deps.repository.setAttendance(actor, meetingId, userId, parsed.value.status, parsed.value.note));
}

export async function reviewLeave(id: string, input: unknown, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "teacher")) return failure("forbidden");
  const invalidIdentifier = invalidId(id);
  if (invalidIdentifier) return invalidIdentifier;
  const parsed = parseReviewInput(input);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const leave = (await deps.repository.listLeaves()).find((entry) => entry.id === id);
  if (!leave) return failure("not_found");
  if (leave.status !== "pending") return failure("already_reviewed");
  return mapMutation(await deps.repository.reviewLeave(actor, id, parsed.value.decision, parsed.value.comment));
}

export async function checkIn(input: unknown, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "member")) return failure("forbidden");
  const candidate = typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const fieldErrors: FieldErrors = {};
  if (!isUuid(candidate.meetingId)) fieldErrors.meetingId = "场次编号不正确。";
  if (typeof candidate.code !== "string" || candidate.code.length !== 6 || !/^\d{6}$/.test(candidate.code)) fieldErrors.code = "签到码须为 6 位数字。";
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);
  const id = candidate.meetingId as string;
  const meeting = await memberMeeting(id, deps);
  if (!meeting) return failure("not_found");
  const phase = meetingPhase(meeting, nowFor(deps));
  if (phase === "cancelled") return failure("cancelled");
  if (phase === "closed") return failure("closed");
  if (phase === "upcoming") return failure("not_open");
  if (!await eligibleMember(actor.userId, meeting, deps)) return failure("forbidden");
  if ((await deps.repository.listAttendance([id], actor.userId)).length > 0) return failure("already_recorded");
  return mapMutation(await deps.repository.checkIn(actor, id, candidate.code as string));
}

export async function submitLeave(input: unknown, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "member")) return failure("forbidden");
  const parsed = parseLeaveInput(input);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const { meetingId, leaveType, reason } = parsed.value;
  const meeting = await memberMeeting(meetingId, deps);
  if (!meeting) return failure("not_found");
  const blocked = openForChanges(meeting, nowFor(deps));
  if (blocked) return blocked;
  if (!await eligibleMember(actor.userId, meeting, deps)) return failure("forbidden");
  const records = await deps.repository.listAttendance([meetingId], actor.userId);
  if (records.some((record) => record.status === "present" || record.status === "late")) return failure("already_recorded");
  const leaves = await deps.repository.listLeaves([meetingId], actor.userId);
  if (leaves.some((leave) => leave.status === "pending" || leave.status === "approved")) return failure("duplicate");
  return mapMutation(await deps.repository.submitLeave(actor, meetingId, leaveType, reason));
}

export async function cancelLeave(id: string, actor: SessionPayload, deps: AttendanceDependencies): Promise<MutationResult> {
  if (!allowed(actor, "member")) return failure("forbidden");
  const invalidIdentifier = invalidId(id);
  if (invalidIdentifier) return invalidIdentifier;
  const leave = (await deps.repository.listLeaves(undefined, actor.userId)).find((entry) => entry.id === id && entry.userId === actor.userId);
  if (!leave) return failure("not_found");
  if (leave.status !== "pending") return failure("already_reviewed");
  return mapMutation(await deps.repository.cancelLeave(actor, id));
}

function mostRelevantLeave(leaves: LeaveRequest[]): LeaveRequest | null {
  const priority = (leave: LeaveRequest) => leave.status === "approved" ? 2 : leave.status === "pending" ? 1 : 0;
  return [...leaves].sort((a, b) => priority(b) - priority(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}
function rosterFor(meeting: Meeting, members: RosterMember[], records: AttendanceRecord[], leaves: LeaveRequest[], now: Date): MeetingRosterEntry[] {
  return members.filter((member) => activeBeforeEnd(member, meeting)).map((member) => {
    const record = records.find((entry) => entry.meetingId === meeting.id && entry.userId === member.id);
    const leave = mostRelevantLeave(leaves.filter((entry) => entry.meetingId === meeting.id && entry.userId === member.id));
    return { member, status: effectiveStatus(record, leave, meeting, now), checkedInAt: record?.checkedInAt ?? null, leave, note: record?.note ?? null };
  }).sort((a, b) => a.member.name.localeCompare(b.member.name, "zh-CN"));
}
function summaryForMeeting(meeting: Meeting, roster: MeetingRosterEntry[], now: Date): AttendanceSummary {
  if (meeting.cancelledAt !== null) return summarize([]);
  const summary = summarize(roster.map((entry) => entry.status));
  if (meetingPhase(meeting, now) !== "closed") summary.attendanceRate = null;
  return summary;
}
function overview(meeting: TeacherMeeting, members: RosterMember[], records: AttendanceRecord[], leaves: LeaveRequest[], now: Date): TeacherMeetingOverview {
  const roster = rosterFor(meeting, members, records, leaves, now);
  return {
    meeting, phase: meetingPhase(meeting, now), rosterCount: roster.length,
    checkedInCount: roster.filter((entry) => entry.status === "present" || entry.status === "late").length,
    summary: summaryForMeeting(meeting, roster, now),
  };
}
function leaveView(leave: LeaveRequest, meeting: Meeting, memberName: string): LeaveView {
  return { ...leave, memberName, meetingTitle: meeting.title, meetingStartsAt: meeting.startsAt, lateSubmission: Date.parse(leave.createdAt) >= Date.parse(meeting.startsAt) };
}

export async function getTeacherDashboard(actor: SessionPayload, deps: AttendanceDependencies): Promise<ServiceResult<{ dashboard: TeacherDashboard }>> {
  if (!allowed(actor, "teacher")) return failure("forbidden");
  const now = nowFor(deps);
  const [meetings, members] = await Promise.all([deps.repository.listTeacherMeetings(), deps.repository.listActiveMembers()]);
  const [records, leaves] = await Promise.all([deps.repository.listAttendance(meetings.map((entry) => entry.id)), deps.repository.listLeaves()]);
  const meetingsById = new Map(meetings.map((entry) => [entry.id, entry]));
  const membersById = new Map(members.map((entry) => [entry.id, entry]));
  const entries = meetings.map((meeting) => overview(meeting, members, records, leaves, now));
  const pendingLeaves = leaves.filter((leave) => {
    const meeting = meetingsById.get(leave.meetingId);
    const member = membersById.get(leave.userId);
    return leave.status === "pending" && meeting && meeting.cancelledAt === null && member && activeBeforeEnd(member, meeting);
  }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map((leave) => leaveView(leave, meetingsById.get(leave.meetingId)!, membersById.get(leave.userId)!.name));
  const ascending = (a: TeacherMeetingOverview, b: TeacherMeetingOverview) => Date.parse(a.meeting.startsAt) - Date.parse(b.meeting.startsAt);
  return {
    ok: true, dashboard: {
      openMeetings: entries.filter((entry) => entry.phase === "open").sort(ascending),
      upcomingMeetings: entries.filter((entry) => Date.parse(entry.meeting.endsAt) > now.getTime()).sort(ascending),
      recentMeetings: entries.filter((entry) => Date.parse(entry.meeting.endsAt) <= now.getTime()).sort((a, b) => -ascending(a, b)).slice(0, 20),
      pendingLeaves,
    },
  };
}

export async function getMeetingDetail(id: string, actor: SessionPayload, deps: AttendanceDependencies): Promise<ServiceResult<{ detail: MeetingDetail }>> {
  if (!allowed(actor, "teacher")) return failure("forbidden");
  const invalidIdentifier = invalidId(id);
  if (invalidIdentifier) return invalidIdentifier;
  const meeting = await teacherMeeting(id, deps);
  if (!meeting) return failure("not_found");
  const [members, records, leaves] = await Promise.all([
    deps.repository.listActiveMembers(), deps.repository.listAttendance([id]), deps.repository.listLeaves([id]),
  ]);
  const now = nowFor(deps);
  const roster = rosterFor(meeting, members, records, leaves, now);
  return { ok: true, detail: { meeting, phase: meetingPhase(meeting, now), summary: summaryForMeeting(meeting, roster, now), roster } };
}

/** Explicit projection also protects callers if an adapter returns extra fields. */
function safeMeeting(meeting: Meeting): Meeting {
  return {
    id: meeting.id, title: meeting.title, location: meeting.location,
    startsAt: meeting.startsAt, endsAt: meeting.endsAt, lateAfterMinutes: meeting.lateAfterMinutes,
    cancelledAt: meeting.cancelledAt, createdBy: meeting.createdBy, createdAt: meeting.createdAt, updatedAt: meeting.updatedAt,
  };
}
export async function getMemberDashboard(actor: SessionPayload, deps: AttendanceDependencies): Promise<ServiceResult<{ dashboard: MemberDashboard }>> {
  if (!allowed(actor, "member")) return failure("forbidden");
  const now = nowFor(deps);
  const [allMeetings, members] = await Promise.all([deps.repository.listMemberMeetings(), deps.repository.listActiveMembers()]);
  const member = members.find((entry) => entry.id === actor.userId);
  if (!member) return failure("forbidden");
  const meetings = allMeetings.filter((meeting) => activeBeforeEnd(member, meeting)).map(safeMeeting);
  const [allRecords, allLeaves] = await Promise.all([
    deps.repository.listAttendance(meetings.map((entry) => entry.id), actor.userId),
    deps.repository.listLeaves(undefined, actor.userId),
  ]);
  // Keep the actor filter at this boundary as well as in the repository query.
  const records = allRecords.filter((entry) => entry.userId === actor.userId);
  const leaves = allLeaves.filter((entry) => entry.userId === actor.userId);
  const byId = new Map(meetings.map((entry) => [entry.id, entry]));
  const entries: MemberMeetingView[] = meetings.map((meeting) => {
    const attendance = records.find((entry) => entry.meetingId === meeting.id) ?? null;
    const leave = mostRelevantLeave(leaves.filter((entry) => entry.meetingId === meeting.id));
    return { meeting, attendance, leave, phase: meetingPhase(meeting, now), status: effectiveStatus(attendance, leave, meeting, now) };
  });
  const concluded = entries.filter((entry) => entry.phase === "closed").sort((a, b) => Date.parse(b.meeting.endsAt) - Date.parse(a.meeting.endsAt));
  const ascending = (a: MemberMeetingView, b: MemberMeetingView) => Date.parse(a.meeting.startsAt) - Date.parse(b.meeting.startsAt);
  return {
    ok: true, dashboard: {
      openMeetings: entries.filter((entry) => entry.phase === "open" && !entry.attendance).sort(ascending),
      upcomingMeetings: entries.filter((entry) => Date.parse(entry.meeting.endsAt) > now.getTime() && Date.parse(entry.meeting.startsAt) <= now.getTime() + 14 * DAY).sort(ascending),
      recentRecords: concluded.slice(0, 10),
      summary: summarize(concluded.map((entry) => entry.status)),
      leaveRequests: leaves.filter((leave) => byId.has(leave.meetingId)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20).map((leave) => leaveView(leave, byId.get(leave.meetingId)!, member.name)),
    },
  };
}
