/**
 * Placeholder emails (mirror of src/server/utils/placeholderEmail.ts): a person whose real email
 * isn't known yet has firstname.lastname@example.com. example.com can never receive mail and the
 * app never sends to it — the screens say "Placeholder email" and ask for the real one.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = 'example.com';

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
