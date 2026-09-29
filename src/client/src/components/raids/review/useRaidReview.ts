import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../../services/api';
import type { RaidReview } from './raidReviewHelpers';

export const raidReviewKey = (projectId: string) => ['raid-review', projectId] as const;

/** The latest RAID Review for a project (null when none has run yet). Shared by the tab and the panel. */
export function useRaidReview(projectId: string) {
  return useQuery<RaidReview | null>({
    queryKey: raidReviewKey(projectId),
    queryFn: async () => (await apiService.getRaidReview(projectId)).review ?? null,
    enabled: !!projectId,
  });
}
