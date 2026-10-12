import { describe, expect, it } from "vitest";
import { isUuid, parseMeetingInput, parseLeaveInput, parseReviewInput, parseOverrideInput } from "@/lib/attendance/validation";

const meetingId = "11111111-1111-4111-8111-111111111111";
const meeting = { title: " 社团活动 ", location: "教室", date: "2026-10-12", startTime: "15:30", endTime: "16:30" };

describe("attendance input parsing", () => {
  it.each([meetingId, "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"])("accepts a UUID %s", (id) => expect(isUuid(id)).toBe(true));
  it.each([null, 3, "", "../test", meetingId + "\n", "11111111-1111-1111-1111"])("rejects an invalid UUID", (id) => expect(isUuid(id)).toBe(false));
  it("trims a meeting and supplies defaults", () => {
    expect(parseMeetingInput(meeting)).toEqual({ ok: true, value: { ...meeting, title: "社团活动", lateAfterMinutes: 10 } });
    const result = parseMeetingInput({ ...meeting, location: " " });
    expect(result.ok && result.value.location).toBeNull();
  });
  it.each([
    null, {}, { ...meeting, title: "" }, { ...meeting, title: "字".repeat(61) },
    { ...meeting, location: "字".repeat(61) }, { ...meeting, date: "2026-02-30" },
    { ...meeting, startTime: "24:00" }, { ...meeting, endTime: "12:60" },
    { ...meeting, lateAfterMinutes: -1 }, { ...meeting, lateAfterMinutes: 121 },
    { ...meeting, lateAfterMinutes: 1.5 }, { ...meeting, lateAfterMinutes: "10" },
  ])("returns field errors for invalid meeting data", (input) => {
    const result = parseMeetingInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors).length).toBeGreaterThan(0);
  });
  it("requires a valid leave type and trimmed reason up to 200 characters", () => {
    expect(parseLeaveInput({ meetingId, leaveType: "sick", reason: " 感冒 " }))
      .toEqual({ ok: true, value: { meetingId, leaveType: "sick", reason: "感冒" } });
    for (const input of [{ meetingId, leaveType: "other", reason: "原因" }, { meetingId, leaveType: "sick", reason: "" }, { meetingId: "bad", leaveType: "sick", reason: "原因" }, { meetingId, leaveType: "sick", reason: "字".repeat(201) }]) {
      expect(parseLeaveInput(input).ok).toBe(false);
    }
  });
  it("requires a nonempty rejection comment and permits approval without one", () => {
    expect(parseReviewInput({ decision: "approved" })).toEqual({ ok: true, value: { decision: "approved", comment: null } });
    expect(parseReviewInput({ decision: "rejected", comment: " 请补充 " })).toEqual({ ok: true, value: { decision: "rejected", comment: "请补充" } });
    expect(parseReviewInput({ decision: "rejected", comment: " " }).ok).toBe(false);
    expect(parseReviewInput({ decision: "approved", comment: "字".repeat(201) }).ok).toBe(false);
  });
  it("accepts restoring automatic attendance and validates override fields", () => {
    expect(parseOverrideInput({ status: null })).toEqual({ ok: true, value: { status: null, note: null } });
    expect(parseOverrideInput({ status: "absent", note: " 老师登记 " })).toEqual({ ok: true, value: { status: "absent", note: "老师登记" } });
    expect(parseOverrideInput({ status: "pending" }).ok).toBe(false);
    expect(parseOverrideInput({ status: "present", note: "字".repeat(201) }).ok).toBe(false);
  });
});
