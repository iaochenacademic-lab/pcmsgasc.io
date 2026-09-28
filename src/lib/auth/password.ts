import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "@/lib/auth/constants";

const DEFAULT_INITIAL_PASSWORD_BYTES = 24;

export function generateInitialPassword(
  byteLength = DEFAULT_INITIAL_PASSWORD_BYTES,
): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16) {
    throw new RangeError("Initial password byte length must be an integer of at least 16.");
  }

  return randomBytes(byteLength).toString("base64url");
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
