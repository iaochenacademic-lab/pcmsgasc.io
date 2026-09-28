import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { generateInitialPassword, hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password primitives", () => {
  it("generates independent high-entropy URL-safe passwords", () => {
    const first = generateInitialPassword();
    const second = generateInitialPassword();

    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first === second).toBe(false);
  });

  it("hashes with bcrypt cost 12 and verifies the matching password", async () => {
    const password = "unit-test-password-012345";
    const hash = await hashPassword(password);

    expect(hash.startsWith("$2")).toBe(true);
    expect(bcrypt.getRounds(hash)).toBe(12);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("different-password", hash)).resolves.toBe(false);
  });
});
