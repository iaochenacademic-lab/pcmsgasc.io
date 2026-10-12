import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  createSupabaseUserRepository,
  createUserRepository,
  type UserDatabaseRow,
  type UserRepositoryClient,
} from "@/lib/auth/user-repository";

const DATABASE_USER: UserDatabaseRow = {
  id: "2e241e83-529d-4487-8eeb-06ef5ed335a9",
  username: "teacher-one",
  password_hash: "$2b$12$examplehashedcredentialstoredonlyintheserver0123456789012",
  role: "teacher",
  name: "Teacher One",
  must_change_password: true,
  session_version: 3,
  is_active: true,
  failed_login_count: 3,
  locked_until: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

function makeClient(overrides: Partial<UserRepositoryClient> = {}) {
  const client: UserRepositoryClient = {
    fetchUserByUsername: vi.fn(async () => ({ data: DATABASE_USER, error: null })),
    fetchUserById: vi.fn(async () => ({ data: DATABASE_USER, error: null })),
    recordLoginFailure: vi.fn(async () => ({
      data: { failedLoginCount: 10, lockedUntil: "2026-03-04T05:11:07.000Z" },
      error: null,
    })),
    resetLoginFailures: vi.fn(async () => ({ data: true, error: null })),
    changePassword: vi.fn(async () => ({ data: 4, error: null })),
    ...overrides,
  };
  return client;
}

describe("user repository", () => {
  it("maps database snake_case fields to a server-side user record", async () => {
    const client = makeClient();
    const repository = createUserRepository(client);
    const user = await repository.findByUsername("teacher-one");

    expect(user).toEqual({
      id: DATABASE_USER.id,
      username: DATABASE_USER.username,
      passwordHash: DATABASE_USER.password_hash,
      role: "teacher",
      name: DATABASE_USER.name,
      mustChangePassword: true,
      sessionVersion: 3,
      isActive: true,
      failedLoginCount: 3,
      lockedUntil: null,
      createdAt: DATABASE_USER.created_at,
      updatedAt: DATABASE_USER.updated_at,
    });
    expect(Object.keys(user ?? {})).not.toContain("password");
    expect(client.fetchUserByUsername).toHaveBeenCalledWith("teacher-one");
  });

  it("rejects an unexpected role rather than trusting a database string", async () => {
    const repository = createUserRepository(makeClient({
      fetchUserById: async () => ({ data: { ...DATABASE_USER, role: "administrator" }, error: null }),
    }));
    await expect(repository.findById(DATABASE_USER.id)).rejects.toThrow("User repository operation failed.");
  });

  it("returns the atomic lockout result from the database function", async () => {
    const client = makeClient();
    const repository = createUserRepository(client);
    await expect(repository.recordLoginFailure(DATABASE_USER.id)).resolves.toEqual({
      failedLoginCount: 10,
      lockedUntil: "2026-03-04T05:11:07.000Z",
    });
    expect(client.recordLoginFailure).toHaveBeenCalledWith(DATABASE_USER.id);
  });

  it("returns the atomic successful-login reset result", async () => {
    const client = makeClient();
    const repository = createUserRepository(client);
    await expect(repository.resetLoginFailures(DATABASE_USER.id)).resolves.toBe(true);
    expect(client.resetLoginFailures).toHaveBeenCalledWith(DATABASE_USER.id);
  });

  it("preserves a failed atomic reset instead of issuing an ordinary update", async () => {
    const repository = createUserRepository(makeClient({
      resetLoginFailures: async () => ({ data: false, error: null }),
    }));
    await expect(repository.resetLoginFailures(DATABASE_USER.id)).resolves.toBe(false);
  });

  it("passes the expected session version and returns the new password version", async () => {
    const client = makeClient();
    const repository = createUserRepository(client);
    await expect(repository.changePassword(DATABASE_USER.id, "$2b$12$newhashvalue", 3)).resolves.toBe(4);
    expect(client.changePassword).toHaveBeenCalledWith(DATABASE_USER.id, "$2b$12$newhashvalue", 3);
  });

  it("returns null when a password change loses its version comparison", async () => {
    const repository = createUserRepository(makeClient({
      changePassword: async () => ({ data: null, error: null }),
    }));
    await expect(repository.changePassword(DATABASE_USER.id, "$2b$12$newhashvalue", 3)).resolves.toBeNull();
  });

  it("uses restricted RPCs for successful-login reset and password changes", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: 4, error: null });
    const repository = createSupabaseUserRepository({ rpc } as unknown as SupabaseClient<Database>);

    await expect(repository.resetLoginFailures(DATABASE_USER.id)).resolves.toBe(true);
    await expect(repository.changePassword(DATABASE_USER.id, "$2b$12$newhashvalue", 3)).resolves.toBe(4);
    expect(rpc).toHaveBeenNthCalledWith(1, "reset_login_failures", { p_user_id: DATABASE_USER.id });
    expect(rpc).toHaveBeenNthCalledWith(2, "change_user_password", {
      p_user_id: DATABASE_USER.id,
      p_password_hash: "$2b$12$newhashvalue",
      p_expected_session_version: 3,
    });
  });

  it("does not expose raw database error details", async () => {
    const repository = createUserRepository(makeClient({
      fetchUserByUsername: async () => ({
        data: null,
        error: new Error("sensitive postgres connection detail"),
      }),
    }));
    await expect(repository.findByUsername("teacher-one")).rejects.not.toThrow(
      "sensitive postgres connection detail",
    );
  });

  it("does not expose errors from restricted write RPCs", async () => {
    const error = new Error("sensitive postgres connection detail");
    const repository = createUserRepository(makeClient({
      resetLoginFailures: async () => ({ data: false, error }),
      changePassword: async () => ({ data: null, error }),
    }));
    await expect(repository.resetLoginFailures(DATABASE_USER.id)).rejects.toThrow("User repository operation failed.");
    await expect(repository.changePassword(DATABASE_USER.id, "$2b$12$newhashvalue", 3)).rejects.toThrow("User repository operation failed.");
  });
});
