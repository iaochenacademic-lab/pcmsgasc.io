import { describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/types";
import type { AttendanceRecord, AttendanceRepository, LeaveRequest, RosterMember, TeacherMeeting } from "@/lib/attendance/types";
import {
  cancelLeave, cancelMeeting, checkIn, createMeeting, getMeetingDetail,
  getMemberDashboard, getTeacherDashboard, regenerateCode, reviewLeave,
  setAttendance, submitLeave, updateMeeting,
} from "@/lib/attendance/service";

const teacher: SessionPayload = { userId: "11111111-1111-4111-8111-111111111111", username: "teacher", name: "老师", role: "teacher", mustChangePassword: false, sessionVersion: 1 };
const member: SessionPayload = { ...teacher, userId: "22222222-2222-4222-8222-222222222222", username: "member", name: "成员", role: "member" };
const meetingId = "33333333-3333-4333-8333-333333333333";
const leaveId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-10-12T07:30:00Z");
const meetingInput = { title: "社团活动", location: "教室", date: "2026-10-12", startTime: "15:30", endTime: "16:30" };
const meeting: TeacherMeeting = { id: meetingId, ...{ title: "社团活动", location: "教室" }, startsAt: now.toISOString(), endsAt: "2026-10-12T08:30:00Z", lateAfterMinutes: 10, checkinCode: "123456", cancelledAt: null, createdBy: teacher.userId, createdAt: "2026-10-01T00:00Z", updatedAt: "2026-10-01T00:00Z" };
const rosterMember: RosterMember = { id: member.userId, username: member.username, name: member.name, createdAt: "2026-10-01T00:00Z" };
const leave: LeaveRequest = { id: leaveId, meetingId, userId: member.userId, leaveType: "sick", reason: "生病", status: "pending", reviewedBy: null, reviewComment: null, reviewedAt: null, createdAt: "2026-10-12T07:35:00Z", updatedAt: "2026-10-12T07:35:00Z" };
const attendance: AttendanceRecord = { id: "55555555-5555-4555-8555-555555555555", meetingId, userId: member.userId, status: "present", checkedInAt: now.toISOString(), source: "self", note: null, updatedBy: member.userId, createdAt: now.toISOString(), updatedAt: now.toISOString() };

function memory(options: { meetings?: TeacherMeeting[]; members?: RosterMember[]; records?: AttendanceRecord[]; leaves?: LeaveRequest[] } = {}) {
  const meetings = options.meetings ?? [{ ...meeting }];
  const members = options.members ?? [{ ...rosterMember }];
  const records = options.records ?? [];
  const leaves = options.leaves ?? [];
  const repository: AttendanceRepository = {
    createMeeting: vi.fn<AttendanceRepository["createMeeting"]>(async (_actor, data) => { meetings.push({ ...meeting, ...data }); return { result: "created", meetingId }; }),
    manageMeeting: vi.fn<AttendanceRepository["manageMeeting"]>(async (_actor, id, action) => {
      const target = meetings.find((entry) => entry.id === id)!;
      if (action.action === "update") { Object.assign(target, action.data); return { result: "updated" }; }
      if (action.action === "regenerate_code") { target.checkinCode = action.checkinCode; return { result: "code_regenerated" }; }
      target.cancelledAt = now.toISOString();
      leaves.filter((entry) => entry.meetingId === id && entry.status === "pending").forEach((entry) => { entry.status = "cancelled"; });
      return { result: "meeting_cancelled" };
    }),
    setAttendance: vi.fn<AttendanceRepository["setAttendance"]>(async (_actor, id, userId, status, note) => {
      const index = records.findIndex((entry) => entry.meetingId === id && entry.userId === userId);
      if (index >= 0) records.splice(index, 1);
      if (status) records.push({ ...attendance, meetingId: id, userId, status, source: "teacher", note, updatedBy: teacher.userId });
      return { result: status ? "saved" : "restored" };
    }),
    checkIn: vi.fn<AttendanceRepository["checkIn"]>(async () => ({ result: "present", remainingAttempts: null })),
    submitLeave: vi.fn<AttendanceRepository["submitLeave"]>(async (_actor, id, leaveType, reason) => {
      leaves.push({ ...leave, meetingId: id, leaveType, reason });
      return { result: "submitted", leaveId, lateSubmission: true };
    }),
    reviewLeave: vi.fn<AttendanceRepository["reviewLeave"]>(async (_actor, id, decision, comment) => {
      Object.assign(leaves.find((entry) => entry.id === id)!, { status: decision, reviewComment: comment });
      return { result: "reviewed" };
    }),
    cancelLeave: vi.fn<AttendanceRepository["cancelLeave"]>(async (_actor, id) => {
      leaves.find((entry) => entry.id === id)!.status = "cancelled";
      return { result: "leave_cancelled" };
    }),
    listTeacherMeetings: vi.fn<AttendanceRepository["listTeacherMeetings"]>(async () => meetings),
    // Deliberately include an extra checkinCode property to verify service DTO stripping too.
    listMemberMeetings: vi.fn<AttendanceRepository["listMemberMeetings"]>(async () => meetings),
    listActiveMembers: vi.fn<AttendanceRepository["listActiveMembers"]>(async () => members),
    listAttendance: vi.fn<AttendanceRepository["listAttendance"]>(async (ids, userId) => records.filter((entry) => ids.includes(entry.meetingId) && (!userId || entry.userId === userId))),
    listLeaves: vi.fn<AttendanceRepository["listLeaves"]>(async (ids, userId) => leaves.filter((entry) => (!ids || ids.includes(entry.meetingId)) && (!userId || entry.userId === userId))),
  };
  return { repository, meetings, members, records, leaves, deps: { repository, now, timeZone: "Asia/Shanghai" } };
}

describe("teacher attendance services", () => {
  it("creates a zoned meeting with a six-digit generated code", async () => {
    const { repository, deps } = memory();
    expect(await createMeeting(meetingInput, teacher, deps)).toEqual({ ok: true, meetingId });
    expect(repository.createMeeting).toHaveBeenCalledWith(teacher, expect.objectContaining({
      startsAt: "2026-10-12T07:30:00.000Z", endsAt: "2026-10-12T08:30:00.000Z", lateAfterMinutes: 10, checkinCode: expect.stringMatching(/^\d{6}$/),
    }));
  });

  it.each([
    { ...meetingInput, date: "2026-10-04" }, { ...meetingInput, date: "2027-10-13" },
    { ...meetingInput, endTime: "15:30" }, { ...meetingInput, startTime: "00:00", endTime: "13:00" },
  ])("rejects an invalid meeting time range", async (input) => {
    const { repository, deps } = memory();
    expect(await createMeeting(input, teacher, deps)).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(repository.createMeeting).not.toHaveBeenCalled();
  });

  it("rejects DST gap and overlap fields", async () => {
    const { deps } = memory();
    for (const date of ["2026-03-08", "2026-11-01"]) {
      const result = await createMeeting({ ...meetingInput, date, startTime: date.includes("03-") ? "02:30" : "01:30", endTime: "03:30" }, teacher, { ...deps, now: new Date(date + "T00:00Z"), timeZone: "America/New_York" });
      expect(result).toMatchObject({ ok: false, reason: "invalid_input", fieldErrors: { startTime: expect.any(String) } });
    }
  });

  it("updates only before the check-in window opens", async () => {
    const { deps, repository } = memory();
    expect(await updateMeeting(meetingId, meetingInput, teacher, { ...deps, now: new Date("2026-10-12T07:14Z") })).toEqual({ ok: true });
    expect(repository.manageMeeting).toHaveBeenCalledWith(teacher, meetingId, expect.objectContaining({ action: "update" }));
    expect(await updateMeeting(meetingId, meetingInput, teacher, deps)).toEqual({ ok: false, reason: "not_editable" });
  });

  it("cancels a meeting and its pending leave without touching approved leave", async () => {
    const { deps, leaves, meetings } = memory({ leaves: [{ ...leave }, { ...leave, id: "66666666-6666-4666-8666-666666666666", status: "approved" }] });
    expect(await cancelMeeting(meetingId, teacher, deps)).toEqual({ ok: true });
    expect(meetings[0].cancelledAt).not.toBeNull();
    expect(leaves.map((entry) => entry.status)).toEqual(["cancelled", "approved"]);
  });

  it("regenerates a check-in code before the meeting ends", async () => {
    const { deps, repository } = memory();
    expect(await regenerateCode(meetingId, teacher, deps)).toEqual({ ok: true });
    expect(repository.manageMeeting).toHaveBeenCalledWith(teacher, meetingId, { action: "regenerate_code", checkinCode: expect.stringMatching(/^\d{6}$/) });
  });

  it.each([cancelMeeting, regenerateCode])("blocks changes to cancelled and ended meetings", async (action) => {
    const cancelled = memory({ meetings: [{ ...meeting, cancelledAt: now.toISOString() }] });
    expect(await action(meetingId, teacher, cancelled.deps)).toEqual({ ok: false, reason: "cancelled" });
    const ended = memory({ meetings: [{ ...meeting, endsAt: now.toISOString() }] });
    expect(await action(meetingId, teacher, ended.deps)).toEqual({ ok: false, reason: "closed" });
  });

  it("overrides attendance and restores automatic status, including after a meeting ends", async () => {
    const { deps, records } = memory();
    const ended = { ...deps, now: new Date("2026-10-13") };
    expect(await setAttendance(meetingId, member.userId, { status: "absent", note: "老师登记" }, teacher, ended)).toEqual({ ok: true });
    expect(records[0]).toMatchObject({ status: "absent", source: "teacher", note: "老师登记" });
    expect(await setAttendance(meetingId, member.userId, { status: null }, teacher, ended)).toEqual({ ok: true });
    expect(records).toHaveLength(0);
  });

  it("rejects overrides before opening or outside the active roster", async () => {
    const { deps } = memory();
    expect(await setAttendance(meetingId, member.userId, { status: "present" }, teacher, { ...deps, now: new Date("2026-10-12T07:00Z") })).toEqual({ ok: false, reason: "not_open" });
    const joinedTooLate = memory({ members: [{ ...rosterMember, createdAt: meeting.endsAt }] });
    expect(await setAttendance(meetingId, member.userId, { status: "present" }, teacher, joinedTooLate.deps)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("reviews pending leave, rejects blank rejection reasons and protects already-reviewed requests", async () => {
    const { deps, leaves, repository } = memory({ leaves: [{ ...leave }] });
    expect(await reviewLeave(leaveId, { decision: "rejected" }, teacher, deps)).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(repository.reviewLeave).not.toHaveBeenCalled();
    expect(await reviewLeave(leaveId, { decision: "rejected", comment: "请补充说明" }, teacher, deps)).toEqual({ ok: true });
    expect(leaves[0]).toMatchObject({ status: "rejected", reviewComment: "请补充说明" });
    expect(await reviewLeave(leaveId, { decision: "approved" }, teacher, deps)).toEqual({ ok: false, reason: "already_reviewed" });
  });
});

describe("member attendance services", () => {
  it("checks in through the RPC and returns remaining attempts on failures", async () => {
    const { deps, repository } = memory();
    expect(await checkIn({ meetingId, code: "123456" }, member, deps)).toEqual({ ok: true, status: "present", remainingAttempts: null });
    vi.mocked(repository.checkIn).mockResolvedValueOnce({ result: "wrong_code", remainingAttempts: 3 });
    expect(await checkIn({ meetingId, code: "000000" }, member, deps)).toEqual({ ok: false, reason: "wrong_code", remainingAttempts: 3 });
    vi.mocked(repository.checkIn).mockResolvedValueOnce({ result: "too_many_attempts", remainingAttempts: 0 });
    expect(await checkIn({ meetingId, code: "000000" }, member, deps)).toEqual({ ok: false, reason: "too_many_attempts", remainingAttempts: 0 });
  });

  it.each(["123", "12345a", "123456\n", 123456])("rejects a malformed check-in code", async (code) => {
    const { deps, repository } = memory();
    expect(await checkIn({ meetingId, code }, member, deps)).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(repository.checkIn).not.toHaveBeenCalled();
  });

  it("enforces the check-in window, active roster and existing records", async () => {
    const { deps } = memory();
    expect(await checkIn({ meetingId, code: "123456" }, member, { ...deps, now: new Date("2026-10-12T07:14Z") })).toEqual({ ok: false, reason: "not_open" });
    expect(await checkIn({ meetingId, code: "123456" }, member, { ...deps, now: new Date(meeting.endsAt) })).toEqual({ ok: false, reason: "closed" });
    expect(await checkIn({ meetingId, code: "123456" }, member, memory({ members: [] }).deps)).toEqual({ ok: false, reason: "forbidden" });
    expect(await checkIn({ meetingId, code: "123456" }, member, memory({ records: [{ ...attendance }] }).deps)).toEqual({ ok: false, reason: "already_recorded" });
  });

  it("submits leave, reports late submission and allows resubmission after rejection", async () => {
    const { deps, leaves } = memory({ leaves: [{ ...leave, status: "rejected" }] });
    expect(await submitLeave({ meetingId, leaveType: "personal", reason: "家庭事务" }, member, deps)).toEqual({ ok: true, leaveId, lateSubmission: true });
    expect(leaves.at(-1)).toMatchObject({ status: "pending", leaveType: "personal" });
  });

  it("blocks leave after attendance, at the end, or when active leave already exists", async () => {
    const input = { meetingId, leaveType: "sick", reason: "生病" };
    expect(await submitLeave(input, member, memory({ records: [{ ...attendance }] }).deps)).toEqual({ ok: false, reason: "already_recorded" });
    const { deps } = memory();
    expect(await submitLeave(input, member, { ...deps, now: new Date(meeting.endsAt) })).toEqual({ ok: false, reason: "closed" });
    for (const status of ["approved", "pending"] as const) {
      expect(await submitLeave(input, member, memory({ leaves: [{ ...leave, status }] }).deps)).toEqual({ ok: false, reason: "duplicate" });
    }
  });

  it("cancels only one's own pending leave", async () => {
    const own = memory({ leaves: [{ ...leave }] });
    expect(await cancelLeave(leaveId, member, own.deps)).toEqual({ ok: true });
    expect(own.leaves[0].status).toBe("cancelled");
    expect(await cancelLeave(leaveId, member, own.deps)).toEqual({ ok: false, reason: "already_reviewed" });
    expect(await cancelLeave(leaveId, member, memory({ leaves: [{ ...leave, userId: teacher.userId }] }).deps)).toEqual({ ok: false, reason: "not_found" });
  });

  it("preserves atomic RPC conflicts after local validation", async () => {
    const { deps, repository } = memory();
    vi.mocked(repository.submitLeave).mockResolvedValue({ result: "duplicate" });
    expect(await submitLeave({ meetingId, leaveType: "sick", reason: "生病" }, member, deps)).toEqual({ ok: false, reason: "duplicate" });
    vi.mocked(repository.checkIn).mockResolvedValue({ result: "session_expired" });
    expect(await checkIn({ meetingId, code: "123456" }, member, deps)).toEqual({ ok: false, reason: "session_expired" });
  });
});

describe("attendance access and read models", () => {
  it("requires the correct role and completion of the first password change", async () => {
    const { deps, repository } = memory();
    expect(await createMeeting(meetingInput, member, deps)).toEqual({ ok: false, reason: "forbidden" });
    expect(await checkIn({ meetingId, code: "123456" }, teacher, deps)).toEqual({ ok: false, reason: "forbidden" });
    expect(await createMeeting(meetingInput, { ...teacher, mustChangePassword: true }, deps)).toEqual({ ok: false, reason: "forbidden" });
    expect(await getTeacherDashboard(member, deps)).toEqual({ ok: false, reason: "forbidden" });
    expect(await getMemberDashboard(teacher, deps)).toEqual({ ok: false, reason: "forbidden" });
    expect(repository.createMeeting).not.toHaveBeenCalled();
  });

  it("rejects invalid identifiers and reports missing objects", async () => {
    const { deps } = memory({ meetings: [] });
    expect(await cancelMeeting("invalid", teacher, deps)).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(await getMeetingDetail(meetingId, teacher, deps)).toEqual({ ok: false, reason: "not_found" });
    expect(await cancelMeeting(meetingId, teacher, deps)).toEqual({ ok: false, reason: "not_found" });
  });

  it("teacher dashboards use active roster counts and leave creation time for late submission", async () => {
    const inactiveRecord = { ...attendance, userId: teacher.userId };
    const { deps } = memory({ records: [inactiveRecord], leaves: [{ ...leave }] });
    const result = await getTeacherDashboard(teacher, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dashboard.openMeetings[0]).toMatchObject({ rosterCount: 1, checkedInCount: 0 });
    expect(result.dashboard.pendingLeaves[0]).toMatchObject({ memberName: member.name, lateSubmission: true });
    expect(result.dashboard.upcomingMeetings).toHaveLength(1);
  });

  it("meeting detail combines manual status, leave and notes for the active roster", async () => {
    const { deps } = memory({ records: [{ ...attendance, status: "absent", source: "teacher", note: "登记" }], leaves: [{ ...leave, status: "approved" }] });
    const result = await getMeetingDetail(meetingId, teacher, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.roster[0]).toMatchObject({ status: "absent", note: "登记", leave: { status: "approved" } });
    expect(result.detail.meeting.checkinCode).toBe("123456");
  });

  it("member dashboards strip codes and other users, include open leave opportunities and exclude unqualified history", async () => {
    const past = { ...meeting, id: "77777777-7777-4777-8777-777777777777", startsAt: "2026-10-10T07:30Z", endsAt: "2026-10-10T08:30Z" };
    const cancelled = { ...past, id: "88888888-8888-4888-8888-888888888888", cancelledAt: now.toISOString() };
    const tooOld = { ...past, id: "99999999-9999-4999-8999-999999999999", startsAt: "2026-09-01T07:30Z", endsAt: "2026-09-01T08:30Z" };
    const ownPresent = { ...attendance, meetingId: past.id };
    const otherLeave = { ...leave, userId: teacher.userId, reason: "PRIVATE_OTHER_REASON" };
    const { deps, repository } = memory({ meetings: [meeting, past, cancelled, tooOld], records: [ownPresent], leaves: [leave, otherLeave] });
    const result = await getMemberDashboard(member, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dashboard.openMeetings).toHaveLength(1);
    expect(result.dashboard.upcomingMeetings).toHaveLength(1);
    expect(result.dashboard.summary).toMatchObject({ total: 1, present: 1, attendanceRate: 1 });
    expect(result.dashboard.recentRecords).toHaveLength(1);
    expect(result.dashboard.leaveRequests).toHaveLength(1);
    expect(result.dashboard.leaveRequests[0].lateSubmission).toBe(true);
    expect(JSON.stringify(result)).not.toContain("checkinCode");
    expect(JSON.stringify(result)).not.toContain("123456");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_OTHER_REASON");
    expect(repository.listTeacherMeetings).not.toHaveBeenCalled();
  });

  it("excludes already-recorded member meetings from the check-in cards", async () => {
    const result = await getMemberDashboard(member, memory({ records: [{ ...attendance }] }).deps);
    expect(result.ok && result.dashboard.openMeetings).toHaveLength(0);
  });
});
