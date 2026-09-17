import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../../services/api';
import { ScheduleScoreChip, type ReviewBand } from './ScheduleScoreChip';

/**
 * Inner body for the "Schedule Health" project-overview card. Shows the latest
 * review score chip plus an 8-run bar sparkline, reusing the same query keys as
 * ScheduleReviewPanel so the cache is shared. Renders inner content only — the
 * Overview grid supplies the card frame and header.
 */
export function ScheduleHealthCard({ scheduleId, onOpen }: { scheduleId: string; onOpen?: () => void }) {
  const latest = useQuery({
    queryKey: ['schedule-review', scheduleId, 'latest'],
    queryFn: () => apiService.getScheduleReviewLatest(scheduleId),
  });
  const history = useQuery({
    queryKey: ['schedule-review', scheduleId, 'history'],
    queryFn: () => apiService.getScheduleReviewHistory(scheduleId, 8),
  });

  if (latest.isLoading) {
    return <div className="animate-pulse h-16 bg-gray-200 dark:bg-gray-700 rounded" />;
  }

  const review = latest.data as { score: number; band: ReviewBand } | null;
  if (!review) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No review yet. Open the schedule to run one.</p>;
  }

  const runs = (history.data?.runs ?? []) as Array<{ id: string; score: number }>;
  const trend = [...runs].reverse(); // oldest → newest

  return (
    <div className="flex items-center justify-between gap-3">
      <ScheduleScoreChip score={review.score} band={review.band} size="lg" onClick={onOpen} />
      {trend.length > 1 && (
        <div className="flex items-end gap-0.5 h-8" role="img" aria-label={`Last ${trend.length} scores: ${trend.map(r => r.score).join(', ')}`}>
          {trend.map((r, i) => (
            <span
              key={r.id}
              title={`${r.score}`}
              className={`w-2 rounded-sm ${i === trend.length - 1 ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              style={{ height: `${Math.max(8, Math.round((r.score / 100) * 32))}px` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
