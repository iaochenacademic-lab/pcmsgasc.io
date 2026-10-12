import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { SessionPayload } from "@/lib/auth/types";
import {
  createSupabaseAttendanceRepository,
  MEMBER_MEETING_COLUMNS,
  parseAttendanceRpcResult,
} from "@/lib/attendance/repository";

const ACTOR: SessionPayload = {
  userId: "ac8173b4-080c-4b27-9c7e-e36b901f6501",
  username: "teacher-test",
  role: "teacher",
  name: "Teacher",
  mustChangePassword: false,
  sessionVersion: 3,
};
const MEETING_ID = "c4c53394-062b-452c-b868-7c1c74fa78d1";
const LEAVE_ID = "8a80e12e-7c77-48f6-89db-1bcfc5f85bc8";
const MEETING = {
  id: MEETING_ID,
  title: "Test meeting",
  location: null,
  starts_at: "2026-10-12T07:00:00.000Z",
  ends_at: "2026-10-12T08:00:00.000Z",
  late_after_minutes: 10,
  checkin_code: "123456",
  cancelled_at: null,
  created_by: ACTOR.userId,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};

function makeClient(data: unknown[] = [], rpcData: unknown = { result: "updated" }, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    range: vi.fn(async (start: number, end: number) => ({ data: data.slice(start, end + 1), error })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  const from = vi.fn(() => query);
  const rpc = vi.fn(async () => ({ data: rpcData, error }));
  return {
    query, from, rpc,
    client: { from, rpc } as unknown as SupabaseClient<Database>,
  };
}

describe("attendance repository queries", () => {
  it("selects explicit member columns and strips even unexpectedly returned check-in codes", async () => {
    const fake = makeClient([MEETING]);
    const repository = createSupabaseAttendanceRepository(fake.client);
    const meetings = await repository.listMemberMeetings();

    expect(fake.from).toHaveBeenCalledWith("meetings");
    expect(fake.query.select).toHaveBeenCalledWith(MEMBER_MEETING_COLUMNS);
    expect(MEMBER_MEETING_COLUMNS).not.toContain("checkin_code");
    expect(MEMBER_MEETING_COLUMNS).not.toContain("*");
    expect(meetings).toEqual([{
      id: MEETING_ID,
      title: MEETING.title,
      location: null,
      startsAt: MEETING.starts_at,
      endsAt: MEETING.ends_at,
      lateAfterMinutes: 10,
      cancelledAt: null,
      createdBy: ACTOR.userId,
      createdAt: MEETING.created_at,
      updatedAt: MEETING.updated_at,
    }]);
    expect(JSON.stringify(meetings)).not.toContain("123456");
    expect(JSON.stringify(meetings)).not.toContain("checkin");
  });

  it("includes a code only for the explicit teacher query", async () => {
    const fake = makeClient([MEETING]);
    const meetings = await createSupabaseAttendanceRepository(fake.client).listTeacherMeetings();
    expect(fake.query.select.mock.calls[0]![0]).toContain("checkin_code");
    expect(meetings[0]?.checkinCode).toBe("123456");
  });

  it("queries only active member roster fields without credentials", async () => {
    const fake = makeClient([{
      id: ACTOR.userId, username: "member-test", name: "Member",
      created_at: MEETING.created_at, password_hash: "must-not-leak",
    }]);
    const members = await createSupabaseAttendanceRepository(fake.client).listActiveMembers();
    expect(fake.query.eq).toHaveBeenCalledWith("role", "member");
    expect(fake.query.eq).toHaveBeenCalledWith("is_active", true);
    expect(fake.query.select).toHaveBeenCalledWith("id,username,name,created_at");
    expect(members).toEqual([{ id: ACTOR.userId, username: "member-test", name: "Member", createdAt: MEETING.created_at }]);
  });

  it("scopes attendance and leave queries to the requested member and meetings", async () => {
    const fake = makeClient();
    const repository = createSupabaseAttendanceRepository(fake.client);
    await repository.listAttendance([MEETING_ID], ACTOR.userId);
    await repository.listLeaves([MEETING_ID], ACTOR.userId);
    expect(fake.from).toHaveBeenCalledWith("attendance_records");
    expect(fake.from).toHaveBeenCalledWith("leave_requests");
    expect(fake.query.in).toHaveBeenCalledWith("meeting_id", [MEETING_ID]);
    expect(fake.query.eq).toHaveBeenCalledWith("user_id", ACTOR.userId);
    expect(fake.query.select.mock.calls.every(([columns]) => !columns.includes("*") && !columns.includes("checkin_code"))).toBe(true);
  });

  it("does not accidentally read every record when the requested meeting list is empty", async () => {
    const fake = makeClient();
    const repository = createSupabaseAttendanceRepository(fake.client);
    await expect(repository.listAttendance([])).resolves.toEqual([]);
    await expect(repository.listLeaves([])).resolves.toEqual([]);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("paginates instead of silently truncating statistics at the server row limit", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ ...MEETING, id: String(i) }));
    const fake = makeClient(rows);
    const meetings = await createSupabaseAttendanceRepository(fake.client).listMemberMeetings();
    expect(meetings).toHaveLength(1001);
    expect(fake.query.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(fake.query.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("replaces database query details with a generic error", async () => {
    const fake = makeClient([], null, new Error("sensitive database connection"));
    await expect(createSupabaseAttendanceRepository(fake.client).listMemberMeetings())
      .rejects.toThrow("Attendance repository operation failed.");
  });
});

describe("attendance RPC decoding", () => {
  it("accepts known results and maps snake_case payload fields without spreading raw data", () => {
    expect(parseAttendanceRpcResult({ result: "created", meeting_id: MEETING_ID, checkin_code: "secret" }))
      .toEqual({ result: "created", meetingId: MEETING_ID });
    expect(parseAttendanceRpcResult({ result: "submitted", leave_id: LEAVE_ID, late_submission: true }))
      .toEqual({ result: "submitted", leaveId: LEAVE_ID, lateSubmission: true });
    expect(parseAttendanceRpcResult({ result: "wrong_code", remaining_attempts: 3 }))
      .toEqual({ result: "wrong_code", remainingAttempts: 3 });
    expect(parseAttendanceRpcResult({ result: "too_many_attempts", remaining_attempts: 0 }))
      .toEqual({ result: "too_many_attempts", remainingAttempts: 0 });
    expect(parseAttendanceRpcResult({ result: "present", remaining_attempts: null }))
      .toEqual({ result: "present", remainingAttempts: null });
    expect(parseAttendanceRpcResult({ result: "session_expired" })).toEqual({ result: "session_expired" });
  });

  it.each([
    null, [], "present", {}, { result: "unrecognized" },
    { result: "created", meeting_id: 42 },
    { result: "created", meeting_id: "not-a-uuid" },
    { result: "submitted", leave_id: LEAVE_ID, late_submission: "yes" },
    { result: "wrong_code", remaining_attempts: -1 },
    { result: "wrong_code", remaining_attempts: 5 },
    { result: "wrong_code", remaining_attempts: 1.5 },
    { result: "too_many_attempts", remaining_attempts: 1 },
    { result: "present", remaining_attempts: 2 },
  ])("rejects malformed or unknown database results %#", (value) => {
    expect(() => parseAttendanceRpcResult(value)).toThrow("Attendance repository operation failed.");
  });
});

describe("attendance repository mutations", () => {
  it("creates meetings with normalized UTC data and the server actor version", async () => {
    const fake = makeClient([], { result: "created", meeting_id: MEETING_ID });
    const repository = createSupabaseAttendanceRepository(fake.client);
    const result = await repository.createMeeting(ACTOR, {
      title: MEETING.title, location: null, startsAt: MEETING.starts_at,
      endsAt: MEETING.ends_at, lateAfterMinutes: 10, checkinCode: "123456",
    });
    expect(result).toEqual({ result: "created", meetingId: MEETING_ID });
    expect(fake.rpc).toHaveBeenCalledWith("create_meeting", {
      p_actor_id: ACTOR.userId, p_session_version: 3, p_title: MEETING.title,
      p_location: null, p_starts_at: MEETING.starts_at, p_ends_at: MEETING.ends_at,
      p_late_after_minutes: 10, p_checkin_code: "123456",
    });
  });

  it("routes code regeneration, cancellation and normalized edits through the atomic meeting RPC", async () => {
    const fake = makeClient();
    const repository = createSupabaseAttendanceRepository(fake.client);
    await repository.manageMeeting(ACTOR, MEETING_ID, { action: "regenerate_code", checkinCode: "234567" });
    await repository.manageMeeting(ACTOR, MEETING_ID, { action: "cancel" });
    await repository.manageMeeting(ACTOR, MEETING_ID, {
      action: "update", data: {
        title: "Updated", location: "Room", startsAt: MEETING.starts_at,
        endsAt: MEETING.ends_at, lateAfterMinutes: 0,
      },
    });
    expect(fake.rpc).toHaveBeenNthCalledWith(1, "manage_meeting", {
      p_actor_id: ACTOR.userId, p_session_version: 3, p_meeting_id: MEETING_ID,
      p_action: "regenerate_code", p_data: { checkin_code: "234567" },
    });
    expect(fake.rpc).toHaveBeenNthCalledWith(2, "manage_meeting", {
      p_actor_id: ACTOR.userId, p_session_version: 3, p_meeting_id: MEETING_ID,
      p_action: "cancel", p_data: {},
    });
    expect(fake.rpc).toHaveBeenNthCalledWith(3, "manage_meeting", {
      p_actor_id: ACTOR.userId, p_session_version: 3, p_meeting_id: MEETING_ID,
      p_action: "update", p_data: {
        title: "Updated", location: "Room", starts_at: MEETING.starts_at,
        ends_at: MEETING.ends_at, late_after_minutes: 0,
      },
    });
  });

  it("uses the server identity for check-in and leave operations", async () => {
    const fake = makeClient([], { result: "present", remaining_attempts: null });
    const repository = createSupabaseAttendanceRepository(fake.client);
    await repository.checkIn(ACTOR, MEETING_ID, "123456");
    await repository.submitLeave(ACTOR, MEETING_ID, "sick", "Recovering");
    await repository.cancelLeave(ACTOR, LEAVE_ID);
    expect(fake.rpc).toHaveBeenNthCalledWith(1, "member_check_in", {
      p_meeting_id: MEETING_ID, p_user_id: ACTOR.userId, p_code: "123456", p_session_version: 3,
    });
    expect(fake.rpc).toHaveBeenNthCalledWith(2, "submit_leave", {
      p_meeting_id: MEETING_ID, p_user_id: ACTOR.userId, p_session_version: 3,
      p_leave_type: "sick", p_reason: "Recovering",
    });
    expect(fake.rpc).toHaveBeenNthCalledWith(3, "cancel_leave", {
      p_user_id: ACTOR.userId, p_session_version: 3, p_leave_id: LEAVE_ID,
    });
  });

  it("uses the atomic override and review RPCs with nullable fields preserved", async () => {
    const fake = makeClient();
    const repository = createSupabaseAttendanceRepository(fake.client);
    await repository.setAttendance(ACTOR, MEETING_ID, ACTOR.userId, null, null);
    await repository.reviewLeave(ACTOR, LEAVE_ID, "approved", null);
    expect(fake.rpc).toHaveBeenNthCalledWith(1, "set_attendance", {
      p_actor_id: ACTOR.userId, p_session_version: 3, p_meeting_id: MEETING_ID,
      p_user_id: ACTOR.userId, p_status: null, p_note: null,
    });
    expect(fake.rpc).toHaveBeenNthCalledWith(2, "review_leave", {
      p_actor_id: ACTOR.userId, p_session_version: 3, p_leave_id: LEAVE_ID,
      p_decision: "approved", p_comment: null,
    });
  });

  it("does not expose raw RPC errors", async () => {
    const fake = makeClient([], null, new Error("sensitive details"));
    await expect(createSupabaseAttendanceRepository(fake.client).checkIn(ACTOR, MEETING_ID, "123456"))
      .rejects.toThrow("Attendance repository operation failed.");
  });
});

