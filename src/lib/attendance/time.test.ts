import { afterEach, describe, expect, it, vi } from "vitest";
import { formatClubDateTime, getClubTimeZone, toClubDateTimeParts, zonedLocalToUtc } from "@/lib/attendance/time";

afterEach(() => vi.unstubAllEnvs());

describe("club local time", () => {
  it("defaults to Asia/Shanghai and rejects an invalid configured zone", () => {
    vi.stubEnv("CLUB_TIME_ZONE", "");
    expect(getClubTimeZone()).toBe("Asia/Shanghai");
    vi.stubEnv("CLUB_TIME_ZONE", "Mars/Olympus");
    expect(() => getClubTimeZone()).toThrow();
  });

  it.each([
    ["2026-10-12", "15:30", "Asia/Shanghai", "2026-10-12T07:30:00.000Z"],
    ["2026-03-08", "01:30", "America/New_York", "2026-03-08T06:30:00.000Z"],
    ["2026-03-08", "03:30", "America/New_York", "2026-03-08T07:30:00.000Z"],
    ["2026-11-01", "02:30", "America/New_York", "2026-11-01T07:30:00.000Z"],
    ["2024-02-29", "00:00", "Asia/Shanghai", "2024-02-28T16:00:00.000Z"],
  ])("converts %s %s in %s", (date, time, zone, expected) => {
    expect(zonedLocalToUtc(date, time, zone)).toBe(expected);
  });

  it.each([
    ["2026-03-08", "02:30", "America/New_York"],
    ["2026-11-01", "01:30", "America/New_York"],
    ["2026-02-29", "12:00", "Asia/Shanghai"],
    ["2026-04-31", "12:00", "Asia/Shanghai"],
    ["2026-01-01", "24:00", "Asia/Shanghai"],
    ["2026-1-01", "12:00", "Asia/Shanghai"],
    ["2026-01-01", "12:60", "Asia/Shanghai"],
  ])("rejects invalid, nonexistent or ambiguous local time %s %s %s", (date, time, zone) => {
    expect(() => zonedLocalToUtc(date, time, zone)).toThrow();
  });

  it("roundtrips local date/time parts for editing and formats the club clock", () => {
    expect(toClubDateTimeParts("2026-10-12T07:30:00Z", "Asia/Shanghai")).toEqual({ date: "2026-10-12", time: "15:30" });
    expect(formatClubDateTime("2026-10-12T07:30:00Z", "Asia/Shanghai")).toBe("10月12日 周一 15:30");
    expect(formatClubDateTime("2026-10-11T16:00:00Z", "Asia/Shanghai")).toBe("10月12日 周一 00:00");
  });
});
