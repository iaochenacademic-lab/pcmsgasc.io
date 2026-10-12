export type UserRole = "teacher" | "member";

export interface SessionPayload {
  userId: string;
  username: string;
  role: UserRole;
  name: string;
  mustChangePassword: boolean;
  sessionVersion: number;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface ChangePasswordInput {
  userId: string;
  sessionVersion: number;
  currentPassword: string;
  newPassword: string;
}

export interface LoginFailureState {
  failedLoginCount: number;
  lockedUntil: string | null;
}
