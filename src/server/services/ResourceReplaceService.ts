import { databaseService } from '../database/connection';
import { resourceRepository } from '../database/ResourceRepository';
import { changeHistoryService } from './ChangeHistoryService';
import { auditLedgerService } from './AuditLedgerService';
import { queueReviewRerun } from './scheduleReview/autoRerun';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import { ResourceValidationError } from './ResourceService';
import logger from '../utils/logger';

/**
 * "Replace Generic Developer with Parth" (2026-10-01): swap one resource for another on a
 * plan's tasks — the task's people (+ %), its "Assigned to", and any hours bookings — in one
 * step, recorded in Schedule History so it can be undone like any other change.
 */

export interface ReplaceUndo {
  fromId: string;
  toId: string;
  /** task_assignments rows moved from → to (undo moves them back) */
  movedPeople: string[];
  /** task_assignments rows removed because the new person was already on the task (undo re-adds them) */
  removedPeople: Array<{ id: string; task_id: string; allocation_pct: number; role_on_task: string | null; hours_planned: number | null }>;
  /** tasks whose "Assigned to" was the old resource */
  assignedTo: string[];
  /** hours bookings moved from → to */
  movedBookings: string[];
}

export interface TaskOfResource { taskId: string; name: string; startDate: string | null; endDate: string | null; status: string }

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

export class ResourceReplaceService {
  /** The tasks in this plan the resource is on, in plan order */
  async tasksOf(resourceId: string, scheduleId: string): Promise<TaskOfResource[]> {
    const rows = await databaseService.query<any>(
      `SELECT t.id, t.name, DATE_FORMAT(t.start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(t.end_date, '%Y-%m-%d') AS end_date, t.status
         FROM tasks t
        WHERE t.schedule_id = ?
          AND (t.assigned_to = ?
               OR EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = t.id AND ta.resource_id = ?)
               OR EXISTS (SELECT 1 FROM resource_assignments ra WHERE ra.task_id = t.id AND ra.resource_id = ?))
        ORDER BY t.sort_order, t.start_date`,
      [scheduleId, resourceId, resourceId, resourceId],
    );
    return rows.map((r: any) => ({ taskId: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date, status: r.status }));
  }

  async replace(input: { projectId: string; scheduleId: string; fromId: string; toId: string; taskIds?: string[] }): Promise<{ replaced: number; changeId: string | null }> {
    if (input.fromId === input.toId) throw new ResourceValidationError('Pick a different person to replace them with.');
    const [from, to] = await Promise.all([resourceRepository.findById(input.fromId), resourceRepository.findById(input.toId)]);
    if (!from || !to) throw new ResourceValidationError('That resource no longer exists. Refresh and try again.');
    if (to.isGeneric) throw new ResourceValidationError('Replace with a real person, not another generic role.');

    const onPlan = await this.tasksOf(from.id, input.scheduleId);
    const wanted = input.taskIds ? new Set(input.taskIds) : null;
    const taskIds = onPlan.map((t) => t.taskId).filter((id) => !wanted || wanted.has(id));
    if (taskIds.length === 0) return { replaced: 0, changeId: null };

    const undo: ReplaceUndo = { fromId: from.id, toId: to.id, movedPeople: [], removedPeople: [], assignedTo: [], movedBookings: [] };
    await databaseService.transaction(async (conn) => {
      const ph = placeholders(taskIds.length);
      const people = await databaseService.queryOn<any>(conn,
        `SELECT ta.*, EXISTS (SELECT 1 FROM task_assignments x WHERE x.task_id = ta.task_id AND x.resource_id = ?) AS already
           FROM task_assignments ta WHERE ta.resource_id = ? AND ta.task_id IN (${ph})`,
        [to.id, from.id, ...taskIds]);
      for (const p of people) {
        if (Number(p.already)) {
          // The new person is already on this task: one line for them is enough
          await databaseService.queryOn(conn, 'DELETE FROM task_assignments WHERE id = ?', [p.id]);
          undo.removedPeople.push({ id: p.id, task_id: p.task_id, allocation_pct: Number(p.allocation_pct), role_on_task: p.role_on_task ?? null, hours_planned: p.hours_planned != null ? Number(p.hours_planned) : null });
        } else {
          await databaseService.queryOn(conn, 'UPDATE task_assignments SET resource_id = ? WHERE id = ?', [to.id, p.id]);
          undo.movedPeople.push(p.id);
        }
      }
      const owned = await databaseService.queryOn<{ id: string }>(conn,
        `SELECT id FROM tasks WHERE assigned_to = ? AND id IN (${ph})`, [from.id, ...taskIds]);
      undo.assignedTo = owned.map((r) => r.id);
      if (undo.assignedTo.length) {
        await databaseService.queryOn(conn,
          `UPDATE tasks SET assigned_to = ? WHERE id IN (${placeholders(undo.assignedTo.length)})`, [to.id, ...undo.assignedTo]);
      }
      const bookings = await databaseService.queryOn<{ id: string }>(conn,
        `SELECT id FROM resource_assignments WHERE resource_id = ? AND schedule_id = ? AND task_id IN (${ph})`, [from.id, input.scheduleId, ...taskIds]);
      undo.movedBookings = bookings.map((r) => r.id);
      if (undo.movedBookings.length) {
        await databaseService.queryOn(conn,
          `UPDATE resource_assignments SET resource_id = ? WHERE id IN (${placeholders(undo.movedBookings.length)})`, [to.id, ...undo.movedBookings]);
      }
      // The plan changed: History's "nothing changed since" check and caches key off this
      await databaseService.queryOn(conn, `UPDATE tasks SET updated_at = NOW() WHERE id IN (${ph})`, taskIds);
    });

    const changeId = await changeHistoryService.record({
      projectId: input.projectId,
      scheduleId: input.scheduleId,
      kind: 'reassign',
      summary: `Replaced ${from.name} with ${to.name} on ${taskIds.length} task${taskIds.length === 1 ? '' : 's'}`,
      taskIds,
      undo,
    });
    queueReviewRerun(input.scheduleId);
    const ctx = getRequestContext();
    auditLedgerService.append({
      actorId: ctx?.userId ?? 'system',
      actorType: ctx?.userId ? 'user' : 'system',
      action: 'resource.replace',
      entityType: 'schedule',
      entityId: input.scheduleId,
      projectId: input.projectId,
      payload: { fromId: from.id, toId: to.id, taskIds },
      source: getActorSource(),
    }).catch((err) => logger.warn('[ResourceReplace] audit append failed', { error: err?.message }));
    return { replaced: taskIds.length, changeId };
  }

  /** History's Undo for a 'reassign' change: everything back to the old resource */
  async undo(scheduleId: string, u: ReplaceUndo): Promise<number> {
    const taskIds = new Set<string>();
    await databaseService.transaction(async (conn) => {
      if (u.movedPeople.length) {
        await databaseService.queryOn(conn,
          `UPDATE task_assignments SET resource_id = ? WHERE id IN (${placeholders(u.movedPeople.length)})`, [u.fromId, ...u.movedPeople]);
        const rows = await databaseService.queryOn<{ task_id: string }>(conn,
          `SELECT task_id FROM task_assignments WHERE id IN (${placeholders(u.movedPeople.length)})`, u.movedPeople);
        rows.forEach((r) => taskIds.add(r.task_id));
      }
      for (const p of u.removedPeople) {
        await databaseService.queryOn(conn,
          `INSERT IGNORE INTO task_assignments (id, task_id, resource_id, allocation_pct, role_on_task, hours_planned) VALUES (?, ?, ?, ?, ?, ?)`,
          [p.id, p.task_id, u.fromId, p.allocation_pct, p.role_on_task, p.hours_planned]);
        taskIds.add(p.task_id);
      }
      if (u.assignedTo.length) {
        await databaseService.queryOn(conn,
          `UPDATE tasks SET assigned_to = ? WHERE schedule_id = ? AND id IN (${placeholders(u.assignedTo.length)})`, [u.fromId, scheduleId, ...u.assignedTo]);
        u.assignedTo.forEach((id) => taskIds.add(id));
      }
      if (u.movedBookings.length) {
        await databaseService.queryOn(conn,
          `UPDATE resource_assignments SET resource_id = ? WHERE schedule_id = ? AND id IN (${placeholders(u.movedBookings.length)})`, [u.fromId, scheduleId, ...u.movedBookings]);
      }
      if (taskIds.size) {
        await databaseService.queryOn(conn, `UPDATE tasks SET updated_at = NOW() WHERE id IN (${placeholders(taskIds.size)})`, [...taskIds]);
      }
    });
    return taskIds.size || u.movedBookings.length;
  }
}

export const resourceReplaceService = new ResourceReplaceService();
