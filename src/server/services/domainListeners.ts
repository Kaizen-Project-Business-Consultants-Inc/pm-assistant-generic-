import { onDomainEvent } from './domainEvents';
import { queueReviewRerun } from './scheduleReview/autoRerun';
import { queueRaidReviewRerun } from './raidReview/autoRerun';
import { taskBudgetService } from './TaskBudgetService';
import logger from '../utils/logger';

/**
 * Connects each "something changed" notice (domainEvents.ts) to what reacts to it. Called once
 * by EVERY process that changes data: the app (index.ts) and the scheduled-jobs runner
 * (scripts/runCronJob.ts). A process that forgets this still works, but its changes quietly
 * stop re-running Schedule Review — the guard test domainListenersGuard.test.ts checks both.
 */
let registered = false;

export function registerDomainListeners(): void {
  if (registered) return;
  registered = true;
  // Plan changed → Schedule Review (and the task budgets it re-prices) re-run ~20 s later
  onDomainEvent('plan.changed', e => queueReviewRerun(e.scheduleId));
  // Rates changed → re-price the plans affected (each queues its own review re-run)
  onDomainEvent('person.rates.changed', e => {
    taskBudgetService.queueForResource(e.resourceId).catch(err =>
      logger.warn('[TaskBudget] re-price after a rate change failed', { resourceId: e.resourceId, error: err?.message }));
  });
  onDomainEvent('ratecard.changed', () => {
    taskBudgetService.queueAll().catch(err =>
      logger.warn('[TaskBudget] re-price after a rate card change failed', { error: err?.message }));
  });
  // RAID changed → RAID Review re-runs
  onDomainEvent('raid.changed', e => queueRaidReviewRerun(e.projectId));
}

/** Test hook */
export function _resetDomainListenersForTests(): void { registered = false; }
