/**
 * The company owner may do everything a PMO can inside their company (user decision,
 * 2026-10-05) — company-wide workflows and AI settings, resource requests, every project of the
 * company, and the rest. Rather than add "or the owner" to each of ~20 checks, the owner's
 * permissions are a PMO's: authMiddleware sets request.user.role to 'pmo' for them, and
 * /auth/login and /auth/me send the same, so the app shows what the server allows. Their own
 * role (accountRole) is still what the screens show as "your role". Guests and the platform
 * admin are never elevated.
 */
export function permissionRole(role: string, opts: { isOwner: boolean; isGuest?: boolean }): string {
  if (opts.isOwner && !opts.isGuest && role !== 'admin') return 'pmo';
  return role;
}
