export type UserRole = "teacher" | "member";

export interface SessionPayload {
  userId: string;
  username: string;
  role: UserRole;
  name: string;
  mustChangePassword: boolean;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export interface LoginFailureState {
  failedLoginCount: number;
  lockedUntil: string | null;
}
