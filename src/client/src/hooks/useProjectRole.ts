import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';

/**
 * The signed-in user's role on ONE project. Only the project's Manager or Owner (or an
 * admin/PMO) can change project data (Sep 2026) — screens used to decide from the
 * organisation role, so a PM who was only a viewer on a project still saw edit buttons.
 * The server enforces the rule; this only decides what to show.
 */
export function useProjectRole(projectId?: string | null) {
  const { data, isSuccess } = useQuery<{ role: string; canEdit: boolean; canManageOwners: boolean }>({
    queryKey: ['my-project-role', projectId],
    queryFn: () => apiService.getMyProjectRole(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  return {
    role: data?.role ?? null,
    canEdit: !!data?.canEdit,
    canManageOwners: !!data?.canManageOwners,
    loaded: isSuccess,
  };
}
