import { useAuthStore } from '../stores/authStore';
import type { User } from '../stores/authStore';

/**
 * Who may add, rename or remove clients and email a client report: a PMO or a project manager
 * (the company owner comes through as 'pmo'). Same rule as the server's project-groups routes.
 */
export function canManageClients(user: User | null | undefined): boolean {
  return !!user && (user.role === 'pmo' || user.role === 'project_manager');
}

export function useCanManageClients(): boolean {
  return canManageClients(useAuthStore((s) => s.user));
}
