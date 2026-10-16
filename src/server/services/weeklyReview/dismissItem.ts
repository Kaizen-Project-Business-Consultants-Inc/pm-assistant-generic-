import { randomUUID } from 'crypto';
import { weeklyReviewRepository, type WeeklyResponseRow } from '../../database/WeeklyReviewRepository';

/** Not in this review / not this project's review — a 404 for the caller */
export class WeeklyReviewNotFoundError extends Error {}

export const DISMISS_REASONS = ['not_a_problem', 'already_handled', 'facts_wrong'] as const;
export type DismissReason = typeof DISMISS_REASONS[number];

/**
 * The PM says an item isn't useful — it stays quiet in later weeks unless it gets worse. Used by the
 * review's Dismiss and by Reject in the AI inbox (Phase 2), so both teach the review the same way.
 */
export async function dismissReviewItem(projectId: string, reviewId: string, itemKey: string, reason: DismissReason, userId: string): Promise<WeeklyResponseRow[]> {
  const review = await weeklyReviewRepository.findById(reviewId);
  if (!review || review.projectId !== projectId) throw new WeeklyReviewNotFoundError('Review not found');
  const item = review.items.find(i => i.key === itemKey);
  if (!item) throw new WeeklyReviewNotFoundError('That item is not in this review');
  await weeklyReviewRepository.saveResponse({
    id: randomUUID(), projectId, reviewId, itemKey, response: 'dismissed', reason, measure: item.measure, createdBy: userId,
  });
  return weeklyReviewRepository.responsesFor(reviewId);
}
