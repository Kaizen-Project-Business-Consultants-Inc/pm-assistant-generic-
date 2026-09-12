import { automationRepository } from '../../database/AutomationRepository';
import { automationEventBus } from './AutomationEventBus';
import { computeNextRun } from './computeNextRun';
import type { AutomationEvent } from './types';
import logger from '../../utils/logger';

/**
 * Query all due scheduled automations and execute them.
 * Called every minute by the cron manager.
 */
export async function runDueScheduledAutomations(): Promise<number> {
  let dueAutomations;
  try {
    dueAutomations = await automationRepository.findDueScheduled();
  } catch (err) {
    logger.error('[ScheduledRunner] Failed to query due automations:', err);
    return 0;
  }

  if (dueAutomations.length === 0) return 0;

  logger.info(`[ScheduledRunner] Found ${dueAutomations.length} due scheduled automation(s)`);

  let executed = 0;
  for (const automation of dueAutomations) {
    try {
      // Build a synthetic event for the scheduled trigger
      const event: AutomationEvent = {
        type: automation.triggerEventType,
        entityType: 'schedule',
        entityId: automation.id,
        projectId: automation.projectId,
        userId: automation.ownerUserId,
        payload: {
          automationId: automation.id,
          automationName: automation.name,
          scheduledAt: automation.nextRunAt,
          scheduleConfig: automation.scheduleConfig,
        },
        timestamp: new Date().toISOString(),
      };

      // Execute through the event bus pipeline (conditions, actions, cooldowns, logging)
      await automationEventBus.runScheduled(automation, event);
      executed++;
    } catch (err) {
      logger.error(`[ScheduledRunner] Failed to execute automation ${automation.id}:`, err);
    }

    // Compute and persist next run time (from "now", not from missed time)
    try {
      const nextRun = automation.scheduleConfig
        ? computeNextRun(automation.scheduleConfig, automation.timezone || 'UTC')
        : null;
      await automationRepository.updateScheduleAfterRun(automation.id, nextRun);
    } catch (err) {
      logger.error(`[ScheduledRunner] Failed to update next_run_at for automation ${automation.id}:`, err);
    }
  }

  if (executed > 0) {
    logger.info(`[ScheduledRunner] Executed ${executed}/${dueAutomations.length} scheduled automation(s)`);
  }

  return executed;
}
