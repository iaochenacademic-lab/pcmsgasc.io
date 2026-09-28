import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jwtDecrypt } from "jose";
import {
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/constants";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";
import type { SessionPayload } from "@/lib/auth/types";

const TEST_SECRET = Buffer.alloc(32, 7).toString("base64url");
const NOW = new Date("2026-02-03T04:05:06.000Z");
const SESSION: SessionPayload = {
  userId: "f8d9d3a8-1f08-4db0-9cec-54ba4732a8c3",
  username: "teacher-sample",
  role: "teacher",
  name: "Sample Teacher",
  mustChangePassword: false,
};

describe("encrypted session token", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it("round-trips the session payload without exposing plaintext fields", async () => {
    const token = await createSessionToken(SESSION, NOW);

    expect(await readSessionToken(token, NOW)).toEqual(SESSION);
    expect(token).not.toContain(SESSION.username);
    expect(token).not.toContain(SESSION.name);
  });

  it("expires exactly 30 days after issuance", async () => {
    const token = await createSessionToken(SESSION, NOW);
    const { payload } = await jwtDecrypt(
      token,
      new Uint8Array(Buffer.from(TEST_SECRET, "base64url")),
      { currentDate: NOW },
    );

    expect(Number(payload.exp) - Number(payload.iat)).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it("returns null for invalid, tampered, and expired tokens", async () => {
    const token = await createSessionToken(SESSION, NOW);
    const segments = token.split(".");
    segments[3] = `${segments[3]?.[0] === "A" ? "B" : "A"}${segments[3]?.slice(1)}`;
    const tamperedToken = segments.join(".");
    const expiredToken = await createSessionToken(
      SESSION,
      new Date(NOW.getTime() - SESSION_MAX_AGE_SECONDS * 1_000 - 1_000),
    );

    await expect(readSessionToken("not-a-token", NOW)).resolves.toBeNull();
    await expect(readSessionToken(tamperedToken, NOW)).resolves.toBeNull();
    await expect(readSessionToken(expiredToken, NOW)).resolves.toBeNull();
  });

  it("exports secure, HTTP-only, same-site cookie defaults for 30 days", () => {
    expect(SESSION_COOKIE_OPTIONS).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 2_592_000,
    });
  });
});
