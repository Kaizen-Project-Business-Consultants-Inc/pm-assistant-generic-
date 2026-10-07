import { onDomainEvent } from './domainEvents';
import { queueReviewRerun } from './scheduleReview/autoRerun';
import { queueRaidReviewRerun } from './raidReview/autoRerun';
import { taskBudgetService } from './TaskBudgetService';
import { registerUndoHandler } from './ChangeHistoryService';
import { scheduleFixProposerService } from './ScheduleFixProposerService';
import { resourceReplaceService } from './ResourceReplaceService';
import { teamPlannerService } from './TeamPlannerService';
import { dagWorkflowService } from './DagWorkflowService';
import { scheduleService } from './ScheduleService';
import { approvedTimeService } from './ApprovedTimeService';
import { registerApprovedProgress } from './approvedProgress';
import logger from '../utils/logger';

/**
 * Connects each "something changed" notice (domainEvents.ts) to what reacts to it, hands
 * Schedule History the undo for changes other features make (ChangeHistoryService), and hands
 * ScheduleService the approved-hours % for a reopened task (approvedProgress.ts). Called once
 * by EVERY process that changes data: the app (index.ts) and the scheduled-jobs runner
 * (scripts/runCronJob.ts). A process that forgets this still works, but its changes quietly
 * stop re-running Schedule Review — the guard in __tests__/services/domainEvents.test.ts checks both.
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

  // Workflows react to task, project and agent-proposal changes (step 1E) — fire-and-forget, as before
  onDomainEvent('task.changed', e => {
    dagWorkflowService.evaluateTaskChange(e.task, e.oldTask, scheduleService).catch(err =>
      logger.error('[Workflow] evaluateTaskChange error:', err));
  });
  onDomainEvent('project.changed', e => {
    dagWorkflowService.evaluateProjectChange(e.projectId, e.changeType, e.data).catch(err =>
      logger.error('[Workflow] evaluateProjectChange error:', err));
  });
  onDomainEvent('proposal.event', e => {
    dagWorkflowService.evaluateProposalEvent(e.eventType, e.data).catch(err =>
      logger.error('[Workflow] evaluateProposalEvent error:', err));
  });

  // Schedule History: the features that know how to put their own changes back (step 1D)
  registerUndoHandler('review_fix', async (scheduleId, _p, c) => { await scheduleFixProposerService.undo(scheduleId, c.ref ?? '', c.userId); return 0; });
  registerUndoHandler('reassign', (scheduleId, p) => resourceReplaceService.undo(scheduleId, p));
  registerUndoHandler('planner_move', (scheduleId, p) => teamPlannerService.undo(scheduleId, p));

  // A reopened task's % from its approved hours: ScheduleService asks, ApprovedTimeService answers (step 1F)
  registerApprovedProgress(taskId => approvedTimeService.progressFor(taskId));
}

/** Test hook */
export function _resetDomainListenersForTests(): void { registered = false; }
