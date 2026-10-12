import { describe, expect, it, vi } from "vitest";
import { generateCheckinCode } from "@/lib/attendance/code";

const randomInt = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", () => ({ randomInt, default: { randomInt } }));

describe("meeting check-in codes", () => {
  it("uses a cryptographic random number and pads leading zeroes", () => {
    randomInt.mockReturnValueOnce(7).mockReturnValueOnce(999999);
    expect(generateCheckinCode()).toBe("000007");
    expect(generateCheckinCode()).toBe("999999");
    expect(randomInt).toHaveBeenCalledWith(0, 1_000_000);
  });
});
