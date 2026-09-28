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
  updateUser(userId: string, values: UserUpdate): Promise<RepositoryResult<boolean>>;
}

export interface UserRepository {
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(userId: string): Promise<UserRecord | null>;
  recordLoginFailure(userId: string): Promise<LoginFailureState | null>;
  resetLoginFailures(userId: string): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<boolean>;
}

const OPERATION_FAILED = "User repository operation failed.";

function mapUserRecord(row: UserDatabaseRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    name: row.name,
    mustChangePassword: row.must_change_password,
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

export function createUserRepository(
  client: UserRepositoryClient,
  now: () => Date = () => new Date(),
): UserRepository {
  async function findUser(
    fetch: () => Promise<RepositoryResult<UserDatabaseRow | null>>,
  ): Promise<UserRecord | null> {
    const result = await fetch();
    throwOnDatabaseError(result.error);
    return result.data ? mapUserRecord(result.data) : null;
  }

  async function updateUser(userId: string, values: UserUpdate): Promise<boolean> {
    const result = await client.updateUser(userId, values);
    throwOnDatabaseError(result.error);
    return result.data;
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
      const updated = await updateUser(userId, {
        failed_login_count: 0,
        locked_until: null,
        updated_at: now().toISOString(),
      });
      if (!updated) {
        throw new Error(OPERATION_FAILED);
      }
    },
    updatePassword(userId, passwordHash) {
      return updateUser(userId, {
        password_hash: passwordHash,
        must_change_password: false,
        failed_login_count: 0,
        locked_until: null,
        updated_at: now().toISOString(),
      });
    },
  };
}

export function createSupabaseUserRepository(
  client: SupabaseClient<Database>,
  now: () => Date = () => new Date(),
): UserRepository {
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
    async updateUser(userId, values) {
      const { data, error } = await client
        .from("users")
        .update(values)
        .eq("id", userId)
        .select("id")
        .maybeSingle();
      return { data: data !== null, error };
    },
  };

  return createUserRepository(repositoryClient, now);
}
