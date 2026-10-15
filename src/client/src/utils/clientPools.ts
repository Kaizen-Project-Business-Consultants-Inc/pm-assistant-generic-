/**
 * Client resource pools (user 2026-10-14, U8) are for the consultant plans and the free trial
 * (which is full Pro): each client has its own people, rate card and holiday calendar, managed
 * in Resources. Team and Enterprise plans keep one company-wide list for now.
 */
const POOL_TIERS = ['trial', 'consultant_basic', 'consultant_pro'];

export function usesClientPools(user: { subscriptionTier?: string | null } | null | undefined): boolean {
  return !!user?.subscriptionTier && POOL_TIERS.includes(user.subscriptionTier);
}

/** The "My resources" pool's key in screens and the API (`?pool=mine`) */
export const MY_RESOURCES = 'mine';
