import bcrypt from 'bcryptjs';
import { hasPassword, NO_PASSWORD_MESSAGE } from './googleOnlyAccount';

/**
 * Changing who an account belongs to (its email, its username) needs the current password, so a
 * session left open on someone else's screen can't hand the account over. Shared by
 * PUT /users/me/profile and POST /auth/change-pending-email. Null = the password is right.
 */
export async function currentPasswordRefusal(
  user: { passwordHash?: string | null },
  given: string | undefined,
  what: string,
): Promise<{ status: 400; body: { error: string; message: string } } | null> {
  if (!hasPassword(user)) return { status: 400, body: { error: 'No password', message: NO_PASSWORD_MESSAGE } };
  if (!given) return { status: 400, body: { error: 'Password required', message: `Enter your current password to change your ${what}.` } };
  if (!(await bcrypt.compare(given, user.passwordHash!))) {
    return { status: 400, body: { error: 'Invalid password', message: `Your current password isn't right, so your ${what} wasn't changed.` } };
  }
  return null;
}
