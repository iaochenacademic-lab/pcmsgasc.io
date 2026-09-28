import { describe, expect, it, vi } from "vitest";
import {
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
  failed_login_count: 3,
  locked_until: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const NOW = new Date("2026-03-04T05:06:07.000Z");

function makeClient(overrides: Partial<UserRepositoryClient> = {}) {
  const updateUser = vi.fn(async () => ({ data: true, error: null }));
  const client: UserRepositoryClient = {
    fetchUserByUsername: vi.fn(async () => ({ data: DATABASE_USER, error: null })),
    fetchUserById: vi.fn(async () => ({ data: DATABASE_USER, error: null })),
    recordLoginFailure: vi.fn(async () => ({
      data: { failedLoginCount: 10, lockedUntil: "2026-03-04T05:11:07.000Z" },
      error: null,
    })),
    updateUser,
    ...overrides,
  };

  return { client, updateUser };
}

describe("user repository", () => {
  it("maps database snake_case fields to a server-side user record", async () => {
    const { client } = makeClient();
    const repository = createUserRepository(client, () => NOW);

    const user = await repository.findByUsername("teacher-one");

    expect(user).toEqual({
      id: DATABASE_USER.id,
      username: DATABASE_USER.username,
      passwordHash: DATABASE_USER.password_hash,
      role: "teacher",
      name: DATABASE_USER.name,
      mustChangePassword: true,
      failedLoginCount: 3,
      lockedUntil: null,
      createdAt: DATABASE_USER.created_at,
      updatedAt: DATABASE_USER.updated_at,
    });
    expect(Object.keys(user ?? {})).not.toContain("password");
    expect(client.fetchUserByUsername).toHaveBeenCalledWith("teacher-one");
  });

  it("returns the atomic lockout result from the database function", async () => {
    const { client } = makeClient();
    const repository = createUserRepository(client, () => NOW);

    await expect(repository.recordLoginFailure(DATABASE_USER.id)).resolves.toEqual({
      failedLoginCount: 10,
      lockedUntil: "2026-03-04T05:11:07.000Z",
    });
    expect(client.recordLoginFailure).toHaveBeenCalledWith(DATABASE_USER.id);
  });

  it("clears failure count and lockout on successful authentication", async () => {
    const { client, updateUser } = makeClient();
    const repository = createUserRepository(client, () => NOW);

    await repository.resetLoginFailures(DATABASE_USER.id);

    expect(updateUser).toHaveBeenCalledWith(DATABASE_USER.id, {
      failed_login_count: 0,
      locked_until: null,
      updated_at: NOW.toISOString(),
    });
  });

  it("updates the password, first-login flag, lockout fields, and updated_at together", async () => {
    const { client, updateUser } = makeClient();
    const repository = createUserRepository(client, () => NOW);

    await expect(
      repository.updatePassword(DATABASE_USER.id, "$2b$12$newhashvalue"),
    ).resolves.toBe(true);

    expect(updateUser).toHaveBeenCalledWith(DATABASE_USER.id, {
      password_hash: "$2b$12$newhashvalue",
      must_change_password: false,
      failed_login_count: 0,
      locked_until: null,
      updated_at: NOW.toISOString(),
    });
  });

  it("does not expose raw database error details", async () => {
    const { client } = makeClient({
      fetchUserByUsername: async () => ({
        data: null,
        error: new Error("sensitive postgres connection detail"),
      }),
    });
    const repository = createUserRepository(client, () => NOW);

    await expect(repository.findByUsername("teacher-one")).rejects.not.toThrow(
      "sensitive postgres connection detail",
    );
  });
});
