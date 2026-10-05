import { useAuthStore } from '../stores/authStore';
import type { User } from '../stores/authStore';

/**
 * The company owner or a PMO: may choose line managers, change the email of someone who signs in,
 * and remove people who sign in (or their login). Project managers manage everyone else.
 * Same rule as the server (src/server/services/peopleRights.ts, user decision 2026-10-05).
 */
export function canManagePeople(user: User | null | undefined): boolean {
  return !!user && (user.role === 'pmo' || !!user.organization?.isOwner);
}

export function useCanManagePeople(): boolean {
  return canManagePeople(useAuthStore((s) => s.user));
}
