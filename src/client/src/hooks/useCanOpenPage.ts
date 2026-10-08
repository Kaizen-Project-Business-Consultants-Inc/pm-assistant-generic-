import { useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { canOpenPath } from '../constants/roleRoutes';

/**
 * `canOpen(path)` for the signed-in person — the same rule as the sidebar and the router
 * (constants/roleRoutes.ts). Used to hide links and buttons to pages their role can't open.
 */
export function useCanOpenPage(): (path: string) => boolean {
  const user = useAuthStore((s) => s.user);
  return useCallback((path: string) => canOpenPath(user, path), [user]);
}
