import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { readSessionToken } from "@/lib/auth/session";
import type { SessionPayload, UserRole } from "@/lib/auth/types";

export async function requireSession(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await readSessionToken(token) : null;

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireRole(role: UserRole): Promise<SessionPayload> {
  const session = await requireSession();

  if (session.mustChangePassword) {
    redirect("/change-password");
  }

  if (session.role !== role) {
    redirect(session.role === "teacher" ? "/teacher" : "/member");
  }

  return session;
}
