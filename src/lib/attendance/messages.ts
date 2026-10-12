import "server-only";
import type { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { jsonResponse } from "@/lib/http/api";

const messages: Record<string, { status: number; error: string }> = {
  invalid_input: { status: 400, error: "请检查填写内容" },
  not_found: { status: 404, error: "找不到该场次或申请" },
  forbidden: { status: 403, error: "没有权限执行此操作" },
  session_expired: { status: 401, error: "登录已失效，请重新登录" },
  not_open: { status: 409, error: "签到窗口尚未开放" },
  closed: { status: 409, error: "该场次已结束" },
  cancelled: { status: 409, error: "该场次已取消" },
  not_editable: { status: 409, error: "签到窗口已开放，无法修改场次" },
  already_recorded: { status: 409, error: "已有签到记录，无法重复操作" },
  duplicate: { status: 409, error: "该场次已有待审批或已批准的请假" },
  already_reviewed: { status: 409, error: "申请状态已变化，请刷新后查看" },
  wrong_code: { status: 400, error: "签到码不正确，请检查后重试" },
  too_many_attempts: { status: 429, error: "错误次数已用尽，请联系老师" },
};

interface SafeSuccess {
  ok: true;
  meetingId?: string;
  leaveId?: string;
  lateSubmission?: boolean;
  status?: "present" | "late";
  remainingAttempts?: number | null;
}

interface SafeFailure {
  ok: false;
  reason: string;
  fieldErrors?: Record<string, string>;
  remainingAttempts?: number | null;
}

export function attendanceResponse(result: SafeSuccess | SafeFailure): NextResponse {
  if (result.ok) {
    // Explicitly select public fields; repository-only values (especially codes)
    // must never be serialized into a member response.
    return jsonResponse({
      ok: true,
      ...(result.meetingId === undefined ? {} : { meetingId: result.meetingId }),
      ...(result.leaveId === undefined ? {} : { leaveId: result.leaveId }),
      ...(result.lateSubmission === undefined ? {} : { lateSubmission: result.lateSubmission }),
      ...(result.status === undefined ? {} : { status: result.status }),
      ...(result.remainingAttempts === undefined ? {} : { remainingAttempts: result.remainingAttempts }),
    });
  }
  const message = messages[result.reason];
  if (!message) {
    return jsonResponse({ ok: false, reason: "server_error", error: "操作失败，请稍后重试" }, 500);
  }
  const response = jsonResponse({
    ok: false,
    reason: result.reason,
    error: message.error,
    ...(result.fieldErrors === undefined ? {} : { fieldErrors: result.fieldErrors }),
    ...(result.remainingAttempts === undefined ? {} : { remainingAttempts: result.remainingAttempts }),
  }, message.status);
  if (message.status === 401) clearSessionCookie(response);
  return response;
}

export function invalidAttendanceInput(fieldErrors: Record<string, string>): NextResponse {
  return attendanceResponse({ ok: false, reason: "invalid_input", fieldErrors });
}
