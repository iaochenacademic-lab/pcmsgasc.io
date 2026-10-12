import { DEFAULT_LATE_MINUTES, TEXT_MAX, TITLE_MAX } from "@/lib/attendance/constants";
import { isCalendarDate, isClockTime } from "@/lib/attendance/time";

export type FieldErrors = Record<string, string>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors };
export type ParsedMeetingInput = {
  title: string; location: string | null; date: string;
  startTime: string; endTime: string; lateAfterMinutes: number;
};
export type ParsedLeaveInput = { meetingId: string; leaveType: "personal" | "sick" | "official"; reason: string };
export type ParsedReviewInput = { decision: "approved" | "rejected"; comment: string | null };
export type ParsedOverrideInput = { status: "present" | "late" | "excused" | "absent" | null; note: string | null };

function object(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : null;
}
const invalidObject = { ok: false, fieldErrors: { _form: "请提交有效的 JSON 对象。" } } as const;
const length = (text: string) => Array.from(text).length;

export function isUuid(input: unknown): input is string {
  return typeof input === "string" && input.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
}

export function parseMeetingInput(input: unknown): Parsed<ParsedMeetingInput> {
  const candidate = object(input);
  if (!candidate) return invalidObject;
  const errors: FieldErrors = {};
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (length(title) < 1 || length(title) > TITLE_MAX) errors.title = "标题须为 1–60 个字符。";
  const location = typeof candidate.location === "string" ? candidate.location.trim() || null : null;
  if ((candidate.location != null && typeof candidate.location !== "string") || (location !== null && length(location) > TITLE_MAX)) errors.location = "地点不能超过 60 个字符。";
  const date = typeof candidate.date === "string" ? candidate.date : "";
  if (!isCalendarDate(date)) errors.date = "请输入有效日期。";
  const startTime = typeof candidate.startTime === "string" ? candidate.startTime : "";
  const endTime = typeof candidate.endTime === "string" ? candidate.endTime : "";
  if (!isClockTime(startTime)) errors.startTime = "开始时间须为 HH:mm。";
  if (!isClockTime(endTime)) errors.endTime = "结束时间须为 HH:mm。";
  const lateAfterMinutes = candidate.lateAfterMinutes === undefined ? DEFAULT_LATE_MINUTES : candidate.lateAfterMinutes;
  if (typeof lateAfterMinutes !== "number" || !Number.isInteger(lateAfterMinutes) || lateAfterMinutes < 0 || lateAfterMinutes > 120) errors.lateAfterMinutes = "迟到阈值须为 0–120 的整数。";
  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : {
    ok: true, value: { title, location, date, startTime, endTime, lateAfterMinutes: lateAfterMinutes as number },
  };
}

export function parseLeaveInput(input: unknown): Parsed<ParsedLeaveInput> {
  const candidate = object(input);
  if (!candidate) return invalidObject;
  const errors: FieldErrors = {};
  if (!isUuid(candidate.meetingId)) errors.meetingId = "场次编号不正确。";
  if (!["personal", "sick", "official"].includes(candidate.leaveType as string)) errors.leaveType = "请选择事假、病假或公假。";
  const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
  if (length(reason) < 1 || length(reason) > TEXT_MAX) errors.reason = "请假理由须为 1–200 个字符。";
  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : {
    ok: true, value: { meetingId: candidate.meetingId as string, leaveType: candidate.leaveType as ParsedLeaveInput["leaveType"], reason },
  };
}

function optionalText(value: unknown, field: string, errors: FieldErrors): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || length(value.trim()) > TEXT_MAX) {
    errors[field] = "此字段须为不超过 200 个字符的文字。";
    return null;
  }
  return value.trim() || null;
}

export function parseReviewInput(input: unknown): Parsed<ParsedReviewInput> {
  const candidate = object(input);
  if (!candidate) return invalidObject;
  const errors: FieldErrors = {};
  if (candidate.decision !== "approved" && candidate.decision !== "rejected") errors.decision = "请选择批准或驳回。";
  const comment = optionalText(candidate.comment, "comment", errors);
  if (candidate.decision === "rejected" && !comment) errors.comment = "驳回时必须填写意见。";
  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : {
    ok: true, value: { decision: candidate.decision as ParsedReviewInput["decision"], comment },
  };
}

export function parseOverrideInput(input: unknown): Parsed<ParsedOverrideInput> {
  const candidate = object(input);
  if (!candidate) return invalidObject;
  const errors: FieldErrors = {};
  if (candidate.status !== null && !["present", "late", "excused", "absent"].includes(candidate.status as string)) errors.status = "请选择有效出勤状态或恢复自动。";
  const note = optionalText(candidate.note, "note", errors);
  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : {
    ok: true, value: { status: candidate.status as ParsedOverrideInput["status"], note },
  };
}
