/**
 * People who sign up with Google have no password (stored as an empty hash, which no password
 * matches). Wherever a password is asked for, they get this message instead of "wrong password" —
 * they can set one with "Forgot password?" (the reset link works for them too).
 */
export const NO_PASSWORD_MESSAGE =
  'This account signs in with Google. Use "Continue with Google", or set a password with "Forgot password?" on the sign-in page.';

/** Whether the account has a password at all (Google-only accounts don't) */
export function hasPassword(user: { passwordHash?: string | null }): boolean {
  return !!user.passwordHash;
}
