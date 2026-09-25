import logger from '../../utils/logger';
import { getRequestContext } from '../../middleware/requestContext';

/**
 * Re-run Schedule Review shortly after a schedule changes, so the Review panel and the
 * Schedule Health card never show a stale result (they used to keep the last import /
 * weekly / manual run until someone clicked Re-run).
 *
 * Debounced per schedule: a burst of edits (typing through a grid, a bulk link) gives one
 * review QUIET_MS after the last change, not one per edit. The review is rule-based — no
 * AI, no tokens. Timers carry the request's AsyncLocalStorage context, so the review runs
 * against the right tenant database. Fire-and-forget: a failure is logged, never surfaced
 * to the edit that caused it.
 */
export const QUIET_MS = 20_000;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function queueReviewRerun(scheduleId: string | null | undefined): void {
  if (!scheduleId) return;
  const existing = pending.get(scheduleId);
  if (existing) clearTimeout(existing);
  const userId = getRequestContext()?.userId ?? null;
  const timer = setTimeout(() => {
    pending.delete(scheduleId);
    void runNow(scheduleId, userId);
  }, QUIET_MS);
  // Never keep the process alive just for a pending review
  (timer as { unref?: () => void }).unref?.();
  pending.set(scheduleId, timer);
}

// Loaded lazily, once: ScheduleReviewService depends on ScheduleService, which calls us
let deps: Promise<[
  typeof import('../ScheduleReviewService'),
  typeof import('../ScheduleService'),
  typeof import('../WebSocketService'),
]> | null = null;
const loadDeps = () => (deps ??= Promise.all([
  import('../ScheduleReviewService'),
  import('../ScheduleService'),
  import('../WebSocketService'),
]));

async function runNow(scheduleId: string, userId: string | null): Promise<void> {
  try {
    const [{ scheduleReviewService }, { scheduleService }, { WebSocketService }] = await loadDeps();
    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) return; // deleted in the meantime
    await scheduleReviewService.run(scheduleId, 'auto', userId);
    WebSocketService.broadcast({ type: 'schedule_updated', payload: { scheduleId, reviewUpdated: true } }, schedule.projectId);
  } catch (err: any) {
    logger.warn('[ScheduleReview] auto re-run failed', { scheduleId, error: err?.message });
  }
}

/** Test hook: drop pending timers */
export function _resetAutoRerunForTests(): void {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}
