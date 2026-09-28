import { describe, expect, it } from "vitest";
import {
  isAccountLocked,
  nextLoginFailureState,
  resetLoginFailureState,
} from "@/lib/auth/lockout";

const NOW = new Date("2026-01-02T03:04:05.000Z");

describe("account lockout state", () => {
  it.each([
    [{ failedLoginCount: 0, lockedUntil: null }, { failedLoginCount: 1, lockedUntil: null }],
    [{ failedLoginCount: 8, lockedUntil: null }, { failedLoginCount: 9, lockedUntil: null }],
  ])("increments a failure without prematurely locking: %o", (state, expected) => {
    expect(nextLoginFailureState(state, NOW)).toEqual(expected);
  });

  it("locks for exactly five minutes on the tenth failure", () => {
    expect(
      nextLoginFailureState({ failedLoginCount: 9, lockedUntil: null }, NOW),
    ).toEqual({
      failedLoginCount: 10,
      lockedUntil: new Date(NOW.getTime() + 300_000).toISOString(),
    });
  });

  it("considers an account locked only before the lock deadline", () => {
    const deadline = new Date(NOW.getTime() + 300_000);

    expect(isAccountLocked(deadline, new Date(deadline.getTime() - 1))).toBe(true);
    expect(isAccountLocked(deadline.toISOString(), deadline)).toBe(false);
    expect(isAccountLocked(null, NOW)).toBe(false);
  });

  it("starts again at one failure after an expired lock", () => {
    expect(
      nextLoginFailureState(
        { failedLoginCount: 10, lockedUntil: new Date(NOW.getTime() - 1).toISOString() },
        NOW,
      ),
    ).toEqual({ failedLoginCount: 1, lockedUntil: null });
  });

  it("does not change failure state while a lock is active", () => {
    const state = {
      failedLoginCount: 10,
      lockedUntil: new Date(NOW.getTime() + 1_000).toISOString(),
    };

    expect(nextLoginFailureState(state, NOW)).toEqual(state);
  });

  it("resets the failure count and lock timestamp", () => {
    expect(resetLoginFailureState()).toEqual({ failedLoginCount: 0, lockedUntil: null });
  });
});
