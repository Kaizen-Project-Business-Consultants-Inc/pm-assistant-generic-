/**
 * A sign-up that was never confirmed: the person filled in the form but never clicked the
 * "confirm your email" link, so never signed in (user decision, 2026-10-05). Such accounts — and
 * companies whose owner is one — are labelled "Never confirmed" in the admin pages and left out
 * of user / trial / customer counts. Nothing is deleted; confirming later makes them normal.
 *
 * SQL condition on a users row; pass the table alias.
 */
export function neverConfirmedSql(alias = 'users'): string {
  return `(COALESCE(${alias}.email_verified, 0) = 0 AND ${alias}.last_login_at IS NULL)`;
}
