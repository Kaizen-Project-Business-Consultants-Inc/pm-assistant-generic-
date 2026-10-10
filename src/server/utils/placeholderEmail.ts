/**
 * Placeholder emails for resources (2026-10-01).
 *
 * Every real person on the Resources list has an email. When the real one isn't known yet
 * (an imported plan names people only, or the list predates the rule) they get
 * firstname.lastname@example.com. example.com is reserved for documentation — it can never
 * receive mail — and the app never sends to it either (EmailService drops these recipients).
 * Generic roles ("Generic Developer") have no email at all.
 */

export const PLACEHOLDER_EMAIL_DOMAIN = 'example.com';

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/**
 * Domains with no mailboxes. Staging's test logins (qa.pm@pm.kpbc.ca and friends) live on the
 * staging host's own domain: every email to them bounced — dozens a day from the test runs
 * (2026-10-10) — and bounces on the Resend account prod shares push real customers' mail
 * toward spam.
 */
const NO_MAILBOX_DOMAINS = ['pm.kpbc.ca'];

/** A placeholder, or an address on a domain with no mailboxes: the app never emails these */
export function isUndeliverableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.trim().toLowerCase().split('@').pop();
  return isPlaceholderEmail(email) || NO_MAILBOX_DOMAINS.includes(domain ?? '');
}

/** firstname.lastname@example.com, kept apart from any email in `taken` (lower-cased) */
export function makePlaceholderEmail(name: string, taken: Set<string> = new Set()): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'resource';
  let email = `${slug}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  for (let n = 2; taken.has(email); n++) email = `${slug}.${n}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  return email;
}
