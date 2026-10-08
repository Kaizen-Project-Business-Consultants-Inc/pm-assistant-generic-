import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { canOpenPath } from '../../constants/roleRoutes';
import { ROUTES } from '../../routes';

/**
 * Wraps the router's routes: a signed-in person who types or follows the address of a page
 * their role can't open (constants/roleRoutes.ts) — or anything under it — lands on the
 * dashboard. `replace`, so Back doesn't bounce them into the same redirect again.
 */
export function RoleRouteGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const { pathname } = useLocation();
  // The saved login may be out of date until /auth/me answers (App shows its loader then anyway)
  if (!isLoading && !canOpenPath(user, pathname)) return <Navigate to={ROUTES.dashboard} replace />;
  return <>{children}</>;
}
