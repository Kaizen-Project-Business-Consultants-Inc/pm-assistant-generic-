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

/**
 * Who may rename or delete ONE client: a PMO (the owner comes through as 'pmo'), or the project
 * manager who added it — a client is shared by every PM's projects (audit 2, L-g, 2026-10-11).
 * Same rule as the server's PUT/DELETE /project-groups/:id.
 */
export function canChangeClient(user: User | null | undefined, client: { createdBy?: string | null }): boolean {
  if (!user) return false;
  if (user.role === 'pmo') return true;
  return user.role === 'project_manager' && !!client.createdBy && client.createdBy === user.id;
}
