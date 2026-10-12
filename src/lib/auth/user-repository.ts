import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { LoginFailureState, UserRole } from "@/lib/auth/types";

export type UserDatabaseRow = Database["public"]["Tables"]["users"]["Row"];
export type UserUpdate = Database["public"]["Tables"]["users"]["Update"];

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  name: string;
  mustChangePassword: boolean;
  sessionVersion: number;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryResult<T> {
  data: T;
  error: unknown | null;
}

export interface UserRepositoryClient {
  fetchUserByUsername(username: string): Promise<RepositoryResult<UserDatabaseRow | null>>;
  fetchUserById(userId: string): Promise<RepositoryResult<UserDatabaseRow | null>>;
  recordLoginFailure(userId: string): Promise<RepositoryResult<LoginFailureState | null>>;
  resetLoginFailures(userId: string): Promise<RepositoryResult<boolean>>;
  changePassword(userId: string, passwordHash: string, expectedSessionVersion: number): Promise<RepositoryResult<number | null>>;
}

export interface UserRepository {
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(userId: string): Promise<UserRecord | null>;
  recordLoginFailure(userId: string): Promise<LoginFailureState | null>;
  resetLoginFailures(userId: string): Promise<boolean>;
  changePassword(userId: string, passwordHash: string, expectedSessionVersion: number): Promise<number | null>;
}

const OPERATION_FAILED = "User repository operation failed.";

function mapUserRecord(row: UserDatabaseRow): UserRecord {
  if (row.role !== "teacher" && row.role !== "member") {
    throw new Error(OPERATION_FAILED);
  }

  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    name: row.name,
    mustChangePassword: row.must_change_password,
    sessionVersion: row.session_version,
    isActive: row.is_active,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function throwOnDatabaseError(error: unknown | null): void {
  if (error !== null) {
    throw new Error(OPERATION_FAILED);
  }
}

export function createUserRepository(client: UserRepositoryClient): UserRepository {
  async function findUser(
    fetch: () => Promise<RepositoryResult<UserDatabaseRow | null>>,
  ): Promise<UserRecord | null> {
    const result = await fetch();
    throwOnDatabaseError(result.error);
    return result.data ? mapUserRecord(result.data) : null;
  }

  return {
    findByUsername: (username) =>
      findUser(() => client.fetchUserByUsername(username)),
    findById: (userId) => findUser(() => client.fetchUserById(userId)),
    async recordLoginFailure(userId) {
      const result = await client.recordLoginFailure(userId);
      throwOnDatabaseError(result.error);
      return result.data;
    },
    async resetLoginFailures(userId) {
      const result = await client.resetLoginFailures(userId);
      throwOnDatabaseError(result.error);
      return result.data;
    },
    async changePassword(userId, passwordHash, expectedSessionVersion) {
      const result = await client.changePassword(userId, passwordHash, expectedSessionVersion);
      throwOnDatabaseError(result.error);
      return result.data;
    },
  };
}

export function createSupabaseUserRepository(client: SupabaseClient<Database>): UserRepository {
  const repositoryClient: UserRepositoryClient = {
    async fetchUserByUsername(username) {
      const { data, error } = await client
        .from("users")
        .select("*")
        .eq("username", username)
        .maybeSingle();
      return { data, error };
    },
    async fetchUserById(userId) {
      const { data, error } = await client
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      return { data, error };
    },
    async recordLoginFailure(userId) {
      const { data, error } = await client.rpc("record_login_failure", {
        p_user_id: userId,
      });
      if (error) {
        return { data: null, error };
      }

      const result = data[0];
      return {
        data: result
          ? {
              failedLoginCount: result.failed_login_count,
              lockedUntil: result.locked_until,
            }
          : null,
        error: null,
      };
    },
    async resetLoginFailures(userId) {
      const { data, error } = await client.rpc("reset_login_failures", {
        p_user_id: userId,
      });
      return { data: data === true, error };
    },
    async changePassword(userId, passwordHash, expectedSessionVersion) {
      const { data, error } = await client.rpc("change_user_password", {
        p_user_id: userId,
        p_password_hash: passwordHash,
        p_expected_session_version: expectedSessionVersion,
      });
      return { data, error };
    },
  };

  return createUserRepository(repositoryClient);
}
