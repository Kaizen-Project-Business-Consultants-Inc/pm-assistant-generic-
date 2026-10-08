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
