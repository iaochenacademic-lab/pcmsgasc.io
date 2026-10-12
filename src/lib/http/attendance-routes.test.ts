import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as create } from "@/app/api/teacher/meetings/route";
import { PATCH as update } from "@/app/api/teacher/meetings/[id]/route";
import { PUT as override } from "@/app/api/teacher/meetings/[id]/attendance/[userId]/route";
import { POST as review } from "@/app/api/teacher/leave-requests/[id]/review/route";
import { POST as checkin } from "@/app/api/member/check-in/route";
import { POST as submit } from "@/app/api/member/leave-requests/route";
import { POST as cancel } from "@/app/api/member/leave-requests/[id]/cancel/route";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), findById: vi.fn(), admin: vi.fn(),
  services: {
    createMeeting: vi.fn(), updateMeeting: vi.fn(), cancelMeeting: vi.fn(), regenerateCode: vi.fn(),
    setAttendance: vi.fn(), reviewLeave: vi.fn(), checkIn: vi.fn(), submitLeave: vi.fn(), cancelLeave: vi.fn(),
  },
}));
vi.mock("@/lib/auth/cookies", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/cookies")>(), getSessionFromRequest: mocks.session,
}));
vi.mock("@/lib/auth/user-repository", () => ({
  createSupabaseUserRepository: () => ({ findById: mocks.findById }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/attendance/repository", () => ({ createSupabaseAttendanceRepository: () => ({}) }));
vi.mock("@/lib/attendance/service", () => mocks.services);

const id = "2920d7f8-ef53-4e04-8c25-4bb930c89533";
const userId = "6cb2b0d6-9ac9-40a0-a530-6e82ed6046c3";
const session = { userId, username: "tester", name: "Old Name", role: "teacher", sessionVersion: 2, mustChangePassword: false };
const user = { ...session, id: userId, name: "Database Name", isActive: true };
const context = () => ({ params: Promise.resolve({ id, userId }) });
const cases = [
  { name: "create", handler: create, method: "POST", role: "teacher", service: "createMeeting", body: { title: "Club", date: "2026-10-12", startTime: "15:00", endTime: "16:00" }, success: { ok: true, meetingId: id } },
  { name: "update", handler: update, method: "PATCH", role: "teacher", service: "updateMeeting", body: { action: "update", title: "Club", date: "2026-10-12", startTime: "15:00", endTime: "16:00" }, success: { ok: true } },
  { name: "override", handler: override, method: "PUT", role: "teacher", service: "setAttendance", body: { status: "late", note: "Teacher update" }, success: { ok: true } },
  { name: "review", handler: review, method: "POST", role: "teacher", service: "reviewLeave", body: { decision: "rejected", comment: "Explain dates" }, success: { ok: true } },
  { name: "check-in", handler: checkin, method: "POST", role: "member", service: "checkIn", body: { meetingId: id, code: "123456" }, success: { ok: true, status: "present", remainingAttempts: null } },
  { name: "submit", handler: submit, method: "POST", role: "member", service: "submitLeave", body: { meetingId: id, leaveType: "personal", reason: "Appointment" }, success: { ok: true, leaveId: id, lateSubmission: false } },
  { name: "cancel", handler: cancel, method: "POST", role: "member", service: "cancelLeave", body: {}, success: { ok: true } },
] as const;
function request(testCase: typeof cases[number], body: unknown = testCase.body, origin = "https://club.example") {
  return new NextRequest("https://club.example/api/action", {
    method: testCase.method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
describe.each(cases)("$name API", (testCase) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ ...session, role: testCase.role });
    mocks.findById.mockResolvedValue({ ...user, role: testCase.role });
    for (const service of Object.values(mocks.services)) service.mockReset();
    mocks.services[testCase.service].mockResolvedValue(testCase.success);
  });

  it("returns safe success and uses the database actor", async () => {
    const response = await testCase.handler(request(testCase), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(testCase.success);
    const call = mocks.services[testCase.service].mock.calls[0] as unknown[];
    expect(call.at(-2)).toMatchObject({ userId, role: testCase.role, name: "Database Name", sessionVersion: 2 });
  });
  it("rejects unauthenticated requests and clears cookies", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await testCase.handler(request(testCase), context());
    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
    expect(mocks.services[testCase.service]).not.toHaveBeenCalled();
  });
  it("rejects an incorrect database role", async () => {
    mocks.findById.mockResolvedValue({ ...user, role: testCase.role === "teacher" ? "member" : "teacher" });
    expect((await testCase.handler(request(testCase), context())).status).toBe(403);
    expect(mocks.services[testCase.service]).not.toHaveBeenCalled();
  });
  it("rejects foreign Origin before reading session or database", async () => {
    const response = await testCase.handler(request(testCase, testCase.body, "https://foreign.example"), context());
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("maps validation errors to 400", async () => {
    mocks.services[testCase.service].mockResolvedValue({ ok: false, reason: "invalid_input", fieldErrors: { input: "请检查输入" } });
    const response = await testCase.handler(request(testCase), context());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, fieldErrors: { input: "请检查输入" } });
  });
  it("maps business conflicts to 409", async () => {
    mocks.services[testCase.service].mockResolvedValue({ ok: false, reason: "already_recorded" });
    const response = await testCase.handler(request(testCase), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, reason: "already_recorded" });
  });
  it("clears a session revoked during a mutation", async () => {
    mocks.services[testCase.service].mockResolvedValue({ ok: false, reason: "session_expired" });
    const response = await testCase.handler(request(testCase), context());
    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
  });
  it("rejects forced password changes and stale versions", async () => {
    mocks.findById.mockResolvedValue({ ...user, role: testCase.role, mustChangePassword: true });
    expect((await testCase.handler(request(testCase), context())).status).toBe(403);
    mocks.findById.mockResolvedValue({ ...user, role: testCase.role, sessionVersion: 3 });
    expect((await testCase.handler(request(testCase), context())).status).toBe(401);
    expect(mocks.services[testCase.service]).not.toHaveBeenCalled();
  });
  it("returns uncached generic errors", async () => {
    mocks.services[testCase.service].mockRejectedValue(new Error("private details"));
    const response = await testCase.handler(request(testCase), context());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, reason: "server_error", error: "操作失败，请稍后重试" });
  });
  it("drops sensitive or unexpected fields from results", async () => {
    mocks.services[testCase.service].mockResolvedValue({ ...testCase.success, checkin_code: "654321", checkinCode: "654321", passwordHash: "private" });
    const body = JSON.stringify(await (await testCase.handler(request(testCase), context())).json());
    expect(body).not.toContain("654321");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("checkin_code");
  });
});

describe("attendance API payload handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(session);
    mocks.findById.mockResolvedValue(user);
    for (const service of Object.values(mocks.services)) service.mockReset().mockResolvedValue({ ok: true });
  });

  it.each([["cancel", "cancelMeeting"], ["regenerate_code", "regenerateCode"]] as const)("dispatches action %s with the server identity", async (action, service) => {
    const response = await update(request(cases[1], { action, userId: "forged", id: "forged" }), context());
    expect(response.status).toBe(200);
    expect(mocks.services[service]).toHaveBeenCalledWith(id, expect.objectContaining({ userId }), expect.any(Object));
  });

  it("rejects unknown meeting actions", async () => {
    const response = await update(request(cases[1], { action: "delete_all" }), context());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ fieldErrors: { action: expect.any(String) } });
    expect(mocks.services.updateMeeting).not.toHaveBeenCalled();
  });

  it("drops body identities from creation inputs", async () => {
    await create(request(cases[0], { ...cases[0].body, userId: "forged", sessionVersion: 900, createdBy: "forged" }), context());
    const [input, actor] = mocks.services.createMeeting.mock.calls[0];
    expect(input).not.toHaveProperty("userId");
    expect(input).not.toHaveProperty("createdBy");
    expect(actor).toMatchObject({ userId, sessionVersion: 2 });
  });

  it("rejects invalid URL ids before invoking the service", async () => {
    const response = await override(request(cases[2]), { params: Promise.resolve({ id: "invalid", userId }) });
    expect(response.status).toBe(400);
    expect(mocks.services.setAttendance).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON as 400", async () => {
    const response = await create(new NextRequest("https://club.example/api/action", {
      method: "POST", headers: { origin: "https://club.example", "content-type": "application/json" }, body: "{",
    }), context());
    expect(response.status).toBe(400);
    expect(mocks.services.createMeeting).not.toHaveBeenCalled();
  });

  it.each([["wrong_code", 400, 3], ["too_many_attempts", 429, 0]] as const)("preserves remaining attempts for %s", async (reason, status, remainingAttempts) => {
    mocks.findById.mockResolvedValue({ ...user, role: "member" });
    mocks.services.checkIn.mockResolvedValue({ ok: false, reason, remainingAttempts });
    const response = await checkin(request(cases[4]), context());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ ok: false, reason, remainingAttempts });
  });
});
