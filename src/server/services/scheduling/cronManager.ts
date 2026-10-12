import { config } from '../../config';
import { scheduleService } from '../ScheduleService';
import { dagWorkflowService } from '../DagWorkflowService';
import { databaseService } from '../../database/connection';
import { runWithTenantContext } from '../../middleware/requestContext';
import logger from '../../utils/logger';
import { redisService } from '../RedisService';

export interface TenantInfo {
  slug: string;
  orgId: string;
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
    // eslint-disable-next-line no-await-in-loop -- already bounded: 3 companies run together per round, each with its own tenant database
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

/** One firing per task per overdue episode (a new due date starts a new one); after 30 days a task
 * still overdue on the same date fires once more — a reminder, not a repeat */
const OVERDUE_FIRED_TTL_S = 30 * 24 * 3600;

/**
 * Fire the "date passed" workflows for tasks that have gone overdue — ONCE per task and due date.
 * The job runs every 15 minutes in a fresh process, and its in-memory "already done" set was empty
 * every time, so every overdue task's workflows ran again every 15 minutes (2026-10-12 review). The
 * mark now lives in Redis (30 days); with Redis down nothing fires — never the same task repeatedly.
 * One task at a time (a burst of 1,000 overflowed the database pool), stopping at `deadline`; tasks
 * not reached are picked up next run.
 */
export async function runOverdueScanImpl(
  tenantKey: string = 'default',
  opts: { deadline?: number } = {},
): Promise<number> {
  const client = redisService.isConnected() ? redisService.getClient() : null;
  if (!client) {
    logger.warn('[Agent] Overdue scan skipped: Redis unavailable, so it cannot tell which tasks already fired');
    return 0;
  }
  let rows: any[];
  try {
    rows = await databaseService.query(
      `SELECT id, schedule_id, name, status, priority, assigned_to, start_date, end_date,
              estimated_days, actual_days, description, parent_task_id, created_by,
              dependency_id, dependency_type, sort_order, is_recurrence_template, recurrence_rule, recurrence_parent_id
       FROM tasks WHERE end_date < CURDATE() AND status NOT IN ('completed', 'cancelled')
       ORDER BY end_date DESC
       LIMIT 1000`,
    );
  } catch {
    // Tables may not exist yet
    return 0;
  }

  let triggered = 0;
  for (const row of rows) {
    if (opts.deadline && Date.now() > opts.deadline) {
      logger.info(`[Agent] Overdue scan: stopped at the time limit after ${triggered} task(s); the rest go next run`);
      break;
    }
    const taskId = row.id;
    const due = row.end_date ? String(row.end_date).slice(0, 10) : '';
    let first: string | null;
    try {
      // eslint-disable-next-line no-await-in-loop -- one task at a time: each runs its workflows against the shared pool
      first = await client.set(`overdue-fired:${tenantKey}:${taskId}:${due}`, '1', 'EX', OVERDUE_FIRED_TTL_S, 'NX');
    } catch {
      logger.warn('[Agent] Overdue scan stopped: Redis failed, so it cannot tell which tasks already fired');
      break;
    }
    if (first !== 'OK') continue; // already fired for this due date

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
    try {
      // eslint-disable-next-line no-await-in-loop -- see above
      await dagWorkflowService.evaluateTaskChange(task, task, scheduleService);
    } catch (err) {
      logger.error('[Agent] Overdue workflow trigger error', { taskId, error: err });
    }
    triggered++;
  }

  if (triggered > 0) {
    logger.info(`[Agent] Overdue scan: ran workflows for ${triggered} newly-overdue task(s)`);
  }
  return triggered;
}
