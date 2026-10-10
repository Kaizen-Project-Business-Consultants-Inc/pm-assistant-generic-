import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { taskDatesOf, moveBookingsWithTasks } from '../../database/bookingDates';
import { scheduleRecomputeService } from '../../services/ScheduleRecomputeService';
import { requireProjectAccess, projectsOfSchedules } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../../database/connection';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { scheduleService } from '../../services/ScheduleService';
import logger from '../../utils/logger';
import { type IsWorking, weekdaysOnly, utcDay, ymdOf, finishFor } from '../../utils/workingDays';
import { planChanged } from '../../services/domainEvents';
import { groupBy } from '../../utils/groupBy';
import {
  changeHistoryService, BULK_UPDATE_COLUMNS, type PreviousValues, deleteTasksKeepingCopy, deleteSummary,
  ROLLUP_COLUMNS, parentIdsOf, rollUpSummaries, type LinksBefore,
} from '../../services/ChangeHistoryService';

import { TASK_STATUS_LABEL as STATUS_LABEL } from '../../constants/taskStatus';
import { taskRepository } from '../../database/TaskRepository';
import { isUnderItself, PARENT_LOOP_MESSAGE } from '../../utils/parentLoop';
import { findDependencyCycle } from '../../utils/dependencyCycle';
const FIELD_LABEL: Record<string, string> = {
  name: 'name', startDate: 'start', endDate: 'finish', estimatedDays: 'duration', progressPercentage: 'progress',
  status: 'status', priority: 'priority', assignedTo: 'owner', dependency: 'predecessor', dependencyType: 'link type',
  comments: 'notes', isMilestone: 'milestone', sortOrder: 'order', parentTaskId: 'phase',
};
function describeFields(keys: string[]): string {
  const labels = [...new Set(keys.map(k => FIELD_LABEL[k] ?? k))];
  return labels.length <= 3 ? labels.join(', ') : `${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more`;
}

/**
 * Only the project's Manager/Owner may change tasks (Sep 2026). The schedule(s) are in the
 * body, not the URL, so the check is told where to look; every schedule named must pass.
 */
const bodySchedule = requireProjectAccess('manager', {
  resolve: async (req) => projectsOfSchedules([(req.body as any)?.scheduleId]),
});
const bodyUpdateSchedules = requireProjectAccess('manager', {
  resolve: async (req) => {
    const updates = (req.body as any)?.updates;
    return Array.isArray(updates) ? projectsOfSchedules(updates.map((u: any) => u?.scheduleId)) : null;
  },
});

/** One History line per schedule touched (MCP bulk tools can span schedules) */
async function projectOfSchedule(scheduleId: string): Promise<string | null> {
  try {
    return (await scheduleService.findById(scheduleId))?.projectId ?? null;
  } catch {
    return null; // History is best-effort; never fail the bulk change over it
  }
}

const MAX_BULK = 100;
/** A deadlock or lock-wait timeout ends the whole transaction: never retry row by row after one */
const TRANSACTION_ENDED = new Set([1213, 1205]);

/**
 * Set one column on many tasks in ONE statement: `UPDATE tasks SET col = CASE id WHEN … END
 * WHERE id IN (…)`. `column` is a fixed name from this file, never user input (2026-10-08).
 */
async function setColumnByCase(run: (sql: string, params: any[]) => Promise<any>, column: 'dependency' | 'parent_task_id', pairs: Array<[string, string]>): Promise<void> {
  if (pairs.length === 0) return;
  await run(
    `UPDATE tasks SET ${column} = CASE id ${pairs.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (${pairs.map(() => '?').join(',')})`,
    [...pairs.flat(), ...pairs.map(([id]) => id)],
  );
}

const LINK_LOOP_MESSAGE = 'These predecessors would make a loop (a task would end up waiting for itself). Nothing was saved.';
type Run = (sql: string, params: any[]) => Promise<any>;
type BulkUpdate = { id: string; scheduleId: string; dependency?: string | null; dependencyType?: string; parentTaskId?: string | null };

/**
 * A bulk edit's parents and predecessors, checked against the whole plan BEFORE anything is saved
 * (audit 2026-10-09): a task can't go under one of its own sub-tasks, and the links can't make a
 * loop — counting every change in the batch together, since two harmless-looking edits can close
 * a loop between them. Returns the refusal, or null. A reference to the task itself or to another
 * plan is left to the per-task check (it fails that task only, as before).
 */
async function bulkStructureRefusal(updates: BulkUpdate[]): Promise<string | null> {
  const reparented = updates.filter(u => u.parentTaskId !== undefined && u.parentTaskId !== u.id);
  const relinked = updates.filter(u => u.dependency !== undefined);
  if (reparented.length === 0 && relinked.length === 0) return null;
  const plans = [...new Set([...reparented, ...relinked].map(u => u.scheduleId))];

  if (reparented.length > 0) {
    const parentOf = await taskRepository.parentLinks(plans);
    for (const u of reparented) {
      if (isUnderItself(u.id, u.parentTaskId, parentOf)) return PARENT_LOOP_MESSAGE;
      parentOf.set(u.id, u.parentTaskId ?? null); // later edits in the batch see this one
    }
  }

  if (relinked.length > 0) {
    const replaced = new Set(relinked.map(u => u.id));
    const existing = await databaseService.query<{ task_id: string; dependency_id: string }>(
      `SELECT td.task_id, td.dependency_id FROM task_dependencies td JOIN tasks t ON t.id = td.task_id
        WHERE t.schedule_id IN (${plans.map(() => '?').join(',')})`, plans);
    const edges = [
      ...existing.filter(e => !replaced.has(e.task_id)).map(e => ({ from: e.dependency_id, to: e.task_id })),
      ...relinked.filter(u => u.dependency && u.dependency !== u.id).map(u => ({ from: u.dependency!, to: u.id })),
    ];
    if (findDependencyCycle(edges)) return LINK_LOOP_MESSAGE;
  }
  return null;
}

/**
 * Bulk create: the tasks of one batch naming each other as parent or predecessor (by name or
 * position) can't make a loop either — new tasks have nothing under or after them otherwise.
 */
function batchLoopRefusal(tasks: Array<{ name: string; dependency?: string; parentTaskId?: string }>): string | null {
  const ref = (r: string | undefined, i: number) => {
    const at = r ? batchDependencyIndex(r, i, tasks) : undefined;
    return at === undefined ? null : `#${at}`;
  };
  const parentOf = new Map(tasks.map((t, i) => [`#${i}`, ref(t.parentTaskId, i)]));
  for (const [id, parent] of parentOf) if (isUnderItself(id, parent, parentOf)) return PARENT_LOOP_MESSAGE;
  const edges = tasks.flatMap((t, i) => {
    const from = ref(t.dependency, i);
    return from ? [{ from, to: `#${i}` }] : [];
  });
  return findDependencyCycle(edges) ? LINK_LOOP_MESSAGE : null;
}

/** The current links of the tasks whose predecessor or link type this bulk edit sets (for Undo) */
async function linksBefore(updates: BulkUpdate[]): Promise<LinksBefore> {
  const ids = updates.filter(u => u.dependency !== undefined || u.dependencyType !== undefined).map(u => u.id);
  if (ids.length === 0) return [];
  const map = await taskRepository.loadDependenciesForTasks(ids);
  return ids.map(taskId => ({
    taskId,
    deps: (map.get(taskId) ?? []).map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType || 'FS', lagDays: d.lagDays ?? 0 })),
  }));
}

/**
 * Bulk edit writes a predecessor where the schedule reads it — task_dependencies — the same way a
 * single edit does: the task's links are replaced by the one given (an empty value removes them).
 * Until 2026-10-09 only the legacy `dependency` column was written, so the link was invisible to
 * the Gantt, critical path, re-flow and Schedule Review. Two statements for the whole batch.
 */
async function replaceLinks(run: Run, saved: BulkUpdate[]): Promise<void> {
  if (saved.length === 0) return;
  await run(`DELETE FROM task_dependencies WHERE task_id IN (${saved.map(() => '?').join(',')})`, saved.map(u => u.id));
  const rows = saved.filter(u => u.dependency && u.dependency !== u.id);
  if (rows.length === 0) return;
  await run(
    `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES ${rows.map(() => '(?, ?, ?, ?, 0)').join(', ')}`,
    rows.flatMap(u => [uuidv4(), u.id, u.dependency, u.dependencyType || 'FS']),
  );
}

/** A bulk edit that changes only the link type: ALL the task's predecessor links take the new type (one type per task, as the bulk field shows) */
async function setLinkTypes(run: Run, saved: BulkUpdate[]): Promise<void> {
  for (const [type, ups] of groupBy(saved, u => u.dependencyType as string)) {
    // eslint-disable-next-line no-await-in-loop -- one statement per link type (at most four)
    await run(`UPDATE task_dependencies SET dependency_type = ? WHERE task_id IN (${ups.map(() => '?').join(',')})`, [type, ...ups.map(u => u.id)]);
  }
}

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
  // null clears it (an undo sends back the empty value the task had)
  assignedTo: z.string().nullable().optional(),
  dependency: z.string().nullable().optional(),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
  comments: z.string().nullable().optional(),
  isMilestone: z.boolean().optional(),
  sortOrder: z.number().optional(),
  parentTaskId: z.string().nullable().optional(),
});

export const bulkUpdateSchema = z.object({
  updates: z.array(bulkUpdateItemSchema).min(1).max(MAX_BULK)
    // the same change is saved in one statement per group, so one task listed twice could end
    // with a different value than the order sent — refuse it plainly instead (2026-10-08)
    .refine(list => new Set(list.map(u => u.id).filter(Boolean)).size === list.filter(u => u.id).length,
      { message: 'Each task may appear only once in a bulk edit — combine its changes into one entry.' }),
});

const bulkStatusSchema = z.object({
  scheduleId: z.string().min(1),
  taskIds: z.array(z.string().min(1)).min(1).max(MAX_BULK),
  status: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * The finish to store for a bulk-created task. A given finish is kept as given; with a
 * start and a duration but no finish, the finish counts WORKING days from the project
 * calendar with the start day included (a milestone finishes on its start). Otherwise
 * none, as before.
 */
export function bulkFinishDate(
  t: { startDate?: string; endDate?: string; estimatedDays?: number; isMilestone?: boolean },
  isWorking: IsWorking,
): string | null {
  if (t.endDate) return t.endDate;
  if (!t.startDate) return null;
  const days = t.isMilestone ? 0 : t.estimatedDays;
  if (days == null) return null;
  const start = utcDay(t.startDate);
  if (isNaN(start.getTime())) return null;
  return ymdOf(finishFor(start, days, isWorking));
}

export async function bulkRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // -----------------------------------------------------------------------
  // POST /tasks — Bulk create tasks
  // -----------------------------------------------------------------------
  fastify.post('/tasks', { preHandler: [requireScope('write'), bodySchedule] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = bulkCreateSchema.parse(request.body);
      const loop = batchLoopRefusal(body.tasks);
      if (loop) return reply.status(400).send({ error: 'Validation error', message: loop });
      // A parent given by id must be a task in this same plan (2026-10-10 audit: any id was written)
      const outsideParents = [...new Set(body.tasks
        .filter((t, i) => t.parentTaskId && batchDependencyIndex(t.parentTaskId, i, body.tasks) === undefined)
        .map(t => t.parentTaskId as string))];
      if (outsideParents.length) {
        const found = await databaseService.query<{ id: string }>(
          `SELECT id FROM tasks WHERE schedule_id = ? AND id IN (${outsideParents.map(() => '?').join(',')})`, [body.scheduleId, ...outsideParents]);
        if (found.length < outsideParents.length) {
          return reply.status(400).send({ error: 'Validation error', message: 'A parent task was not found in this schedule. Pick a parent from the same plan.' });
        }
      }

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

      // The project calendar, read only when some task needs its finish worked out
      const needsFinish = body.tasks.some(t => !t.endDate && t.startDate && (t.isMilestone || t.estimatedDays != null));
      const isWorking: IsWorking = needsFinish ? await scheduleService.workingDayTest(body.scheduleId) : weekdaysOnly;

      await databaseService.transaction(async (connection) => {
        // Each task gets its own position (sort_order), after the schedule's existing tasks
        // and in array order. Without this every bulk-created task got 0, so row order fell
        // back to start date and a task's row number changed whenever its dates moved.
        const maxRows = await databaseService.queryOn<{ max_order: number | null }>(
          connection, 'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tasks WHERE schedule_id = ?', [body.scheduleId]);
        const firstSortOrder = Number(maxRows[0]?.max_order ?? -1) + 1;

        const run = (sql: string, params: any[]) => databaseService.queryOn(connection, sql, params);

        // Pass 1: insert every task. Batch-local refs (name/position) can't be
        // written yet — the tasks they point to may not have an id yet either,
        // if the reference points forward in the array.
        // Written INSERT_BATCH rows per statement (it was one statement per task, 2026-10-08); a
        // batch that fails is retried row by row so each bad row is still reported on its own.
        const rows = body.tasks.map((t, i) => {
          const depIsBatchRef = !!t.dependency && batchDependencyIndex(t.dependency, i, body.tasks) !== undefined;
          const parentIsBatchRef = !!t.parentTaskId && batchDependencyIndex(t.parentTaskId, i, body.tasks) !== undefined;
          const id = uuidv4();
          return {
            i, id, parentIsBatchRef,
            params: [
              id,
              body.scheduleId,
              t.name,
              t.startDate || null,
              bulkFinishDate(t, isWorking),
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
              firstSortOrder + i,
              user.userId,
            ],
          };
        });
        const insertRows = (chunk: typeof rows) => run(
          `INSERT INTO tasks
             (id, schedule_id, name, start_date, end_date, estimated_days, progress_percentage,
              status, priority, assigned_to, dependency, dependency_type, comments, is_milestone,
              parent_task_id, sort_order, created_by, created_at, updated_at)
           VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())').join(', ')}`,
          chunk.flatMap(r => r.params),
        );
        const inserted = (r: (typeof rows)[number]) => {
          const t = body.tasks[r.i];
          createdIds[r.i] = r.id;
          succeeded.push({ id: r.id, name: t.name });
          if (!r.parentIsBatchRef && t.parentTaskId) parentsToRecompute.add(t.parentTaskId);
        };
        // one statement for all of them (at most MAX_BULK)
        try {
          if (rows.length) await insertRows(rows);
          rows.forEach(inserted);
        } catch (batchErr: any) {
          if (TRANSACTION_ENDED.has(batchErr?.errno)) throw batchErr;
          for (const r of rows) {
            try {
              // eslint-disable-next-line no-await-in-loop -- only after the batch failed: find which rows were bad
              await insertRows([r]);
              inserted(r);
            } catch (err: any) {
              if (TRANSACTION_ENDED.has(err?.errno)) throw err;
              failed.push({ index: r.i, name: body.tasks[r.i].name || '', error: err.message || 'Unknown error' });
            }
          }
        }

        // Pass 2: now that every task in the batch has a real id, resolve each
        // dependency/parentTaskId that referred to another task in this same
        // batch by name or position, and write the actual foreign key — collected
        // here and written in a few statements (it was several per task, 2026-10-08).
        const depColumn: Array<[string, string]> = [];      // [taskId, dependency id] for the legacy column
        const parentColumn: Array<[string, string]> = [];   // [taskId, parent id]
        const links: Array<{ taskId: string; ref: string; resolved?: string; type: string }> = [];
        for (let i = 0; i < body.tasks.length; i++) {
          const t = body.tasks[i];
          const selfId = createdIds[i];
          if (!selfId) continue;

          if (t.dependency) {
            const depIndex = batchDependencyIndex(t.dependency, i, body.tasks);
            const resolvedId = depIndex !== undefined ? createdIds[depIndex] : undefined;
            if (resolvedId) depColumn.push([selfId, resolvedId]);
            // The link itself lives in task_dependencies — that is what the schedule, critical
            // path, review and re-flow read. Until 2026-09-25 bulk create only wrote the legacy
            // `dependency` column, so every link made this way (e.g. by the MCP connector) was
            // stored but invisible. An external id must be a task in this schedule.
            if (resolvedId || depIndex === undefined) {
              links.push({ taskId: selfId, ref: t.dependency, resolved: resolvedId, type: t.dependencyType || 'FS' });
            }
          }

          if (t.parentTaskId) {
            const parentIndex = batchDependencyIndex(t.parentTaskId, i, body.tasks);
            const resolvedParentId = parentIndex !== undefined ? createdIds[parentIndex] : undefined;
            if (resolvedParentId) {
              parentColumn.push([selfId, resolvedParentId]);
              parentsToRecompute.add(resolvedParentId);
            }
          }
        }
        await setColumnByCase(run, 'dependency', depColumn);
        await setColumnByCase(run, 'parent_task_id', parentColumn);
        // external ids: one look-up for all of them, limited to this schedule
        const external = [...new Set(links.filter(l => !l.resolved).map(l => l.ref))];
        const inSchedule = new Set(external.length
          ? (await run(`SELECT id FROM tasks WHERE schedule_id = ? AND id IN (${external.map(() => '?').join(',')})`, [body.scheduleId, ...external]) as Array<{ id: string }>).map(r => r.id)
          : []);
        const linkRows = links
          .map(l => ({ ...l, depId: l.resolved ?? (inSchedule.has(l.ref) ? l.ref : undefined) }))
          .filter(l => l.depId && l.depId !== l.taskId);
        if (linkRows.length) {
          await run(
            `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES ${linkRows.map(() => '(?, ?, ?, ?, 0)').join(', ')}`,
            linkRows.flatMap(l => [uuidv4(), l.taskId, l.depId, l.type]),
          );
        }
      });

      // A parent only renders as a summary task once its rollup is recomputed —
      // writing parent_task_id on the child alone doesn't flip is_summary.
      for (const parentId of parentsToRecompute) {
        scheduleService.recomputeParentRollup(parentId).catch(err =>
          logger.error('[Rollup] recomputeParentRollup error on bulk create:', err));
      }

      // New tasks given a predecessor start after it, like adding a link (2026-10-01)
      const newIds = createdIds.filter(Boolean) as string[];
      if (newIds.length > 0) {
        const linked = await databaseService.query<{ task_id: string }>(
          `SELECT DISTINCT task_id FROM task_dependencies WHERE task_id IN (${newIds.map(() => '?').join(',')})`, newIds);
        if (linked.length > 0) {
          await scheduleRecomputeService.recompute(body.scheduleId, { onlyFrom: linked.map(r => r.task_id) })
            .catch(err => logger.error('[bulk create] re-plan after links failed', { error: (err as Error).message }));
        }
      }

      planChanged(body.scheduleId);
      if (succeeded.length > 0) {
        const projectId = await projectOfSchedule(body.scheduleId);
        if (projectId) {
          await changeHistoryService.record({
            projectId,
            scheduleId: body.scheduleId,
            kind: 'bulk_create',
            summary: `Created ${succeeded.length} task${succeeded.length === 1 ? '' : 's'}: ${succeeded.slice(0, 3).map(t => t.name).join(', ')}${succeeded.length > 3 ? ` and ${succeeded.length - 3} more` : ''}`,
            taskIds: succeeded.map(t => t.id),
            undo: { createdIds: succeeded.map(t => t.id) },
          });
        }
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
  fastify.put('/tasks', { preHandler: [requireScope('write'), bodyUpdateSchedules] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = bulkUpdateSchema.parse(request.body);
      const succeeded: Array<{ id: string }> = [];
      const failed: Array<{ id: string; error: string }> = [];
      // Each task must be in the plan it was sent with — the access check covers the plans named,
      // not the task ids (2026-10-10 review: a task of another project lost its links). One look-up;
      // the others fail on their own, before anything of theirs is read or written.
      const ids = body.updates.map(u => u.id).filter(Boolean);
      const planOfTask = new Map(ids.length
        ? (await databaseService.query<{ id: string; schedule_id: string }>(
          `SELECT id, schedule_id FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`, ids)).map(r => [r.id, r.schedule_id])
        : []);
      body.updates = body.updates.filter(u => {
        if (!u.id || planOfTask.get(u.id) === u.scheduleId) return true;
        failed.push({ id: u.id, error: 'Task not found in this schedule' });
        return false;
      });
      if (body.updates.length === 0) return { succeeded, failed };
      const refusal = await bulkStructureRefusal(body.updates);
      if (refusal) return reply.status(400).send({ error: 'Validation error', message: refusal });

      const oldLinks = await linksBefore(body.updates);

      // For Schedule History's Undo: the current values of exactly the fields being changed
      const changedColumns = [...new Set(body.updates.flatMap(u =>
        // eslint-disable-next-line no-restricted-syntax -- small: BULK_UPDATE_COLUMNS is the fixed list of editable fields
        Object.keys(BULK_UPDATE_COLUMNS).filter(k => (u as any)[k] !== undefined).map(k => BULK_UPDATE_COLUMNS[k])))];
      const previous: PreviousValues[] = await changeHistoryService
        .readPrevious(body.updates.map(u => u.id).filter(Boolean), changedColumns)
        .catch(() => []);

      // % on tasks with planned hours is the system's: ignored here too; done = 100%
      const fromHours = await scheduleService.progressFromHoursTaskIds(body.updates.map(u => u.id).filter(Boolean));
      for (const u of body.updates) {
        if (!fromHours.has(u.id)) continue;
        if (u.status === 'completed') u.progressPercentage = 100;
        else delete u.progressPercentage;
      }

      // Summary tasks above the edited tasks roll up afterwards — the parents before the change
      // (a task moved out) and after it (a task moved in), like the single-task edit
      const rollupUpdates = body.updates.filter(u => u.id && u.scheduleId && Object.keys(BULK_UPDATE_COLUMNS)
        .some(k => (u as any)[k] !== undefined && ROLLUP_COLUMNS.has(BULK_UPDATE_COLUMNS[k])));
      const rollupBySchedule = groupBy(rollupUpdates, u => u.scheduleId);
      const parents: string[] = [];
      const readParents = async (run: (sql: string, params: any[]) => Promise<any>) => {
        for (const [sid, ups] of rollupBySchedule) {
          // eslint-disable-next-line no-await-in-loop -- per plan (a bulk edit is almost always one), on the transaction's one connection
          parents.push(...await parentIdsOf(run, sid, ups.map(u => u.id)));
        }
      };

      await databaseService.transaction(async (connection) => {
        const run = (sql: string, params: any[]) => databaseService.queryOn(connection, sql, params);
        await readParents(run);
        const datesBefore = await taskDatesOf(run, body.updates.filter(u => u.startDate !== undefined || u.endDate !== undefined).map(u => u.id));
        // Every link/parent named in the batch, looked up once (it was one query per task, 2026-10-08)
        const allRefs = [...new Set(body.updates.flatMap(u => [u.dependency, u.parentTaskId]).filter((r): r is string => !!r))];
        const planOfRef = new Map(allRefs.length
          ? (await run(`SELECT id, schedule_id FROM tasks WHERE id IN (${allRefs.map(() => '?').join(',')})`, allRefs) as Array<{ id: string; schedule_id: string }>).map(r => [r.id, r.schedule_id])
          : []);
        // Updates with exactly the same change in the same plan are saved in one statement
        const groups = new Map<string, { sql: string; params: any[]; scheduleId: string; ids: string[] }>();
        for (const u of body.updates) {
          try {
            if (!u.id || !u.scheduleId) {
              failed.push({ id: u.id || 'unknown', error: 'id and scheduleId are required' });
              continue;
            }

            // A link or a parent must be a task in the same plan (2026-10-05 audit: these went
            // straight into the row, so they could point into another plan or project)
            // eslint-disable-next-line no-restricted-syntax -- small: a two-item list (link + parent)
            const refs = [u.dependency, u.parentTaskId].filter((r): r is string => !!r);
            if (refs.some(r => r === u.id)) {
              failed.push({ id: u.id, error: 'A task cannot be linked to or nested under itself' });
              continue;
            }
            if (refs.some(r => planOfRef.get(r) !== u.scheduleId)) {
              failed.push({ id: u.id, error: 'The predecessor or parent task must be in the same schedule' });
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
            const sql = `UPDATE tasks SET ${sets.join(', ')}`;
            const key = JSON.stringify([u.scheduleId, sql, params]);
            const group = groups.get(key);
            if (group) group.ids.push(u.id);
            else groups.set(key, { sql, params, scheduleId: u.scheduleId, ids: [u.id] });
          } catch (err: any) {
            failed.push({ id: u.id || 'unknown', error: err.message || 'Unknown error' });
          }
        }
        const saved = new Set<string>();
        const saveRows = (g: { sql: string; params: any[]; scheduleId: string }, ids: string[]) =>
          run(`${g.sql} WHERE schedule_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [...g.params, g.scheduleId, ...ids]);
        for (const g of groups.values()) {
          try {
            // eslint-disable-next-line no-await-in-loop -- one statement per distinct change, on the transaction's one connection
            await saveRows(g, g.ids);
            g.ids.forEach(id => saved.add(id));
          } catch (groupErr: any) {
            if (TRANSACTION_ENDED.has(groupErr?.errno)) throw groupErr;
            for (const id of g.ids) {
              try {
                // eslint-disable-next-line no-await-in-loop -- only after a group failed: find which rows were bad
                await saveRows(g, [id]);
                saved.add(id);
              } catch (err: any) {
                if (TRANSACTION_ENDED.has(err?.errno)) throw err;
                failed.push({ id, error: err.message || 'Unknown error' });
              }
            }
          }
        }
        // the predecessors go where the schedule reads them, for the tasks that were saved
        await replaceLinks(run, body.updates.filter(u => u.dependency !== undefined && saved.has(u.id)));
        // a new link type on its own changes the task's existing links (it only changed the old column)
        await setLinkTypes(run, body.updates.filter(u => u.dependency === undefined && u.dependencyType && saved.has(u.id)));
        // both lists in the order they were asked for
        for (const u of body.updates) if (u.id && saved.has(u.id)) succeeded.push({ id: u.id });
        const askedAt = new Map(body.updates.map((u, i) => [u.id || 'unknown', i]));
        failed.sort((a, b) => (askedAt.get(a.id) ?? 0) - (askedAt.get(b.id) ?? 0));
        // booked hours move with their tasks
        await moveBookingsWithTasks(run, datesBefore);
        await readParents(run);
      });

      // Awaited BEFORE History records the change, so it doesn't look "changed since"
      await rollUpSummaries(parents);

      const doneIds = new Set(succeeded.map(s => s.id));
      const doneBySchedule = groupBy(body.updates.filter(u => doneIds.has(u.id)), u => u.scheduleId);
      for (const [sid, doneUpdates] of doneBySchedule) {
        planChanged(sid);
        const ids = doneUpdates.map(u => u.id);
        const idSet = new Set(ids);
        // A new predecessor pushes the task (and what follows) later if it now starts too early —
        // the same rule as a single edit; never pulled earlier. Awaited before History records.
        // eslint-disable-next-line no-restricted-syntax -- once per plan in the batch (almost always one)
        const linked = doneUpdates.filter(u => u.dependency || u.dependencyType).map(u => u.id);
        // eslint-disable-next-line no-await-in-loop -- per plan (a bulk edit is almost always one); History entries in order
        const moved = linked.length ? (await scheduleRecomputeService.recompute(sid, { onlyFrom: linked, reason: 'link_added' })
          .catch((err: any) => { logger.error('[bulk update] re-plan after links failed', { error: err?.message }); return { deltas: [] }; })).deltas : [];
        // eslint-disable-next-line no-await-in-loop -- per plan (a bulk edit is almost always one); History entries in order
        const projectId = await projectOfSchedule(sid);
        if (projectId) {
          // eslint-disable-next-line no-restricted-syntax -- once per plan in the batch (almost always one), membership via a Set
          const fields = [...new Set(body.updates.filter(u => idSet.has(u.id)).flatMap(u =>
            // eslint-disable-next-line no-restricted-syntax -- small: BULK_UPDATE_COLUMNS is the fixed list of editable fields
            Object.keys(BULK_UPDATE_COLUMNS).filter(k => (u as any)[k] !== undefined)))];
          // eslint-disable-next-line no-await-in-loop -- one History entry per plan, recorded in order
          await changeHistoryService.record({
            projectId,
            scheduleId: sid,
            kind: 'bulk_update',
            summary: `Edited ${ids.length} task${ids.length === 1 ? '' : 's'} (${describeFields(fields)})`,
            taskIds: ids,
            undo: {
              // eslint-disable-next-line no-restricted-syntax -- once per plan in the batch (almost always one), membership via a Set
              previous: previous.filter(p => idSet.has(p.id)),
              // eslint-disable-next-line no-restricted-syntax -- once per plan in the batch (almost always one), membership via a Set
              links: oldLinks.filter(l => idSet.has(l.taskId)),
              moved: moved.map(d => ({ taskId: d.taskId, startDate: d.oldStart, endDate: d.oldEnd })),
            },
          });
        }
      }
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
  fastify.put('/tasks/status', { preHandler: [requireScope('write'), bodySchedule] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = bulkStatusSchema.parse(request.body);

      const previous = await changeHistoryService.readPrevious(body.taskIds, ['status']).catch(() => [] as PreviousValues[]);
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

      // A summary's status and % follow its tasks — roll up before History records
      if (updated > 0) await rollUpSummaries(await parentIdsOf((sql, params) => databaseService.query(sql, params), body.scheduleId, body.taskIds));

      planChanged(body.scheduleId);
      const projectId = updated > 0 ? await projectOfSchedule(body.scheduleId) : null;
      if (projectId) {
        await changeHistoryService.record({
          projectId,
          scheduleId: body.scheduleId,
          kind: 'bulk_status',
          summary: `Set ${body.taskIds.length} task${body.taskIds.length === 1 ? '' : 's'} to ${STATUS_LABEL[body.status] ?? body.status}`,
          taskIds: body.taskIds,
          undo: { previous },
        });
      }
      return { updated };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Batch status update error', { error });
      return reply.status(500).send({ error: 'Failed to batch update task status' });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /tasks — Bulk delete tasks
  // -----------------------------------------------------------------------
  fastify.delete('/tasks', { preHandler: [requireScope('write'), bodySchedule] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = z.object({
        scheduleId: z.string().min(1),
        taskIds: z.array(z.string().min(1)).min(1).max(MAX_BULK),
      }).parse(request.body);

      // One transaction: copy everything the delete removes (for Undo in Schedule History), then
      // delete. The copy is read under a lock so it matches exactly what is deleted.
      const snapshot = await databaseService.transaction(async (connection) =>
        deleteTasksKeepingCopy((sql, params) => databaseService.queryOn(connection, sql, params), body.scheduleId, body.taskIds));
      const deletedIds = new Set(snapshot.tasks.map((t: any) => String(t.id)));

      // Summary tasks above the deleted ones: their dates and totals follow (awaited, so History
      // is recorded after these writes, not before)
      const parentIds = new Set<string>();
      for (const row of snapshot.tasks as any[]) {
        if (row.parent_task_id && !deletedIds.has(row.parent_task_id)) parentIds.add(row.parent_task_id);
      }
      await Promise.all([...parentIds].map(pid => scheduleService.recomputeParentRollup(pid).catch(err =>
        logger.error('[Rollup] recomputeParentRollup error on bulk delete:', err))));

      planChanged(body.scheduleId);
      let changeId: string | null = null;
      const projectId = deletedIds.size > 0 ? await projectOfSchedule(body.scheduleId) : null;
      if (projectId) {
        changeId = await changeHistoryService.record({
          projectId,
          scheduleId: body.scheduleId,
          kind: 'bulk_delete',
          summary: deleteSummary(snapshot.tasks.map((t: any) => String(t.name))),
          taskIds: [...deletedIds],
          undo: snapshot,
        });
      }
      return { deleted: deletedIds.size, changeId };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Bulk delete tasks error', { error });
      return reply.status(500).send({ error: 'Failed to bulk delete tasks' });
    }
  });
}
