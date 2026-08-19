import * as cron from 'node-cron';
import { config } from '../../config';
import { scheduleService } from '../ScheduleService';
import { dagWorkflowService } from '../DagWorkflowService';
import { databaseService } from '../../database/connection';
import { runWithTenantContext } from '../../middleware/requestContext';
import logger from '../../utils/logger';

export interface TenantInfo {
  slug: string;
  orgId: string;
}

export interface CronTasks {
  task: cron.ScheduledTask | null;
  overdueTask: cron.ScheduledTask | null;
  recurrenceTask: cron.ScheduledTask | null;
  digestTask: cron.ScheduledTask | null;
  reportScheduleTask: cron.ScheduledTask | null;
  healthSnapshotTask: cron.ScheduledTask | null;
  trialReminderTask: cron.ScheduledTask | null;
  deadlineTask: cron.ScheduledTask | null;
}

export function startCronTasks(
  runScan: (tenant: TenantInfo | null) => Promise<void>,
  runOverdueScan: (tenant: TenantInfo | null) => Promise<void>,
): CronTasks {
  const tasks: CronTasks = {
    task: null,
    overdueTask: null,
    recurrenceTask: null,
    digestTask: null,
    reportScheduleTask: null,
    healthSnapshotTask: null,
    trialReminderTask: null,
    deadlineTask: null,
  };

  // Agent-specific jobs: gated by AGENT_ENABLED
  if (config.AGENT_ENABLED) {
    const schedule = config.AGENT_CRON_SCHEDULE;
    logger.info(`[cron] Starting agent scan on cron: "${schedule}"`);

    tasks.task = cron.schedule(schedule, async () => {
      await forEachTenant(async (tenant) => {
        const label = tenant?.slug ?? 'default';
        const start = Date.now();
        try {
          await runScan(tenant);
          logger.info(`[cron:agent-scan] ${label} completed`, {
            cronJob: 'agent-scan', tenant: label, durationMs: Date.now() - start,
          });
        } catch (error) {
          logger.error(`[cron:agent-scan] ${label} FAILED`, {
            cronJob: 'agent-scan', tenant: label, durationMs: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    });

    const overdueMinutes = config.AGENT_OVERDUE_SCAN_MINUTES;
    const overdueCron = `*/${overdueMinutes} * * * *`;
    logger.info(`[cron] Starting overdue scanner on cron: "${overdueCron}"`);

    tasks.overdueTask = cron.schedule(overdueCron, async () => {
      await forEachTenant(async (tenant) => {
        const label = tenant?.slug ?? 'default';
        const start = Date.now();
        try {
          await runOverdueScan(tenant);
          logger.info(`[cron:overdue-scan] ${label} completed`, {
            cronJob: 'overdue-scan', tenant: label, durationMs: Date.now() - start,
          });
        } catch (error) {
          logger.error(`[cron:overdue-scan] ${label} FAILED`, {
            cronJob: 'overdue-scan', tenant: label, durationMs: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    });
  } else {
    logger.info('[cron] Agent jobs disabled (AGENT_ENABLED=false)');
  }

  // Infrastructure jobs: always run regardless of AGENT_ENABLED

  // Recurring task generator — daily at 02:00
  logger.info('[cron] Starting recurring task generator (daily at 02:00)');
  tasks.recurrenceTask = cron.schedule('0 2 * * *', async () => {
    await forEachTenant(async (tenant) => {
      const label = tenant?.slug ?? 'default';
      const start = Date.now();
      try {
        const { recurrenceService } = await import('../RecurrenceService');
        const count = await recurrenceService.generateInstances(14);
        logger.info(`[cron:recurrence] ${label} completed`, {
          cronJob: 'recurrence', tenant: label, durationMs: Date.now() - start,
          result: { generated: count },
        });
      } catch (error) {
        logger.error(`[cron:recurrence] ${label} FAILED`, {
          cronJob: 'recurrence', tenant: label, durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  // Email digest — daily at 07:00
  logger.info('[cron] Starting digest email sender (daily at 07:00)');
  tasks.digestTask = cron.schedule('0 7 * * *', async () => {
    await forEachTenant(async (tenant) => {
      const label = tenant?.slug ?? 'default';
      const start = Date.now();
      try {
        const { digestService } = await import('../DigestService');
        await digestService.sendPendingDigests();
        logger.info(`[cron:digest] ${label} completed`, {
          cronJob: 'digest', tenant: label, durationMs: Date.now() - start,
        });
      } catch (error) {
        logger.error(`[cron:digest] ${label} FAILED`, {
          cronJob: 'digest', tenant: label, durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  // Scheduled report delivery — every 15 minutes
  logger.info('[cron] Starting report schedule executor (every 15 min)');
  tasks.reportScheduleTask = cron.schedule('*/15 * * * *', async () => {
    await forEachTenant(async (tenant) => {
      const label = tenant?.slug ?? 'default';
      const start = Date.now();
      try {
        const { reportScheduleService } = await import('../ReportScheduleService');
        await reportScheduleService.executeDueSchedules();
        logger.info(`[cron:reports] ${label} completed`, {
          cronJob: 'reports', tenant: label, durationMs: Date.now() - start,
        });
      } catch (error) {
        logger.error(`[cron:reports] ${label} FAILED`, {
          cronJob: 'reports', tenant: label, durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  // Health snapshot — daily at 03:00
  logger.info('[cron] Starting health snapshot recorder (daily at 03:00)');
  tasks.healthSnapshotTask = cron.schedule('0 3 * * *', async () => {
    await forEachTenant(async (tenant) => {
      const label = tenant?.slug ?? 'default';
      const start = Date.now();
      try {
        const { runHealthSnapshot } = await import('./healthSnapshotJob');
        await runHealthSnapshot();
        logger.info(`[cron:health-snapshot] ${label} completed`, {
          cronJob: 'health-snapshot', tenant: label, durationMs: Date.now() - start,
        });
      } catch (error) {
        logger.error(`[cron:health-snapshot] ${label} FAILED`, {
          cronJob: 'health-snapshot', tenant: label, durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  // Trial reminder emails — daily at 09:00
  logger.info('[cron] Starting trial reminder sender (daily at 09:00)');
  tasks.trialReminderTask = cron.schedule('0 9 * * *', async () => {
    const start = Date.now();
    try {
      const { runTrialReminders } = await import('./trialReminderJob');
      await runTrialReminders();
      logger.info('[cron:trial-reminder] completed', {
        cronJob: 'trial-reminder', durationMs: Date.now() - start,
      });
    } catch (error) {
      logger.error('[cron:trial-reminder] FAILED', {
        cronJob: 'trial-reminder', durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Deadline approaching notifications — daily at 08:00
  logger.info('[cron] Starting deadline notification sender (daily at 08:00)');
  tasks.deadlineTask = cron.schedule('0 8 * * *', async () => {
    await forEachTenant(async (tenant) => {
      const label = tenant?.slug ?? 'default';
      const start = Date.now();
      try {
        const { runDeadlineNotifications } = await import('./deadlineNotificationJob');
        const count = await runDeadlineNotifications();
        logger.info(`[cron:deadline-check] ${label} completed`, {
          cronJob: 'deadline-check', tenant: label, durationMs: Date.now() - start,
          result: { notified: count },
        });
      } catch (error) {
        logger.error(`[cron:deadline-check] ${label} FAILED`, {
          cronJob: 'deadline-check', tenant: label, durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  return tasks;
}

export function stopCronTasks(tasks: CronTasks): void {
  if (tasks.task) { tasks.task.stop(); tasks.task = null; }
  if (tasks.overdueTask) { tasks.overdueTask.stop(); tasks.overdueTask = null; }
  if (tasks.recurrenceTask) { tasks.recurrenceTask.stop(); tasks.recurrenceTask = null; }
  if (tasks.digestTask) { tasks.digestTask.stop(); tasks.digestTask = null; }
  if (tasks.reportScheduleTask) { tasks.reportScheduleTask.stop(); tasks.reportScheduleTask = null; }
  if (tasks.healthSnapshotTask) { tasks.healthSnapshotTask.stop(); tasks.healthSnapshotTask = null; }
  if (tasks.trialReminderTask) { tasks.trialReminderTask.stop(); tasks.trialReminderTask = null; }
  if (tasks.deadlineTask) { tasks.deadlineTask.stop(); tasks.deadlineTask = null; }
  logger.info('[Agent] Stopped agent scheduler');
}

/**
 * Run a callback for each active tenant (when multi-tenant is enabled)
 * or once without tenant context (single-tenant mode).
 * Bounded concurrency: processes 3 tenants at a time.
 *
 * @param callback Receives tenant info ({ slug, orgId }) or null in single-tenant mode.
 */
export async function forEachTenant(callback: (tenant: TenantInfo | null) => Promise<void>): Promise<void> {
  if (!config.MULTI_TENANT_ENABLED) {
    await callback(null);
    return;
  }

  const { organizationService } = await import('../OrganizationService');
  const orgs = await organizationService.getAllActiveProvisioned();

  // Process tenants with bounded concurrency (3 at a time)
  const concurrency = 3;
  for (let i = 0; i < orgs.length; i += concurrency) {
    const batch = orgs.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map(org =>
        runWithTenantContext(org.dbName, org.id, () =>
          callback({ slug: org.slug, orgId: org.id })
        ).catch(err => {
          logger.error(`[cron] Tenant job failed for ${org.slug}`, { error: err });
        })
      )
    );
  }
}

export async function runOverdueScanImpl(
  flaggedOverdue: Map<string, Set<string>>,
  tenantKey: string = 'default',
): Promise<number> {
  let rows: any[];
  try {
    rows = await databaseService.query(
      `SELECT id, schedule_id, name, status, priority, assigned_to, start_date, end_date,
              estimated_days, actual_days, description, parent_task_id, created_by,
              dependency_id, dependency_type, sort_order, is_recurrence_template, recurrence_rule, recurrence_parent_id
       FROM tasks WHERE end_date < CURDATE() AND status NOT IN ('completed', 'cancelled')
       LIMIT 1000`,
    );
  } catch {
    // Tables may not exist yet
    return 0;
  }

  if (!flaggedOverdue.has(tenantKey)) {
    flaggedOverdue.set(tenantKey, new Set<string>());
  }
  const tenantSet = flaggedOverdue.get(tenantKey)!;

  let triggered = 0;
  for (const row of rows) {
    const taskId = row.id;
    if (tenantSet.has(taskId)) continue;

    tenantSet.add(taskId);
    // Map row data directly — no need to re-fetch from DB
    const task: import('../ScheduleService').Task = {
      id: row.id,
      scheduleId: row.schedule_id,
      name: row.name,
      status: row.status,
      priority: row.priority || 'medium',
      taskType: row.task_type || 'task',
      assignedTo: row.assigned_to || undefined,
      startDate: row.start_date ? String(row.start_date) : undefined,
      endDate: row.end_date ? String(row.end_date) : undefined,
      estimatedDays: row.estimated_days ?? undefined,
      description: row.description || undefined,
      parentTaskId: row.parent_task_id || undefined,
      createdBy: row.created_by || '',
      isRecurrenceTemplate: !!row.is_recurrence_template,
      recurrenceRule: row.recurrence_rule || undefined,
      recurrenceParentId: row.recurrence_parent_id || undefined,
      sortOrder: row.sort_order ?? 0,
      createdAt: '',
      updatedAt: '',
      dependencies: [],
    };

    // Fire date_passed triggers via workflow engine
    dagWorkflowService.evaluateTaskChange(task, task, scheduleService).catch(err =>
      logger.error('[Agent] Overdue workflow trigger error', { taskId, error: err })
    );
    triggered++;
  }

  if (triggered > 0) {
    logger.info(`[Agent] Overdue scan: triggered workflows for ${triggered} newly-overdue task(s)`);
  }
  return triggered;
}
