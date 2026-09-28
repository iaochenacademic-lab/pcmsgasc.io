import { Buffer } from "node:buffer";
import "server-only";
import { NEW_PASSWORD_MIN_LENGTH } from "@/lib/auth/constants";
import type { LoginInput } from "@/lib/auth/types";

const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function parseLoginInput(input: unknown): LoginInput | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.username !== "string" || typeof candidate.password !== "string") {
    return null;
  }

  const username = normalizeUsername(candidate.username);
  if (
    username.length === 0 ||
    candidate.password.length === 0 ||
    Buffer.byteLength(candidate.password, "utf8") > BCRYPT_MAX_PASSWORD_BYTES
  ) {
    return null;
  }

  return { username, password: candidate.password };
}

export type NewPasswordValidationError = "too_short" | "too_long";

export function validateNewPassword(password: unknown): NewPasswordValidationError | null {
  if (typeof password !== "string" || Array.from(password).length < NEW_PASSWORD_MIN_LENGTH) {
    return "too_short";
  }

  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_PASSWORD_BYTES) {
    return "too_long";
  }

  return null;
}
