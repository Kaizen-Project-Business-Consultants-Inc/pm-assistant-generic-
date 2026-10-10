import { AsyncResource } from 'async_hooks';
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
 *
 * At most MAX_RUNNING reviews run at once (2026-10-03). A rate card or company-holiday change
 * queues every plan in the company; they all came due at the same moment and used up the
 * database connections ("Queue limit reached" — staging, 147 times), which could also fail
 * ordinary page loads. The rest wait their turn, each still in its own request context.
 */
export const QUIET_MS = 20_000;
export const MAX_RUNNING = 2;

let running = 0;
const waiting: Array<() => void> = [];

/** Run now if there is room, else wait. The wait keeps the caller's context (the right company). */
export function whenThereIsRoom(job: () => Promise<void>): void {
  const start = AsyncResource.bind(() => {
    running++;
    job().finally(() => {
      running--;
      waiting.shift()?.();
    });
  });
  if (running < MAX_RUNNING) start(); else waiting.push(start);
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function queueReviewRerun(scheduleId: string | null | undefined): void {
  if (!scheduleId) return;
  // Keyed per company: ids repeat across companies (every sample project is the same id), and one
  // company's edit must not cancel another's pending review (2026-10-09 audit).
  const key = `${getRequestContext()?.tenantDbName ?? ''}:${scheduleId}`;
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  const userId = getRequestContext()?.userId ?? null;
  const timer = setTimeout(() => {
    pending.delete(key);
    whenThereIsRoom(() => runNow(scheduleId, userId));
  }, QUIET_MS);
  // Never keep the process alive just for a pending review
  (timer as { unref?: () => void }).unref?.();
  pending.set(key, timer);
}

// Loaded lazily, once: ScheduleReviewService depends on ScheduleService, which calls us
let deps: Promise<[
  typeof import('../ScheduleReviewService'),
  typeof import('../ScheduleService'),
  typeof import('../WebSocketService'),
  typeof import('../TaskBudgetService'),
]> | null = null;
const loadDeps = () => (deps ??= Promise.all([
  import('../ScheduleReviewService'),
  import('../ScheduleService'),
  import('../WebSocketService'),
  import('../TaskBudgetService'),
]));

async function runNow(scheduleId: string, userId: string | null): Promise<void> {
  try {
    const [{ scheduleReviewService }, { scheduleService }, { WebSocketService }, { taskBudgetService }] = await loadDeps();
    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) return; // deleted in the meantime
    // Task budgets follow the plan: planned hours × rate (2026-10-02)
    await taskBudgetService.recalcSchedule(scheduleId).catch((err: any) =>
      logger.warn('[TaskBudget] recalc after change failed', { scheduleId, error: err?.message }));
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
  waiting.length = 0;
  running = 0;
}
