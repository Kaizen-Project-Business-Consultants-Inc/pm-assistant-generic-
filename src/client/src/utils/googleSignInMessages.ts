/**
 * What the sign-in page says when Google sign-in can't go ahead (the server sends ?google=<code>).
 * Every message says what to do next (wording from the approved mock, 2026-10-12).
 */
const MESSAGES: Record<string, string> = {
  unverified: "Google hasn't confirmed this email address. Confirm it with Google, or sign up with your email and a password.",
  'invite-other-address': 'This invitation is for a different email address. Sign in to Google with the address the invitation was sent to and try again.',
  'invite-invalid': 'This invitation link is invalid or has expired. Ask the person who invited you to send a new one.',
  expired: 'The sign-in took too long or was opened twice. Please click Continue with Google again.',
  'switched-off': "This account is switched off. Ask your company's Kovarti owner to switch it back on.",
  'guest-expired': 'Your guest access has expired. Please contact the project administrator.',
  cancelled: 'You cancelled at Google. Nothing was changed. Try again, or use your email and password.',
  'account-exists': 'An account with this email already exists. Sign in with Continue with Google or your password.',
  'rate-limited': 'Too many attempts. Please wait a few minutes and try again.',
  unavailable: 'Signing in with Google is not available right now. Use your email and password, or try again later.',
  'no-account': "There's no Kovarti account for that Google address yet. Create one below — Sign up with Google works too.",
  failed: 'Google did not finish the sign-in. Please try again.',
};

/** The message for a ?google= code, or null when there is none */
export function googleSignInMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? MESSAGES.failed;
}
