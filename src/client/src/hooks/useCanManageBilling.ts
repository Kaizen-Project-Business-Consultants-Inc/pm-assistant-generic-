import { useAuthStore, isPlatformAdmin } from '../stores/authStore';
import type { User } from '../stores/authStore';

/**
 * Billing (plan, payment details, AI token top-ups, seats) belongs to the company owner — the
 * server bills the owner's own payment account and refuses seat changes from anyone else. The
 * Kovarti platform admin may too. Everyone else is not shown the buttons.
 */
export function canManageBilling(user: User | null | undefined): boolean {
  return !!user && (user.organization?.isOwner === true || isPlatformAdmin(user));
}

export function useCanManageBilling(): boolean {
  return canManageBilling(useAuthStore((s) => s.user));
}
