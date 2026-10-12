import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireRole, requireSession } from "@/lib/auth/guards";
import { loadValidUser } from "@/lib/auth/current-user";
import type { SessionPayload } from "@/lib/auth/types";
import type { UserRecord } from "@/lib/auth/user-repository";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  readSessionToken: vi.fn(),
  findById: vi.fn(),
  createAdminClient: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({ readSessionToken: mocks.readSessionToken }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/auth/user-repository", () => ({
  createSupabaseUserRepository: () => ({ findById: mocks.findById }),
}));

const session: SessionPayload = {
  userId: "user-one",
  username: "old-username",
  name: "Old Name",
  role: "member",
  mustChangePassword: false,
  sessionVersion: 2,
};
const user: UserRecord = {
  id: "user-one",
  username: "current-username",
  name: "Current Name",
  role: "teacher",
  mustChangePassword: false,
  passwordHash: "unused-test-hash",
  sessionVersion: 2,
  isActive: true,
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("database-backed session guards", () => {
  beforeEach(() => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "test-token" }) });
    mocks.readSessionToken.mockResolvedValue(session);
    mocks.findById.mockResolvedValue(user);
  });

  it("does not query the repository without a session", async () => {
    expect(await loadValidUser(null, { findById: mocks.findById })).toBeNull();
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it.each([
    ["missing user", null],
    ["disabled user", { ...user, isActive: false }],
    ["revoked session", { ...user, sessionVersion: 3 }],
  ])("rejects a %s", async (_label, currentUser) => {
    mocks.findById.mockResolvedValue(currentUser);
    expect(await loadValidUser(session, { findById: mocks.findById })).toBeNull();
    await expect(requireSession()).rejects.toThrow("REDIRECT:/auth/expired");
  });

  it("redirects a missing or unreadable cookie through the expiry handler", async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    await expect(requireSession()).rejects.toThrow("REDIRECT:/auth/expired");
    expect(mocks.findById).not.toHaveBeenCalled();

    mocks.cookies.mockResolvedValue({ get: () => ({ value: "invalid-token" }) });
    mocks.readSessionToken.mockResolvedValue(null);
    await expect(requireSession()).rejects.toThrow("REDIRECT:/auth/expired");
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("returns current database identity and permissions without password fields", async () => {
    const current = await requireSession();
    expect(current).toEqual({
      userId: user.id,
      username: user.username,
      role: "teacher",
      name: "Current Name",
      mustChangePassword: false,
      sessionVersion: 2,
    });
    expect(mocks.findById).toHaveBeenCalledExactlyOnceWith(session.userId);
    expect(current).not.toHaveProperty("passwordHash");
  });

  it("uses the database role rather than the stale cookie role", async () => {
    await expect(requireRole("teacher")).resolves.toMatchObject({ role: "teacher" });
    await expect(requireRole("member")).rejects.toThrow("REDIRECT:/teacher");
  });

  it("requires password change according to the database", async () => {
    mocks.findById.mockResolvedValue({ ...user, mustChangePassword: true });
    await expect(requireRole("teacher")).rejects.toThrow("REDIRECT:/change-password");
  });

  it("does not authorize a user if the database check fails", async () => {
    mocks.findById.mockRejectedValue(new Error("Database unavailable"));
    await expect(requireSession()).rejects.toThrow("Database unavailable");
  });
});
