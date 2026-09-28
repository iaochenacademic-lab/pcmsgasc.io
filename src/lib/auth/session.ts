import { Buffer } from "node:buffer";
import "server-only";
import { EncryptJWT, jwtDecrypt } from "jose";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/constants";
import type { SessionPayload, UserRole } from "@/lib/auth/types";

function getSessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;

  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new Error("SESSION_SECRET must be a 32-byte base64url-encoded value.");
  }

  const key = Buffer.from(secret, "base64url");
  if (key.byteLength !== 32 || key.toString("base64url") !== secret) {
    throw new Error("SESSION_SECRET must be a canonical 32-byte base64url-encoded value.");
  }

  return new Uint8Array(key);
}

function isSessionPayload(value: Record<string, unknown>): value is Record<string, unknown> & SessionPayload {
  return (
    typeof value.userId === "string" &&
    typeof value.username === "string" &&
    (value.role === "teacher" || value.role === "member") &&
    typeof value.name === "string" &&
    typeof value.mustChangePassword === "boolean"
  );
}

export async function createSessionToken(
  payload: SessionPayload,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1_000);

  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .encrypt(getSessionKey());
}

export async function readSessionToken(
  token: string,
  now = new Date(),
): Promise<SessionPayload | null> {
  const key = getSessionKey();

  try {
    const { payload } = await jwtDecrypt(token, key, { currentDate: now });
    if (!isSessionPayload(payload)) {
      return null;
    }

    const session: SessionPayload = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role as UserRole,
      name: payload.name,
      mustChangePassword: payload.mustChangePassword,
    };

    return session;
  } catch {
    return null;
  }
}
