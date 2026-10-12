import "server-only";
import { DUMMY_PASSWORD_HASH, MAX_FAILED_LOGIN_ATTEMPTS } from "@/lib/auth/constants";
import { isAccountLocked } from "@/lib/auth/lockout";
import { hashPassword as defaultHashPassword, verifyPassword as defaultVerifyPassword } from "@/lib/auth/password";
import { normalizeUsername, parseLoginInput, validateNewPassword } from "@/lib/auth/validation";
import type { ChangePasswordInput, LoginInput, SessionPayload } from "@/lib/auth/types";
import type { UserRepository } from "@/lib/auth/user-repository";

export interface AuthServiceDependencies {
  repository: UserRepository;
  verifyPassword?: (password: string, passwordHash: string) => Promise<boolean>;
  hashPassword?: (password: string) => Promise<string>;
  now?: () => Date;
}

export type AuthResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; reason: "invalid_credentials" | "locked" };

export type ChangePasswordResult =
  | { ok: true; session: SessionPayload }
  | {
      ok: false;
      reason: "invalid_current_password" | "invalid_new_password" | "user_not_found";
    };

function toSessionPayload(user: {
  id: string;
  username: string;
  role: SessionPayload["role"];
  name: string;
  mustChangePassword: boolean;
  sessionVersion: number;
}): SessionPayload {
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    mustChangePassword: user.mustChangePassword,
    sessionVersion: user.sessionVersion,
  };
}

export async function authenticateUser(
  input: LoginInput,
  deps: AuthServiceDependencies,
): Promise<AuthResult> {
  const validInput = parseLoginInput(input);
  if (!validInput) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const verify = deps.verifyPassword ?? defaultVerifyPassword;
  const user = await deps.repository.findByUsername(normalizeUsername(validInput.username));
  if (!user || !user.isActive) {
    await verify(validInput.password, DUMMY_PASSWORD_HASH);
    return { ok: false, reason: "invalid_credentials" };
  }

  const now = deps.now?.() ?? new Date();
  if (isAccountLocked(user.lockedUntil, now)) {
    return { ok: false, reason: "locked" };
  }

  const isValidPassword = await verify(validInput.password, user.passwordHash);
  if (!isValidPassword) {
    const failure = await deps.repository.recordLoginFailure(user.id);
    if (
      failure === null ||
      failure.failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS ||
      isAccountLocked(failure.lockedUntil, now)
    ) {
      return { ok: false, reason: "locked" };
    }

    return { ok: false, reason: "invalid_credentials" };
  }

  if (!(await deps.repository.resetLoginFailures(user.id))) {
    return { ok: false, reason: "locked" };
  }
  return { ok: true, session: toSessionPayload(user) };
}

export async function changeUserPassword(
  input: ChangePasswordInput,
  deps: AuthServiceDependencies,
): Promise<ChangePasswordResult> {
  if (validateNewPassword(input.newPassword) !== null || input.newPassword === input.currentPassword) {
    return { ok: false, reason: "invalid_new_password" };
  }

  const user = await deps.repository.findById(input.userId);
  if (!user || !user.isActive || user.sessionVersion !== input.sessionVersion) {
    return { ok: false, reason: "user_not_found" };
  }

  const verify = deps.verifyPassword ?? defaultVerifyPassword;
  if (!(await verify(input.currentPassword, user.passwordHash))) {
    return { ok: false, reason: "invalid_current_password" };
  }

  const hash = deps.hashPassword ?? defaultHashPassword;
  const passwordHash = await hash(input.newPassword);
  const sessionVersion = await deps.repository.changePassword(user.id, passwordHash, input.sessionVersion);
  if (sessionVersion === null) {
    return { ok: false, reason: "user_not_found" };
  }

  return {
    ok: true,
    session: toSessionPayload({ ...user, mustChangePassword: false, sessionVersion }),
  };
}
