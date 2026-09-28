import { LOCKOUT_DURATION_SECONDS, MAX_FAILED_LOGIN_ATTEMPTS } from "@/lib/auth/constants";
import type { LoginFailureState } from "@/lib/auth/types";

export function isAccountLocked(
  lockedUntil: string | Date | null,
  now = new Date(),
): boolean {
  if (lockedUntil === null) {
    return false;
  }

  const deadline = lockedUntil instanceof Date ? lockedUntil.getTime() : Date.parse(lockedUntil);
  return Number.isFinite(deadline) && deadline > now.getTime();
}

export function nextLoginFailureState(
  state: LoginFailureState,
  now = new Date(),
): LoginFailureState {
  if (isAccountLocked(state.lockedUntil, now)) {
    return { ...state };
  }

  const failedLoginCount = state.lockedUntil === null ? state.failedLoginCount + 1 : 1;
  const lockedUntil =
    failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_DURATION_SECONDS * 1_000).toISOString()
      : null;

  return { failedLoginCount, lockedUntil };
}

export function resetLoginFailureState(): LoginFailureState {
  return { failedLoginCount: 0, lockedUntil: null };
}
