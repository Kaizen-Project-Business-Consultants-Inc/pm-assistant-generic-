import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { weeklyReviewKey, type WeeklyReview, type DismissReason } from './weeklyReviewTypes';

/** The project's latest Weekly PM review (null = never run). PM-only: pass enabled=false otherwise. */
export function useWeeklyReview(projectId: string, enabled = true) {
  return useQuery({
    queryKey: weeklyReviewKey(projectId),
    queryFn: async () => (await apiService.getPmWeeklyReview(projectId)).review,
    enabled: !!projectId && enabled,
    staleTime: 60_000,
  });
}

export function useRunWeeklyReview(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiService.runPmWeeklyReview(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData(weeklyReviewKey(projectId), data.review);
      queryClient.invalidateQueries({ queryKey: ['pm-weekly-reviews-mine'] });
    },
  });
}

export function useDismissWeeklyItem(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { reviewId: string; itemKey: string; reason: DismissReason }) =>
      apiService.dismissPmWeeklyReviewItem(projectId, v.reviewId, v.itemKey, v.reason),
    onSuccess: (data) => {
      queryClient.setQueryData<WeeklyReview | null | undefined>(
        weeklyReviewKey(projectId),
        (old) => (old ? { ...old, responses: data.responses } : old),
      );
      queryClient.invalidateQueries({ queryKey: ['pm-weekly-reviews-mine'] });
    },
  });
}
