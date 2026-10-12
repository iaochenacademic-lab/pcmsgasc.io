import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { currentUserSession, loadValidUser } from "@/lib/auth/current-user";
import { readSessionToken } from "@/lib/auth/session";
import type { SessionPayload, UserRole } from "@/lib/auth/types";
import { createSupabaseUserRepository } from "@/lib/auth/user-repository";
import { createAdminClient } from "@/lib/supabase/admin";

export async function requireSession(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await readSessionToken(token) : null;

  if (!session) {
    redirect("/auth/expired");
  }

  const user = await loadValidUser(
    session,
    createSupabaseUserRepository(createAdminClient()),
  );
  if (!user) {
    redirect("/auth/expired");
  }

  return currentUserSession(user);
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
