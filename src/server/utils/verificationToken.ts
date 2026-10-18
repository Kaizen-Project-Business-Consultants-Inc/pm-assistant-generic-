import crypto from 'crypto';

/** How long a confirm-your-email link works */
const VERIFICATION_LINK_MS = 24 * 60 * 60 * 1000;

/** A fresh confirm-your-email link, as the two user fields that store it (an older link stops working) */
export function newVerificationToken(): { emailVerificationToken: string; emailVerificationExpires: Date } {
  return { emailVerificationToken: crypto.randomUUID(), emailVerificationExpires: new Date(Date.now() + VERIFICATION_LINK_MS) };
}
