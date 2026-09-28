export const BCRYPT_COST = 12;

export const SESSION_MAX_AGE_SECONDS = 2_592_000;

export const MAX_FAILED_LOGIN_ATTEMPTS = 10;

export const LOCKOUT_DURATION_SECONDS = 300;

export const NEW_PASSWORD_MIN_LENGTH = 12;

export const SESSION_COOKIE_NAME = "club_session";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;
