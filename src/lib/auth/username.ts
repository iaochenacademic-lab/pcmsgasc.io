/** The normalization used both at login and when provisioning an account. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Accept only already-normalized usernames; the full match excludes final newlines. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.exec(username)?.[0] === username;
}
