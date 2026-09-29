import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../../services/api';
import type { RaidReview } from './raidReviewHelpers';

export const raidReviewKey = (projectId: string) => ['raid-review', projectId] as const;

/**
 * The latest RAID Review for a project (null when none has run yet). Shared by the tab and the panel.
 * Only the project's Manager/Owner may see it (the server refuses anyone else), so callers pass
 * `allowed` and nothing is fetched for other roles.
 */
export function useRaidReview(projectId: string, allowed = true) {
  return useQuery<RaidReview | null>({
    queryKey: raidReviewKey(projectId),
    queryFn: async () => (await apiService.getRaidReview(projectId)).review ?? null,
    enabled: !!projectId && allowed,
  });
}
