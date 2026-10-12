export const BCRYPT_COST = 12;

// A discarded random value was hashed at cost 12. This is not an account
// credential, has no retained password, and is deliberately non-secret.
export const DUMMY_PASSWORD_HASH = "$2b$12$1P1f4Bd0C7cr4FJTTR8eHOkWTQh6kHVyx2eIlw4qlB.5oN1iPEohq";

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
