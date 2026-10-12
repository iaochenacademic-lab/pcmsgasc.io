import "server-only";
import type { SessionPayload } from "@/lib/auth/types";
import type { UserRecord, UserRepository } from "@/lib/auth/user-repository";

export async function loadValidUser(
  session: SessionPayload | null,
  repository: Pick<UserRepository, "findById">,
): Promise<UserRecord | null> {
  if (!session) {
    return null;
  }

  const user = await repository.findById(session.userId);
  return user?.isActive && user.sessionVersion === session.sessionVersion ? user : null;
}

export function currentUserSession(user: UserRecord): SessionPayload {
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    mustChangePassword: user.mustChangePassword,
    sessionVersion: user.sessionVersion,
  };
}
