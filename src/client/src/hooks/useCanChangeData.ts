import { useAuthStore, type User } from '../stores/authStore';

/**
 * Roles the server lets change company data (requireScope 'write' — server/middleware/requireScope.ts).
 * Everyone else (executive, team member, finance officer, tester, viewer, …) is read-only there,
 * so buttons that change company-wide things are hidden for them, not left to fail
 * (hide, don't disable). canChangeDataRoles.test.ts keeps this list equal to the server's.
 */
export const WRITE_ROLES = ['admin', 'project_manager', 'scrum_master', 'risk_manager', 'pmo', 'ba', 'qa', 'devops'];

export function canChangeData(user: User | null | undefined): boolean {
  if (!user || user.isGuest) return false;
  if (user.supportSession) return false; // Support view is read-only
  return WRITE_ROLES.includes(user.role);
}

/** Whether the signed-in person may create or change company-wide things (projects, resources, workflows…) */
export function useCanChangeData(): boolean {
  return canChangeData(useAuthStore(s => s.user));
}
