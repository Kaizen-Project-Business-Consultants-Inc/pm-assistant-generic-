import logger from '../../utils/logger';
import { getRequestContext } from '../../middleware/requestContext';

/**
 * Re-run RAID Review shortly after a project's RAID log changes, so the Review panel
 * never shows a stale score. Same approach as scheduleReview/autoRerun:
 * debounced per project (a burst of edits or an import gives one review QUIET_MS after
 * the last change), rule-based (no AI), and the timer carries the request's
 * AsyncLocalStorage context so the review runs against the right tenant database.
 * Fire-and-forget: a failure is logged, never surfaced to the edit that caused it.
 */
export const QUIET_MS = 20_000;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function queueRaidReviewRerun(projectId: string | null | undefined): void {
  if (!projectId) return;
  const existing = pending.get(projectId);
  if (existing) clearTimeout(existing);
  const userId = getRequestContext()?.userId ?? null;
  const timer = setTimeout(() => {
    pending.delete(projectId);
    void runNow(projectId, userId);
  }, QUIET_MS);
  // Never keep the process alive just for a pending review
  (timer as { unref?: () => void }).unref?.();
  pending.set(projectId, timer);
}

// Loaded lazily: RaidReviewService depends on RiskService, which calls us
let deps: Promise<[typeof import('../RaidReviewService'), typeof import('../WebSocketService')]> | null = null;
const loadDeps = () => (deps ??= Promise.all([import('../RaidReviewService'), import('../WebSocketService')]));

async function runNow(projectId: string, userId: string | null): Promise<void> {
  try {
    const [{ raidReviewService }, { WebSocketService }] = await loadDeps();
    await raidReviewService.run(projectId, userId);
    WebSocketService.broadcast({ type: 'raid_review_updated', payload: { projectId } }, projectId);
  } catch (err: any) {
    logger.warn('[RaidReview] auto re-run failed', { projectId, error: err?.message });
  }
}

/** Test hook: drop pending timers */
export function _resetRaidAutoRerunForTests(): void {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}
