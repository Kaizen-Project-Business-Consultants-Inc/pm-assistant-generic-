import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../../database/connection';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { scheduleService } from '../../services/ScheduleService';
import logger from '../../utils/logger';

const MAX_BULK = 100;

// Field names deliberately match the single-task route (schedules.ts createTaskSchema)
// rather than inventing bulk-only names — `duration`/`progress`/`dependencies`/`notes`/
// `wbs` used to appear here but named columns (`duration`, `progress`, `dependencies`,
// `notes`, `wbs`) that never existed on `tasks` (real columns: `estimated_days`,
// `progress_percentage`, `dependency`+`dependency_type`, `comments`). Every bulk create
// silently failed row-by-row, and the live web UI's per-field bulk-edit menu only ever
// sends status/priority/assignedTo in practice, so this was never caught. `wbs` has no
// real column at all (only `source_wbs`, a distinct import-provenance field) and is
// dropped rather than written to the wrong place.
export const bulkTaskSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  estimatedDays: z.number().min(0).optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assignedTo: z.string().optional(),
  // An existing task's ID, OR a reference into this same batch — since a batch
  // task's real ID doesn't exist until it's inserted, a caller can't know it in
  // advance. Resolved in the route: an exact match against another task's `name`
  // in this request wins first; otherwise a small integer string is read as a
  // 0-based position in `tasks`. Anything else is treated as a literal task ID,
  // unchanged from before.
  dependency: z.string().optional(),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
  comments: z.string().optional(),
  isMilestone: z.boolean().optional(),
  // Same batch-reference rules as `dependency` above (name, position, or a
  // literal external task ID) — the parent phase/summary task is usually
  // created in the same batch as its children, so its real ID doesn't exist
  // yet either. A task only becomes a visible "summary task" once a child
  // actually resolves to it — see the rollup recompute after pass 2 below.
  parentTaskId: z.string().optional(),
});

/**
 * Resolve a bulk-create task's `dependency`/`parentTaskId` against this same
 * batch before it's treated as a literal task ID. Two forms, checked in order:
 *   - exact match on another task's `name` in this batch
 *   - a small non-negative integer string, read as a 0-based index into `tasks`
 * Self-references and out-of-range indices fall through to "not a batch
 * reference" and are left as a literal ID for the caller's own use (an existing
 * task outside this batch).
 */
export function batchDependencyIndex(ref: string, selfIndex: number, tasks: Array<{ name: string }>): number | undefined {
  const byName = tasks.findIndex((t, i) => i !== selfIndex && t.name === ref);
  if (byName !== -1) return byName;

  if (/^\d+$/.test(ref)) {
    const idx = Number(ref);
    if (idx !== selfIndex && idx >= 0 && idx < tasks.length) return idx;
  }
  return undefined;
}

export const bulkCreateSchema = z.object({
  scheduleId: z.string().min(1),
  tasks: z.array(bulkTaskSchema).min(1).max(MAX_BULK),
});

export const bulkUpdateItemSchema = z.object({
  id: z.string().min(1),
  scheduleId: z.string().min(1),
  name: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  estimatedDays: z.number().optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assignedTo: z.string().optional(),
  dependency: z.string().optional(),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
  comments: z.string().optional(),
  isMilestone: z.boolean().optional(),
  sortOrder: z.number().optional(),
  parentTaskId: z.string().nullable().optional(),
});

export const bulkUpdateSchema = z.object({
  updates: z.array(bulkUpdateItemSchema).min(1).max(MAX_BULK),
});

const bulkStatusSchema = z.object({
  scheduleId: z.string().min(1),
  taskIds: z.array(z.string().min(1)).min(1).max(MAX_BULK),
  status: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function bulkRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // -----------------------------------------------------------------------
  // POST /tasks — Bulk create tasks
  // -----------------------------------------------------------------------
  fastify.post('/tasks', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = bulkCreateSchema.parse(request.body);

      const succeeded: Array<{ id: string; name: string }> = [];
      const failed: Array<{ index: number; name: string; error: string }> = [];
      // Filled as each row is inserted (index-aligned with body.tasks) so a later
      // task's `dependency`/`parentTaskId` can resolve against an earlier one's
      // real ID — and an earlier task's can resolve against a later one's, via
      // the two-pass resolve below.
      const createdIds: (string | undefined)[] = new Array(body.tasks.length);
      // Parents that gained a child this call — is_summary only flips to true
      // via a rollup recompute, not by writing the column directly, so every
      // parent that got a new child needs one (deduped, outside the transaction).
      const parentsToRecompute = new Set<string>();

      await databaseService.transaction(async (connection) => {
        // Pass 1: insert every task. Batch-local refs (name/position) can't be
        // written yet — the tasks they point to may not have an id yet either,
        // if the reference points forward in the array.
        for (let i = 0; i < body.tasks.length; i++) {
          const t = body.tasks[i];
          try {
            const id = uuidv4();
            const depIsBatchRef = !!t.dependency && batchDependencyIndex(t.dependency, i, body.tasks) !== undefined;
            const parentIsBatchRef = !!t.parentTaskId && batchDependencyIndex(t.parentTaskId, i, body.tasks) !== undefined;
            await databaseService.queryOn(connection, 
              `INSERT INTO tasks
                 (id, schedule_id, name, start_date, end_date, estimated_days, progress_percentage,
                  status, priority, assigned_to, dependency, dependency_type, comments, is_milestone,
                  parent_task_id, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [
                id,
                body.scheduleId,
                t.name,
                t.startDate || null,
                t.endDate || null,
                t.estimatedDays ?? null,
                t.progressPercentage ?? 0,
                t.status || 'pending',
                t.priority || 'medium',
                t.assignedTo || null,
                // A batch-local reference is resolved in pass 2, once every id
                // exists; a literal external ID is fine to write now.
                depIsBatchRef ? null : (t.dependency || null),
                t.dependencyType || null,
                t.comments || null,
                t.isMilestone ? 1 : 0,
                parentIsBatchRef ? null : (t.parentTaskId || null),
                user.userId,
              ],
            );
            createdIds[i] = id;
            succeeded.push({ id, name: t.name });
            if (!parentIsBatchRef && t.parentTaskId) parentsToRecompute.add(t.parentTaskId);
          } catch (err: any) {
            failed.push({ index: i, name: t.name || '', error: err.message || 'Unknown error' });
          }
        }

        // Pass 2: now that every task in the batch has a real id, resolve each
        // dependency/parentTaskId that referred to another task in this same
        // batch by name or position, and write the actual foreign key.
        for (let i = 0; i < body.tasks.length; i++) {
          const t = body.tasks[i];
          const selfId = createdIds[i];
          if (!selfId) continue;

          if (t.dependency) {
            const depIndex = batchDependencyIndex(t.dependency, i, body.tasks);
            const resolvedId = depIndex !== undefined ? createdIds[depIndex] : undefined;
            if (resolvedId) {
              await databaseService.queryOn(connection, `UPDATE tasks SET dependency = ? WHERE id = ?`, [resolvedId, selfId]);
            }
          }

          if (t.parentTaskId) {
            const parentIndex = batchDependencyIndex(t.parentTaskId, i, body.tasks);
            const resolvedParentId = parentIndex !== undefined ? createdIds[parentIndex] : undefined;
            if (resolvedParentId) {
              await databaseService.queryOn(connection, `UPDATE tasks SET parent_task_id = ? WHERE id = ?`, [resolvedParentId, selfId]);
              parentsToRecompute.add(resolvedParentId);
            }
          }
        }
      });

      // A parent only renders as a summary task once its rollup is recomputed —
      // writing parent_task_id on the child alone doesn't flip is_summary.
      for (const parentId of parentsToRecompute) {
        scheduleService.recomputeParentRollup(parentId).catch(err =>
          logger.error('[Rollup] recomputeParentRollup error on bulk create:', err));
      }

      return { succeeded, failed };
    } catch (error) {
      // A malformed request (wrong field names, missing scheduleId) is the
      // caller's mistake, not a server fault — say what was actually wrong
      // instead of a bare 500 that gives no clue which field was the problem.
      if (error instanceof z.ZodError) {
        const first = error.issues[0];
        return reply.status(400).send({
          error: 'Invalid bulk task data',
          message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request body',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        });
      }
      logger.error('Bulk create tasks error', { error });
      return reply.status(500).send({ error: 'Failed to bulk create tasks' });
    }
  });

  // -----------------------------------------------------------------------
  // PUT /tasks — Bulk update tasks
  // -----------------------------------------------------------------------
  fastify.put('/tasks', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = bulkUpdateSchema.parse(request.body);

      const succeeded: Array<{ id: string }> = [];
      const failed: Array<{ id: string; error: string }> = [];

      await databaseService.transaction(async (connection) => {
        for (const u of body.updates) {
          try {
            if (!u.id || !u.scheduleId) {
              failed.push({ id: u.id || 'unknown', error: 'id and scheduleId are required' });
              continue;
            }

            const sets: string[] = [];
            const params: any[] = [];

            if (u.name !== undefined) { sets.push('name = ?'); params.push(u.name); }
            if (u.startDate !== undefined) { sets.push('start_date = ?'); params.push(u.startDate); }
            if (u.endDate !== undefined) { sets.push('end_date = ?'); params.push(u.endDate); }
            if (u.estimatedDays !== undefined) { sets.push('estimated_days = ?'); params.push(u.estimatedDays); }
            if (u.progressPercentage !== undefined) { sets.push('progress_percentage = ?'); params.push(u.progressPercentage); }
            if (u.status !== undefined) { sets.push('status = ?'); params.push(u.status); }
            if (u.priority !== undefined) { sets.push('priority = ?'); params.push(u.priority); }
            if (u.assignedTo !== undefined) { sets.push('assigned_to = ?'); params.push(u.assignedTo); }
            if (u.dependency !== undefined) { sets.push('dependency = ?'); params.push(u.dependency); }
            if (u.dependencyType !== undefined) { sets.push('dependency_type = ?'); params.push(u.dependencyType); }
            if (u.comments !== undefined) { sets.push('comments = ?'); params.push(u.comments); }
            if (u.isMilestone !== undefined) { sets.push('is_milestone = ?'); params.push(u.isMilestone ? 1 : 0); }
            if (u.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(u.sortOrder); }
            if (u.parentTaskId !== undefined) { sets.push('parent_task_id = ?'); params.push(u.parentTaskId); }

            if (sets.length === 0) {
              failed.push({ id: u.id, error: 'No fields to update' });
              continue;
            }

            sets.push('updated_at = NOW()');
            params.push(u.id, u.scheduleId);

            await databaseService.queryOn(connection, 
              `UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND schedule_id = ?`,
              params,
            );
            succeeded.push({ id: u.id });
          } catch (err: any) {
            failed.push({ id: u.id || 'unknown', error: err.message || 'Unknown error' });
          }
        }
      });

      return { succeeded, failed };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const first = error.issues[0];
        return reply.status(400).send({
          error: 'Invalid bulk update data',
          message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request body',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        });
      }
      logger.error('Bulk update tasks error', { error });
      return reply.status(500).send({ error: 'Failed to bulk update tasks' });
    }
  });

  // -----------------------------------------------------------------------
  // PUT /tasks/status — Batch status update
  // -----------------------------------------------------------------------
  fastify.put('/tasks/status', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = bulkStatusSchema.parse(request.body);

      const placeholders = body.taskIds.map(() => '?').join(',');
      // databaseService.query returns the raw ResultSetHeader for non-SELECT
      // statements (the mysql2 driver returns it as `rows` from execute).
      const result = await databaseService.query<any>(
        `UPDATE tasks
         SET status = ?, updated_at = NOW()
         WHERE id IN (${placeholders}) AND schedule_id = ?`,
        [body.status, ...body.taskIds, body.scheduleId],
      );

      // For UPDATE queries, mysql2's execute returns ResultSetHeader as rows.
      // databaseService.query casts it as T[], but it is really the header.
      const header = result as any;
      const updated = header?.affectedRows ?? body.taskIds.length;

      return { updated };
    } catch (error) {
      logger.error('Batch status update error', { error });
      return reply.status(500).send({ error: 'Failed to batch update task status' });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /tasks — Bulk delete tasks
  // -----------------------------------------------------------------------
  fastify.delete('/tasks', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = z.object({
        scheduleId: z.string().min(1),
        taskIds: z.array(z.string().min(1)).min(1).max(MAX_BULK),
      }).parse(request.body);

      // Gather parent IDs before deletion for rollup recomputation
      const placeholders = body.taskIds.map(() => '?').join(',');
      const existing = await databaseService.query<any>(
        `SELECT id, parent_task_id FROM tasks WHERE id IN (${placeholders}) AND schedule_id = ?`,
        [...body.taskIds, body.scheduleId],
      );
      const parentIds = new Set<string>();
      for (const row of existing) {
        if (row.parent_task_id && !body.taskIds.includes(row.parent_task_id)) {
          parentIds.add(row.parent_task_id);
        }
      }

      await databaseService.transaction(async (connection) => {
        const q = (sql: string, params: any[] = []) => databaseService.queryOn(connection, sql, params);

        // Clear dependency refs pointing to deleted tasks
        await q(
          `UPDATE tasks SET dependency = NULL, dependency_type = NULL, dependency_lag_days = 0 WHERE dependency IN (${placeholders}) AND schedule_id = ?`,
          [...body.taskIds, body.scheduleId],
        );

        // Delete the tasks
        await q(
          `DELETE FROM tasks WHERE id IN (${placeholders}) AND schedule_id = ?`,
          [...body.taskIds, body.scheduleId],
        );
      });

      // Recompute parent rollups (fire-and-forget)
      for (const pid of parentIds) {
        scheduleService.recomputeParentRollup(pid).catch(err =>
          logger.error('[Rollup] recomputeParentRollup error on bulk delete:', err));
      }

      return { deleted: existing.length };
    } catch (error) {
      logger.error('Bulk delete tasks error', { error });
      return reply.status(500).send({ error: 'Failed to bulk delete tasks' });
    }
  });
}
