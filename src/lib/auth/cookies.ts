import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth/constants";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";
import type { SessionPayload } from "@/lib/auth/types";

export async function setSessionCookie(
  response: NextResponse,
  session: SessionPayload,
  now = new Date(),
): Promise<void> {
  const token = await createSessionToken(session, now);
  response.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}

export async function getSessionFromRequest(
  request: NextRequest,
  now = new Date(),
): Promise<SessionPayload | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? readSessionToken(token, now) : null;
}
