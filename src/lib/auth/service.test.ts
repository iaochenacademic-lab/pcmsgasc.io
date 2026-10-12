import { describe, expect, it, vi } from "vitest";
import { nextLoginFailureState, resetLoginFailureState } from "@/lib/auth/lockout";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  authenticateUser,
  changeUserPassword,
  type AuthServiceDependencies,
} from "@/lib/auth/service";
import type { UserRecord, UserRepository } from "@/lib/auth/user-repository";

const CURRENT_PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-04-05T06:07:08.000Z");

async function createMemoryRepository(overrides: Partial<UserRecord> = {}) {
  let storedUser: UserRecord | null = {
    id: "f0d37f77-b930-4676-9c07-a21de6fd7c31",
    username: "teacher-one",
    passwordHash: await hashPassword(CURRENT_PASSWORD),
    role: "teacher",
    name: "Teacher One",
    mustChangePassword: false,
    sessionVersion: 1,
    isActive: true,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };

  const calls = {
    recordLoginFailure: vi.fn(),
    resetLoginFailures: vi.fn(),
    updatePassword: vi.fn(),
  };

  const repository: UserRepository = {
    async findByUsername(username) {
      return storedUser?.username === username ? storedUser : null;
    },
    async findById(userId) {
      return storedUser?.id === userId ? storedUser : null;
    },
    async recordLoginFailure(userId) {
      calls.recordLoginFailure(userId);
      if (!storedUser || storedUser.id !== userId) return null;
      const next = nextLoginFailureState(
        { failedLoginCount: storedUser.failedLoginCount, lockedUntil: storedUser.lockedUntil },
        NOW,
      );
      storedUser = { ...storedUser, ...next };
      return next;
    },
    async resetLoginFailures(userId) {
      calls.resetLoginFailures(userId);
      if (storedUser?.id !== userId || !storedUser.isActive) return false;
      if (storedUser.lockedUntil && Date.parse(storedUser.lockedUntil) > NOW.getTime()) return false;
      storedUser = { ...storedUser, ...resetLoginFailureState() };
      return true;
    },
    async changePassword(userId, passwordHash, expectedSessionVersion) {
      calls.updatePassword(userId, passwordHash);
      if (storedUser?.id !== userId || !storedUser.isActive || storedUser.sessionVersion !== expectedSessionVersion) return null;
      storedUser = {
        ...storedUser,
        passwordHash,
        sessionVersion: storedUser.sessionVersion + 1,
        mustChangePassword: false,
        ...resetLoginFailureState(),
        updatedAt: NOW.toISOString(),
      };
      return storedUser.sessionVersion;
    },
  };

  return {
    repository,
    calls,
    get user() {
      return storedUser;
    },
    revokeSessions() {
      if (storedUser) storedUser = { ...storedUser, sessionVersion: storedUser.sessionVersion + 1 };
    },
    lockAccount() {
      if (storedUser) {
        storedUser = {
          ...storedUser,
          failedLoginCount: 10,
          lockedUntil: new Date(NOW.getTime() + 300_000).toISOString(),
        };
      }
    },
  };
}

function dependencies(repository: UserRepository): AuthServiceDependencies {
  return { repository, now: () => NOW };
}

describe("authentication service", () => {
  it("returns the same invalid-credentials result for an unknown user and a wrong password", async () => {
    const { repository } = await createMemoryRepository();
    const deps = dependencies(repository);

    const unknownUser = await authenticateUser(
      { username: "missing-user", password: CURRENT_PASSWORD },
      deps,
    );
    const wrongPassword = await authenticateUser(
      { username: " TEACHER-ONE ", password: "not-the-password" },
      deps,
    );

    expect(unknownUser).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(wrongPassword).toEqual(unknownUser);
  });

  it("performs a cost-12 dummy comparison for an unknown username", async () => {
    const memory = await createMemoryRepository();
    const compare = vi.fn(verifyPassword);

    const result = await authenticateUser(
      { username: "missing-user", password: "incorrect-password" },
      { ...dependencies(memory.repository), verifyPassword: compare },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(compare).toHaveBeenCalledTimes(1);
    const comparedHash = compare.mock.calls[0]![1];
    expect(comparedHash).not.toBe(memory.user?.passwordHash);
    const bcrypt = await import("bcryptjs");
    expect(bcrypt.default.getRounds(comparedHash)).toBe(12);
  });

  it("rejects a locked user without invoking bcrypt comparison", async () => {
    const { repository } = await createMemoryRepository({
      failedLoginCount: 10,
      lockedUntil: new Date(NOW.getTime() + 300_000).toISOString(),
    });
    const compare = vi.fn(verifyPassword);

    const result = await authenticateUser(
      { username: "teacher-one", password: CURRENT_PASSWORD },
      { ...dependencies(repository), verifyPassword: compare },
    );

    expect(result).toEqual({ ok: false, reason: "locked" });
    expect(compare).not.toHaveBeenCalled();
  });

  it("locks the user on the tenth invalid password", async () => {
    const memory = await createMemoryRepository({ failedLoginCount: 9 });
    const compare = vi.fn(async () => false);

    const result = await authenticateUser(
      { username: "teacher-one", password: "wrong-password" },
      { ...dependencies(memory.repository), verifyPassword: compare },
    );

    expect(result).toEqual({ ok: false, reason: "locked" });
    expect(memory.calls.recordLoginFailure).toHaveBeenCalledTimes(1);
    expect(memory.user?.failedLoginCount).toBe(10);
    expect(memory.user?.lockedUntil).toBe(new Date(NOW.getTime() + 300_000).toISOString());
  });

  it("does not clear a lock created while a valid password comparison is in flight", async () => {
    const memory = await createMemoryRepository({ failedLoginCount: 9 });
    const compare = vi.fn(async () => {
      memory.lockAccount();
      return true;
    });

    const result = await authenticateUser(
      { username: "teacher-one", password: CURRENT_PASSWORD },
      { ...dependencies(memory.repository), verifyPassword: compare },
    );

    expect(result).toEqual({ ok: false, reason: "locked" });
    expect(memory.calls.resetLoginFailures).toHaveBeenCalledWith(memory.user?.id);
    expect(memory.user?.failedLoginCount).toBe(10);
    expect(memory.user?.lockedUntil).toBe(new Date(NOW.getTime() + 300_000).toISOString());
  });

  it("allows a valid login and clears accumulated failures", async () => {
    const memory = await createMemoryRepository({ failedLoginCount: 4 });

    const result = await authenticateUser(
      { username: "teacher-one", password: CURRENT_PASSWORD },
      dependencies(memory.repository),
    );

    expect(result).toMatchObject({ ok: true, session: { role: "teacher" } });
    expect(memory.calls.resetLoginFailures).toHaveBeenCalledWith(memory.user?.id);
    expect(memory.user?.failedLoginCount).toBe(0);
    expect(memory.user?.lockedUntil).toBeNull();
  });

  it("preserves the first-login password-change requirement in the session", async () => {
    const { repository } = await createMemoryRepository({ mustChangePassword: true });

    const result = await authenticateUser(
      { username: "teacher-one", password: CURRENT_PASSWORD },
      dependencies(repository),
    );

    expect(result).toMatchObject({ ok: true, session: { mustChangePassword: true } });
  });

  it("requires the current password and clears first-login state only after storing a cost-12 hash", async () => {
    const memory = await createMemoryRepository({ mustChangePassword: true });
    const input = {
      userId: memory.user!.id,
      sessionVersion: memory.user!.sessionVersion,
      currentPassword: CURRENT_PASSWORD,
      newPassword: "a-new-strong-password",
    };

    const rejected = await changeUserPassword(
      { ...input, currentPassword: "incorrect-current-password" },
      dependencies(memory.repository),
    );
    expect(rejected).toEqual({ ok: false, reason: "invalid_current_password" });
    expect(memory.calls.updatePassword).not.toHaveBeenCalled();
    expect(memory.user?.mustChangePassword).toBe(true);

    const changed = await changeUserPassword(input, dependencies(memory.repository));
    expect(changed).toMatchObject({ ok: true, session: { mustChangePassword: false } });
    expect(memory.calls.updatePassword).toHaveBeenCalledTimes(1);
    expect(changed).toMatchObject({ ok: true, session: { sessionVersion: 2 } });
    expect(memory.user?.mustChangePassword).toBe(false);
    expect(memory.user?.failedLoginCount).toBe(0);
    expect(await verifyPassword(input.newPassword, memory.user!.passwordHash)).toBe(true);
    const bcrypt = await import("bcryptjs");
    expect(bcrypt.default.getRounds(memory.user!.passwordHash)).toBe(12);
  });

  it("rejects a new password below the shared minimum length", async () => {
    const memory = await createMemoryRepository();

    await expect(
      changeUserPassword(
        {
          userId: memory.user!.id,
          sessionVersion: memory.user!.sessionVersion,
          currentPassword: CURRENT_PASSWORD,
          newPassword: "short",
        },
        dependencies(memory.repository),
      ),
    ).resolves.toEqual({ ok: false, reason: "invalid_new_password" });
    expect(memory.calls.updatePassword).not.toHaveBeenCalled();
  });

  it("performs the same dummy comparison for a deactivated account", async () => {
    const memory = await createMemoryRepository({ isActive: false });
    const compare = vi.fn(verifyPassword);

    const result = await authenticateUser(
      { username: "teacher-one", password: CURRENT_PASSWORD },
      { ...dependencies(memory.repository), verifyPassword: compare },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![1]).not.toBe(memory.user?.passwordHash);
    const bcrypt = await import("bcryptjs");
    expect(bcrypt.default.getRounds(compare.mock.calls[0]![1])).toBe(12);
    expect(memory.calls.recordLoginFailure).not.toHaveBeenCalled();
    expect(memory.calls.resetLoginFailures).not.toHaveBeenCalled();
  });

  it("includes the database session version when signing in", async () => {
    const memory = await createMemoryRepository({ sessionVersion: 7 });

    await expect(authenticateUser(
      { username: "teacher-one", password: CURRENT_PASSWORD },
      dependencies(memory.repository),
    )).resolves.toMatchObject({ ok: true, session: { sessionVersion: 7 } });
  });

  it("rejects password changes from an already revoked session without comparing a password", async () => {
    const memory = await createMemoryRepository({ sessionVersion: 2 });
    const compare = vi.fn(verifyPassword);

    await expect(changeUserPassword(
      { userId: memory.user!.id, sessionVersion: 1, currentPassword: CURRENT_PASSWORD, newPassword: "another-strong-password" },
      { ...dependencies(memory.repository), verifyPassword: compare },
    )).resolves.toEqual({ ok: false, reason: "user_not_found" });
    expect(compare).not.toHaveBeenCalled();
    expect(memory.calls.updatePassword).not.toHaveBeenCalled();
  });

  it("does not overwrite a password after the session is revoked while hashing", async () => {
    const memory = await createMemoryRepository();
    const originalHash = memory.user!.passwordHash;
    const hash = vi.fn(async (password: string) => {
      memory.revokeSessions();
      return hashPassword(password);
    });

    await expect(changeUserPassword(
      { userId: memory.user!.id, sessionVersion: 1, currentPassword: CURRENT_PASSWORD, newPassword: "another-strong-password" },
      { ...dependencies(memory.repository), hashPassword: hash },
    )).resolves.toEqual({ ok: false, reason: "user_not_found" });
    expect(memory.user?.passwordHash).toBe(originalHash);
    expect(memory.user?.sessionVersion).toBe(2);
  });

  it("rejects password changes for deactivated accounts", async () => {
    const memory = await createMemoryRepository({ isActive: false });
    const compare = vi.fn(verifyPassword);

    await expect(changeUserPassword(
      { userId: memory.user!.id, sessionVersion: 1, currentPassword: CURRENT_PASSWORD, newPassword: "another-strong-password" },
      { ...dependencies(memory.repository), verifyPassword: compare },
    )).resolves.toEqual({ ok: false, reason: "user_not_found" });
    expect(compare).not.toHaveBeenCalled();
    expect(memory.calls.updatePassword).not.toHaveBeenCalled();
  });
});
