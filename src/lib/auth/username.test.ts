import { describe, expect, it } from "vitest";
import { isValidUsername, normalizeUsername } from "@/lib/auth/username";

describe("account username rules", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeUsername("  Alice.Example  ")).toBe("alice.example");
    expect(isValidUsername(normalizeUsername("  Alice.Example  "))).toBe(true);
  });

  it.each(["ab", "a".repeat(33), ".alice", "_alice", "-alice", "a b", "成员001", "Alice", "alice\n"])(
    "rejects invalid normalized account username %j", (value) => {
      expect(isValidUsername(value)).toBe(false);
    },
  );

  it.each(["abc", "a".repeat(32), "1-a.b_c", "smoke-m1"])("accepts %s", (value) => {
    expect(isValidUsername(value)).toBe(true);
  });
});
