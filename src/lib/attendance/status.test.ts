import { describe, expect, it } from "vitest";
import { effectiveStatus, meetingPhase, summarize } from "@/lib/attendance/status";

const meeting = { startsAt: "2026-10-12T07:30:00Z", endsAt: "2026-10-12T08:30:00Z", cancelledAt: null };

describe("meeting status", () => {
  it.each([
    ["2026-10-12T07:14:59Z", "upcoming"],
    ["2026-10-12T07:15:00Z", "open"],
    ["2026-10-12T07:30:00Z", "open"],
    ["2026-10-12T08:30:00Z", "closed"],
  ])("calculates the phase at %s", (now, phase) => {
    expect(meetingPhase(meeting, new Date(now))).toBe(phase);
  });

  it("cancellation takes phase precedence", () => {
    expect(meetingPhase({ ...meeting, cancelledAt: meeting.startsAt }, new Date("2026-10-13"))).toBe("cancelled");
  });

  it("attendance records override approved leave", () => {
    for (const status of ["present", "late", "excused", "absent"] as const) {
      expect(effectiveStatus({ status }, { status: "approved" }, meeting, new Date("2026-10-13"))).toBe(status);
    }
  });

  it("approved leave overrides automatic absence, but pending/rejected leave does not", () => {
    expect(effectiveStatus(null, { status: "approved" }, meeting, new Date("2026-10-13"))).toBe("excused");
    for (const status of ["pending", "rejected", "cancelled"] as const) {
      expect(effectiveStatus(null, { status }, meeting, new Date("2026-10-13"))).toBe("absent");
    }
    expect(effectiveStatus(null, null, meeting, new Date("2026-10-12T07:30Z"))).toBe("pending");
  });

  it("does not infer absence for cancelled meetings", () => {
    expect(effectiveStatus(null, null, { ...meeting, cancelledAt: meeting.startsAt }, new Date("2026-10-13"))).toBe("pending");
  });

  it("calculates rates using concluded non-excused entries only", () => {
    expect(summarize(["present", "late", "excused", "absent", "pending"])).toEqual({
      present: 1, late: 1, excused: 1, absent: 1, pending: 1, total: 5, attendanceRate: 2 / 3,
    });
    expect(summarize(["excused", "pending"]).attendanceRate).toBeNull();
    expect(summarize([]).attendanceRate).toBeNull();
  });
});
