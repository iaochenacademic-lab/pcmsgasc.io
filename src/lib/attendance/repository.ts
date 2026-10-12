import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  AttendanceMutationResult,
  AttendanceRecord,
  AttendanceRepository,
  AttendanceStatus,
  LeaveRequest,
  Meeting,
  RosterMember,
  TeacherMeeting,
} from "@/lib/attendance/types";

export type { AttendanceRepository } from "@/lib/attendance/types";

export const MEMBER_MEETING_COLUMNS = "id,title,location,starts_at,ends_at,late_after_minutes,cancelled_at,created_by,created_at,updated_at";
const TEACHER_MEETING_COLUMNS = `${MEMBER_MEETING_COLUMNS},checkin_code` as const;
const ATTENDANCE_COLUMNS = "id,meeting_id,user_id,status,checked_in_at,source,note,updated_by,created_at,updated_at";
const LEAVE_COLUMNS = "id,meeting_id,user_id,leave_type,reason,status,reviewed_by,review_comment,reviewed_at,created_at,updated_at";
const OPERATION_FAILED = "Attendance repository operation failed.";
const PAGE_SIZE = 1000;

type MeetingRow = Database["public"]["Tables"]["meetings"]["Row"];
type MemberMeetingRow = Omit<MeetingRow, "checkin_code">;
type AttendanceRow = Database["public"]["Tables"]["attendance_records"]["Row"];
type LeaveRow = Database["public"]["Tables"]["leave_requests"]["Row"];
type MemberRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "username" | "name" | "created_at">;

// PostgreSQL accepts NULL for these inputs; the generated Supabase argument
// types omit argument nullability. Keep that correction local to this adapter.
type GeneratedFunctions = Database["public"]["Functions"];
type RpcArguments = {
  create_meeting: Omit<GeneratedFunctions["create_meeting"]["Args"], "p_location"> & { p_location: string | null };
  manage_meeting: GeneratedFunctions["manage_meeting"]["Args"];
  set_attendance: Omit<GeneratedFunctions["set_attendance"]["Args"], "p_status" | "p_note"> & { p_status: string | null; p_note: string | null };
  member_check_in: GeneratedFunctions["member_check_in"]["Args"];
  submit_leave: GeneratedFunctions["submit_leave"]["Args"];
  review_leave: Omit<GeneratedFunctions["review_leave"]["Args"], "p_comment"> & { p_comment: string | null };
  cancel_leave: GeneratedFunctions["cancel_leave"]["Args"];
};
type RpcCaller = <Name extends keyof RpcArguments>(
  name: Name,
  args: RpcArguments[Name],
) => PromiseLike<{ data: unknown; error: unknown | null }>;

function fail(): never {
  throw new Error(OPERATION_FAILED);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function parseAttendanceRpcResult(value: unknown): AttendanceMutationResult {
  if (!isObject(value)) return fail();
  switch (value.result) {
    case "created":
      if (!isUuid(value.meeting_id)) return fail();
      return { result: "created", meetingId: value.meeting_id };
    case "submitted":
      if (!isUuid(value.leave_id) || typeof value.late_submission !== "boolean") return fail();
      return { result: "submitted", leaveId: value.leave_id, lateSubmission: value.late_submission };
    case "present":
    case "late":
      if (value.remaining_attempts !== null) return fail();
      return { result: value.result, remainingAttempts: null };
    case "wrong_code":
      if (typeof value.remaining_attempts !== "number" || !Number.isInteger(value.remaining_attempts)
        || value.remaining_attempts < 1 || value.remaining_attempts > 4) return fail();
      return { result: "wrong_code", remainingAttempts: value.remaining_attempts };
    case "too_many_attempts":
      if (value.remaining_attempts !== 0) return fail();
      return { result: "too_many_attempts", remainingAttempts: 0 };
    case "updated":
    case "meeting_cancelled":
    case "code_regenerated":
    case "saved":
    case "restored":
    case "reviewed":
    case "leave_cancelled":
    case "not_found":
    case "forbidden":
    case "session_expired":
    case "invalid_input":
    case "not_open":
    case "not_editable":
    case "closed":
    case "cancelled":
    case "already_recorded":
    case "duplicate":
    case "already_reviewed":
      return { result: value.result };
    default:
      return fail();
  }
}

function mapMeeting(row: MemberMeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    lateAfterMinutes: row.late_after_minutes,
    cancelledAt: row.cancelled_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTeacherMeeting(row: MeetingRow): TeacherMeeting {
  return { ...mapMeeting(row), checkinCode: row.checkin_code };
}

function attendanceStatus(value: string): AttendanceStatus {
  if (value === "present" || value === "late" || value === "excused" || value === "absent") return value;
  return fail();
}

function mapAttendance(row: AttendanceRow): AttendanceRecord {
  if (row.source !== "self" && row.source !== "teacher") return fail();
  return {
    id: row.id,
    meetingId: row.meeting_id,
    userId: row.user_id,
    status: attendanceStatus(row.status),
    checkedInAt: row.checked_in_at,
    source: row.source,
    note: row.note,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLeave(row: LeaveRow): LeaveRequest {
  if (row.leave_type !== "personal" && row.leave_type !== "sick" && row.leave_type !== "official") return fail();
  if (row.status !== "pending" && row.status !== "approved" && row.status !== "rejected" && row.status !== "cancelled") return fail();
  return {
    id: row.id,
    meetingId: row.meeting_id,
    userId: row.user_id,
    leaveType: row.leave_type,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewComment: row.review_comment,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: MemberRow): RosterMember {
  return { id: row.id, username: row.username, name: row.name, createdAt: row.created_at };
}

async function readPages<Row>(
  fetchPage: (start: number, end: number) => PromiseLike<{ data: Row[] | null; error: unknown | null }>,
): Promise<Row[]> {
  const result: Row[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await fetchPage(start, start + PAGE_SIZE - 1);
    if (error !== null || data === null) return fail();
    result.push(...data);
    if (data.length < PAGE_SIZE) return result;
  }
}

export function createSupabaseAttendanceRepository(client: SupabaseClient<Database>): AttendanceRepository {
  const rpc = client.rpc.bind(client) as RpcCaller;

  async function mutate<Name extends keyof RpcArguments>(
    name: Name,
    args: RpcArguments[Name],
  ): Promise<AttendanceMutationResult> {
    const { data, error } = await rpc(name, args);
    if (error !== null) return fail();
    return parseAttendanceRpcResult(data);
  }

  return {
    createMeeting(actor, data) {
      return mutate("create_meeting", {
        p_actor_id: actor.userId,
        p_session_version: actor.sessionVersion,
        p_title: data.title,
        p_location: data.location,
        p_starts_at: data.startsAt,
        p_ends_at: data.endsAt,
        p_late_after_minutes: data.lateAfterMinutes,
        p_checkin_code: data.checkinCode,
      });
    },
    manageMeeting(actor, meetingId, action) {
      let data: Json = {};
      if (action.action === "update") {
        data = {
          title: action.data.title,
          location: action.data.location,
          starts_at: action.data.startsAt,
          ends_at: action.data.endsAt,
          late_after_minutes: action.data.lateAfterMinutes,
        };
      } else if (action.action === "regenerate_code") {
        data = { checkin_code: action.checkinCode };
      }
      return mutate("manage_meeting", {
        p_actor_id: actor.userId,
        p_session_version: actor.sessionVersion,
        p_meeting_id: meetingId,
        p_action: action.action,
        p_data: data,
      });
    },
    setAttendance(actor, meetingId, userId, status, note) {
      return mutate("set_attendance", {
        p_actor_id: actor.userId,
        p_session_version: actor.sessionVersion,
        p_meeting_id: meetingId,
        p_user_id: userId,
        p_status: status,
        p_note: note,
      });
    },
    checkIn(actor, meetingId, code) {
      return mutate("member_check_in", {
        p_meeting_id: meetingId,
        p_user_id: actor.userId,
        p_code: code,
        p_session_version: actor.sessionVersion,
      });
    },
    submitLeave(actor, meetingId, leaveType, reason) {
      return mutate("submit_leave", {
        p_meeting_id: meetingId,
        p_user_id: actor.userId,
        p_session_version: actor.sessionVersion,
        p_leave_type: leaveType,
        p_reason: reason,
      });
    },
    reviewLeave(actor, leaveId, decision, comment) {
      return mutate("review_leave", {
        p_actor_id: actor.userId,
        p_session_version: actor.sessionVersion,
        p_leave_id: leaveId,
        p_decision: decision,
        p_comment: comment,
      });
    },
    cancelLeave(actor, leaveId) {
      return mutate("cancel_leave", {
        p_user_id: actor.userId,
        p_session_version: actor.sessionVersion,
        p_leave_id: leaveId,
      });
    },
    async listTeacherMeetings() {
      const rows = await readPages((start, end) => client.from("meetings")
        .select(TEACHER_MEETING_COLUMNS).order("starts_at", { ascending: false }).order("id").range(start, end));
      return rows.map(mapTeacherMeeting);
    },
    async listMemberMeetings() {
      const rows = await readPages((start, end) => client.from("meetings")
        .select(MEMBER_MEETING_COLUMNS).order("starts_at", { ascending: false }).order("id").range(start, end));
      return rows.map(mapMeeting);
    },
    async listActiveMembers() {
      const rows = await readPages((start, end) => client.from("users")
        .select("id,username,name,created_at").eq("role", "member").eq("is_active", true)
        .order("id").range(start, end));
      return rows.map(mapMember);
    },
    async listAttendance(meetingIds, userId) {
      if (meetingIds.length === 0) return [];
      const rows = await readPages((start, end) => {
        let query = client.from("attendance_records").select(ATTENDANCE_COLUMNS).in("meeting_id", meetingIds);
        if (userId !== undefined) query = query.eq("user_id", userId);
        return query.order("id").range(start, end);
      });
      return rows.map(mapAttendance);
    },
    async listLeaves(meetingIds, userId) {
      if (meetingIds?.length === 0) return [];
      const rows = await readPages((start, end) => {
        let query = client.from("leave_requests").select(LEAVE_COLUMNS);
        if (meetingIds !== undefined) query = query.in("meeting_id", meetingIds);
        if (userId !== undefined) query = query.eq("user_id", userId);
        return query.order("created_at", { ascending: false }).order("id").range(start, end);
      });
      return rows.map(mapLeave);
    },
  };
}

