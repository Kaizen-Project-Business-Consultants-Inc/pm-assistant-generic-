import { v4 as uuidv4 } from 'uuid';
import { taskDatesOf, moveBookingsWithTasks, takeBookingMoves, writeBookingDates, type BookingMove } from '../database/bookingDates';
import { databaseService } from '../database/connection';
import { syncDependencyMirror } from '../database/dependencyMirror';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import { scheduleService } from './ScheduleService';
import { restoreTaskDates } from './ScheduleRecomputeService';
import { auditLedgerService } from './AuditLedgerService';
import { planChanged } from './domainEvents';
import logger from '../utils/logger';
import { TASK_STATUS_LABEL } from '../constants/taskStatus';

/**
 * Schedule History — one line per GROUP change, with an Undo that works later (the
 * client's 4-second toast and Ctrl+Z stack are lost on reload, and never covered
 * changes Claude made through the MCP server).
 *
 * Covered kinds and how each is undone:
 *  - link          remove the links added, put re-flowed dates back
 *  - bulk_update   write back the previous values of the fields that changed; a predecessor set
 *                  by the edit: the task's old links back, and tasks the new link pushed back
 *  - bulk_status   write back each task's previous status
 *  - bulk_create   delete the tasks that were created
 *  - review_fix    the Schedule Review proposal's own undo (ref = proposal id)
 *  - ai_reschedule put the dates back
 *  - successors_moved  a task re-dated by hand pushed the tasks after it later: all of their
 *                  dates back, the edited task's too (followSuccessors.ts)
 *  - group         tasks back to their old parent, the new summary removed
 *  - calendar      put the dates back (a working-calendar change, or the days-off clean-up;
 *                  the calendar itself stays as it is)
 *  - reassign      the old resource back on the tasks ("Replace Generic Developer with …")
 *  - planner_move  a Team Planner drop: the person back, the dates (and hours bookings) back
 *  - bulk_delete   (also a single-task delete: task form, Gantt menu, MCP delete-task)
 *                  the deleted tasks back WITH THEIR OLD IDS (so time entries, checklists, files and
 *                  baselines that still point at them reconnect), with their links, booked hours,
 *                  people, comments and activity, from a copy taken inside the delete
 *  - import        delete what the import added: its tasks (links and bookings go with them), the
 *                  "Imported baseline", and the people it created if nothing else uses them now
 *
 * Product owner, 2026-10-01: History is a RECORD. Each entry says what it did, before -> after.
 * Only the newest change to a plan can be undone, and only until anything else in the plan
 * changes — undoing an older change would rewind one thread of a connected plan while later work
 * built on it stays. There is no "undo anyway".
 */

export type ChangeKind = 'link' | 'bulk_update' | 'bulk_status' | 'bulk_create' | 'review_fix' | 'ai_reschedule' | 'group' | 'calendar' | 'reassign' | 'planner_move' | 'bulk_delete' | 'import' | 'successors_moved';

/** Above this, the copy needed to undo is not kept: the change is recorded, but can't be undone */
export const MAX_UNDO_BYTES = 5 * 1024 * 1024;
const TOO_LARGE_NOTE = ' (too large to undo from History)';

/** Columns bulk update may change — the only ones we read before and write back on undo */
export const BULK_UPDATE_COLUMNS: Record<string, string> = {
  name: 'name', startDate: 'start_date', endDate: 'end_date', estimatedDays: 'estimated_days',
  progressPercentage: 'progress_percentage', status: 'status', priority: 'priority', assignedTo: 'assigned_to',
  dependency: 'dependency', dependencyType: 'dependency_type', comments: 'comments', isMilestone: 'is_milestone',
  sortOrder: 'sort_order', parentTaskId: 'parent_task_id',
};
const DATE_COLUMNS = new Set(['start_date', 'end_date']);

/** Task columns a summary task's roll-up (dates, %, status, totals) is worked out from */
export const ROLLUP_COLUMNS = new Set(['start_date', 'end_date', 'estimated_days', 'progress_percentage', 'status', 'parent_task_id']);

/** The summary tasks the given tasks of this schedule sit under right now (read before a re-parent AND after it) */
export async function parentIdsOf(run: Run, scheduleId: string, taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const rows = (await run(
    `SELECT DISTINCT parent_task_id FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')}) AND schedule_id = ? AND parent_task_id IS NOT NULL`,
    [...taskIds, scheduleId])) as Array<{ parent_task_id: string | null }>;
  return (Array.isArray(rows) ? rows : []).map(r => r.parent_task_id).filter((p): p is string => !!p);
}

/**
 * Bring the given summary tasks' dates and totals up to date — one after another, awaited, so a
 * caller records Schedule History AFTER these writes (else "the plan changed since" would trip).
 * A parent left with no tasks stops being a summary (recomputeParentRollup does that).
 */
export async function rollUpSummaries(parentIds: Iterable<string>, scheduleId?: string): Promise<void> {
  const ids = new Set(parentIds);
  // the plan's calendar once for all of them (each roll-up read it again — review 2026-10-10)
  const isWorking = ids.size && scheduleId ? await scheduleService.workingDayTest(scheduleId) : undefined;
  for (const pid of ids) {
    // eslint-disable-next-line no-await-in-loop -- roll-ups run one after another and finish before the caller records Schedule History
    await scheduleService.recomputeParentRollup(pid, 0, { isWorking }).catch((err: any) =>
      logger.error('[Rollup] recomputeParentRollup error after a bulk change', { pid, error: err?.message }));
  }
}

export interface RecordInput {
  projectId: string;
  scheduleId: string;
  kind: ChangeKind;
  summary: string;
  taskIds: string[];
  undo: unknown;
  ref?: string;
}

export interface ChangeEntry {
  id: string;
  kind: ChangeKind;
  summary: string;
  actorId: string | null;
  actorName: string | null;
  source: 'web' | 'mcp' | 'system';
  status: 'applied' | 'undone';
  undoable: boolean;
  createdAt: string;
  undoneAt: string | null;
  undoneByName: string | null;
  /** What the change did, in plain words ("Build Sprint 1: start 12 Oct → 19 Oct"). Empty for older entries. */
  details: string[];
}

export class ChangeConflictError extends Error {
  constructor(public editedCount: number) { super(`${editedCount} task(s) were edited after this change`); }
}
/** Not the newest change, or the plan changed since: History only undoes the latest, untouched change */
export class NotLatestChangeError extends Error {
  constructor() { super('Only the most recent change can be undone, and only until something else in the plan changes. To reverse an older change, make the change again by hand.'); }
}
export class ChangeStateError extends Error {}

/** A (task id, previous column values) pair for bulk update / status undo */
export interface PreviousValues { id: string; values: Record<string, unknown> }

const parseJson = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
};

/** Kinds whose undo needs the copy kept with the change (none is kept when it was too large) */
const NEEDS_COPY = new Set<string>(['bulk_delete', 'import']);

/**
 * Undo handlers for changes another feature knows how to put back (code health step 1D,
 * 2026-10-03). History used to reach into the review-fix, resource-replace and Team Planner code
 * to undo their changes, while they reach into History to record them — a circle. Each now hands
 * History its undo at startup (services/domainListeners.ts, run by the app and the job runner).
 * Returns how many tasks were put back.
 */
export type UndoHandler = (scheduleId: string, payload: any, ctx: { ref: string | null; userId: string | null }) => Promise<number>;
const undoHandlers = new Map<ChangeKind, UndoHandler>();
/** The change kinds whose undo another feature registers */
export const REGISTERED_UNDO_KINDS: readonly ChangeKind[] = ['review_fix', 'reassign', 'planner_move'];
export function registerUndoHandler(kind: ChangeKind, handler: UndoHandler): void { undoHandlers.set(kind, handler); }
export function hasUndoHandler(kind: ChangeKind): boolean { return undoHandlers.has(kind); }
/** Test hook */
export function _resetUndoHandlersForTests(): void { undoHandlers.clear(); }

type Run = (sql: string, params: any[]) => Promise<any[]>;
type Row = Record<string, unknown>;
const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What a bulk delete removed: enough to put it all back under the same ids */
export interface DeleteSnapshot {
  tasks: Row[];
  links: Row[];
  bookings: Row[];
  assignments: Row[];
  comments: Row[];
  activities: Row[];
  /** Tasks whose old single-predecessor columns named a deleted task (the delete clears them) */
  successors: Array<{ id: string; dependency: string; dependency_type: string | null; dependency_lag_days: number | null }>;
}

/** What an import added */
export interface ImportUndo {
  createdIds: string[];
  /** People the import created because the file named someone unknown */
  resourceIds?: string[];
  baselineId?: string | null;
  links?: number;
  fileName?: string | null;
}

/** A delete leaves nothing on the remaining tasks, so it stamps the schedule (see planChangedSince) */
export async function touchScheduleForDelete(run: Run, scheduleId: string): Promise<void> {
  await run('UPDATE schedules SET updated_at = NOW() WHERE id = ?', [scheduleId]);
}

/**
 * Everything a bulk delete removes, read inside the delete's own transaction BEFORE the delete
 * (tasks locked FOR UPDATE), so the copy and the delete see the same rows. Tables without a
 * foreign key to tasks (time entries, checklists, files, baselines…) keep their rows and the old
 * task id, so restoring the tasks under the same ids reconnects them.
 */
export async function snapshotTasksForDelete(run: Run, scheduleId: string, taskIds: string[]): Promise<DeleteSnapshot> {
  const empty: DeleteSnapshot = { tasks: [], links: [], bookings: [], assignments: [], comments: [], activities: [], successors: [] };
  const wanted = [...new Set(taskIds)];
  if (wanted.length === 0) return empty;
  const tasks = await run(`SELECT * FROM tasks WHERE id IN (${ph(wanted.length)}) AND schedule_id = ? FOR UPDATE`, [...wanted, scheduleId]);
  if (!Array.isArray(tasks) || tasks.length === 0) return empty;
  const ids = tasks.map((t: any) => String(t.id));
  const inIds = ph(ids.length);
  const byTask = (table: string) => run(`SELECT * FROM ${table} WHERE task_id IN (${inIds})`, ids);
  return {
    tasks,
    links: await run(`SELECT * FROM task_dependencies WHERE task_id IN (${inIds}) OR dependency_id IN (${inIds})`, [...ids, ...ids]),
    bookings: await byTask('resource_assignments'),
    assignments: await byTask('task_assignments'),
    comments: await byTask('task_comments'),
    activities: await byTask('task_activities'),
    successors: await run(
      `SELECT id, dependency, dependency_type, dependency_lag_days FROM tasks
        WHERE dependency IN (${inIds}) AND schedule_id = ? AND id NOT IN (${inIds})`, [...ids, scheduleId, ...ids]),
  };
}

/**
 * The one delete both delete paths use — bulk delete (DELETE /bulk/tasks) and the single-task
 * delete (task form, Gantt menu, MCP delete-task, via ChangeHistoryService.deleteTaskWithHistory):
 * copy everything it removes, then clear the old single-predecessor columns that named these
 * tasks, delete them, and stamp the schedule. Call it inside the delete's transaction (`run` on
 * that connection) so the copy and the delete see the same rows. Returns the copy; nothing is
 * deleted when none of the tasks is on this schedule.
 */
export async function deleteTasksKeepingCopy(run: Run, scheduleId: string, taskIds: string[]): Promise<DeleteSnapshot> {
  const snap = await snapshotTasksForDelete(run, scheduleId, taskIds);
  if (snap.tasks.length === 0) return snap;
  const ids = snap.tasks.map(t => String(t.id));
  const inIds = ph(ids.length);
  await run(
    `UPDATE tasks SET dependency = NULL, dependency_type = NULL, dependency_lag_days = 0 WHERE dependency IN (${inIds}) AND schedule_id = ?`,
    [...ids, scheduleId]);
  await run(`DELETE FROM tasks WHERE id IN (${inIds}) AND schedule_id = ?`, [...ids, scheduleId]);
  // A delete leaves no trace on the remaining tasks: History must still see the plan changed
  await touchScheduleForDelete(run, scheduleId);
  return snap;
}

/** "Deleted 1 task: Design", "Deleted 2 tasks: Design and Build", "Deleted 5 tasks: Design, Build and 3 more" */
export function deleteSummary(names: string[]): string {
  const n = names.length;
  const list = n === 1 ? names[0] : n === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${n - 2} more`;
  return `Deleted ${n} task${n === 1 ? '' : 's'}: ${list}`;
}

const RESTORE_TABLES = ['tasks', 'task_dependencies', 'resource_assignments', 'task_assignments', 'task_comments', 'task_activities'];

/** The columns each table has now (a copy taken before a migration may name one that is gone) */
async function columnsOf(run: Run, tables: string[]): Promise<Map<string, Set<string>>> {
  const rows = await run(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${ph(tables.length)}) AND EXTRA NOT LIKE '%GENERATED%'`, tables);
  const map = new Map<string, Set<string>>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!map.has(r.t)) map.set(r.t, new Set());
    map.get(r.t)!.add(r.c);
  }
  return map;
}

/** A copied value back into a column: JSON objects as text, a serialised Buffer as a Buffer */
function toDbValue(v: unknown): unknown {
  if (v && typeof v === 'object') {
    const b = v as { type?: string; data?: unknown };
    if (b.type === 'Buffer' && Array.isArray(b.data)) return Buffer.from(b.data as number[]);
    return JSON.stringify(v);
  }
  return v;
}

async function insertRow(run: Run, table: string, row: Row, columns: Map<string, Set<string>>, ignore = false): Promise<void> {
  const known = columns.get(table);
  const keys = Object.keys(row).filter(k => SAFE_IDENT.test(k) && (!known || known.has(k)));
  if (keys.length === 0) return;
  await run(
    `INSERT ${ignore ? 'IGNORE ' : ''}INTO ${table} (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${ph(keys.length)})`,
    keys.map(k => toDbValue(row[k])));
}

async function idsPresent(run: Run, table: 'tasks' | 'resources', ids: string[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter(Boolean))];
  if (list.length === 0) return new Set();
  const rows = await run(`SELECT id FROM ${table} WHERE id IN (${ph(list.length)})`, list);
  return new Set((Array.isArray(rows) ? rows : []).map((r: any) => String(r.id)));
}

/** Parents before their children (no foreign key needs it; it keeps the restore in a sensible order) */
function parentsFirst(tasks: Row[]): Row[] {
  const byId = new Map(tasks.map(t => [String(t.id), t]));
  const depth = (t: Row): number => {
    let d = 0;
    let p = t.parent_task_id as string | null;
    while (p && byId.has(p) && d < 50) { d++; p = byId.get(p)!.parent_task_id as string | null; }
    return d;
  };
  return [...tasks].sort((a, b) => depth(a) - depth(b));
}

/**
 * Undo a bulk delete: the tasks back under their old ids, then what hung off them. A link comes
 * back only when both its tasks exist; hours bookings and people on tasks only when the person
 * still exists. One transaction: all of it, or none.
 */
async function restoreDeletedTasks(scheduleId: string, snap: DeleteSnapshot): Promise<number> {
  const tasks = (snap.tasks ?? []).filter(t => typeof t.id === 'string');
  if (tasks.length === 0) throw new ChangeStateError('There is nothing to put back for this change.');
  const ids = tasks.map(t => String(t.id));
  let skippedLinks = 0;
  let skippedPeople = 0;
  await databaseService.transaction(async (conn) => {
    const run: Run = (sql, params) => databaseService.queryOn(conn, sql, params);
    if ((await idsPresent(run, 'tasks', ids)).size > 0) {
      throw new ChangeStateError('Some of these tasks are already back in the plan, so the delete can\'t be undone.');
    }
    if ((await run('SELECT id FROM schedules WHERE id = ?', [scheduleId])).length === 0) {
      throw new ChangeStateError('This schedule no longer exists.');
    }
    const columns = await columnsOf(run, RESTORE_TABLES);
    // eslint-disable-next-line no-await-in-loop -- undo restore inside one transaction: parents are inserted before their children
    for (const t of parentsFirst(tasks)) await insertRow(run, 'tasks', { ...t, schedule_id: scheduleId }, columns);

    const links = snap.links ?? [];
    const ends = await idsPresent(run, 'tasks', links.flatMap(l => [String(l.task_id), String(l.dependency_id)]));
    for (const l of links) {
      // eslint-disable-next-line no-await-in-loop -- undo restore inside one transaction: links go back after both their tasks exist
      if (ends.has(String(l.task_id)) && ends.has(String(l.dependency_id))) await insertRow(run, 'task_dependencies', l, columns, true);
      else skippedLinks++;
    }

    const bookings = snap.bookings ?? [];
    const assignments = snap.assignments ?? [];
    const people = await idsPresent(run, 'resources', [...bookings, ...assignments].map(r => String(r.resource_id)));
    for (const b of bookings) {
      // eslint-disable-next-line no-await-in-loop -- undo restore inside one transaction on one connection; runs only when a user undoes a delete
      if (people.has(String(b.resource_id))) await insertRow(run, 'resource_assignments', { ...b, schedule_id: scheduleId }, columns, true);
      else skippedPeople++;
    }
    for (const a of assignments) {
      // eslint-disable-next-line no-await-in-loop -- undo restore inside one transaction on one connection; runs only when a user undoes a delete
      if (people.has(String(a.resource_id))) await insertRow(run, 'task_assignments', a, columns, true);
      else skippedPeople++;
    }
    // eslint-disable-next-line no-await-in-loop -- undo restore inside one transaction on one connection; runs only when a user undoes a delete
    for (const c of snap.comments ?? []) await insertRow(run, 'task_comments', c, columns, true);
    // eslint-disable-next-line no-await-in-loop -- undo restore inside one transaction on one connection; runs only when a user undoes a delete
    for (const a of snap.activities ?? []) await insertRow(run, 'task_activities', a, columns, true);

    // The old single-predecessor columns the delete cleared on the tasks that followed
    for (const s of snap.successors ?? []) {
      // eslint-disable-next-line no-await-in-loop -- undo restore inside one transaction on one connection; runs only when a user undoes a delete
      await run(
        'UPDATE tasks SET dependency = ?, dependency_type = ?, dependency_lag_days = ? WHERE id = ? AND schedule_id = ? AND dependency IS NULL',
        [s.dependency, s.dependency_type ?? null, s.dependency_lag_days ?? 0, s.id, scheduleId]);
    }
  });
  if (skippedLinks || skippedPeople) {
    logger.info('[ChangeHistory] delete undone; some links/people were gone', { scheduleId, skippedLinks, skippedPeople });
  }
  // Summary tasks the deleted tasks sat under get their dates and totals back
  const parents = new Set(tasks.map(t => t.parent_task_id as string | null).filter((p): p is string => !!p && !ids.includes(p)));
  await rollUpSummaries(parents, scheduleId);
  return tasks.length;
}

/**
 * The people an import created that nothing uses now and nobody has edited since the import —
 * any column named *resource_id in this company's database, or a task's Assigned to, counts as use.
 */
async function unusedResources(run: Run, resourceIds: string[], createdAt: unknown): Promise<string[]> {
  const ids = [...new Set(resourceIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const untouched = await run(
    `SELECT id FROM resources WHERE id IN (${ph(ids.length)}) AND updated_at <= DATE_ADD(?, INTERVAL 5 SECOND)`, [...ids, createdAt]);
  const candidates = new Set((Array.isArray(untouched) ? untouched : []).map((r: any) => String(r.id)));
  if (candidates.size === 0) return [];
  const refs = await run(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'resources' AND COLUMN_NAME LIKE '%resource_id'`, []);
  const columns: Array<{ t: string; c: string }> = [
    { t: 'tasks', c: 'assigned_to' },
    ...(Array.isArray(refs) ? refs : []).filter((r: any) => SAFE_IDENT.test(r.t) && SAFE_IDENT.test(r.c)),
  ];
  for (const { t, c } of columns) {
    if (candidates.size === 0) break;
    const list = [...candidates];
    // eslint-disable-next-line no-await-in-loop -- each column check shrinks the candidate list and the loop stops once nothing is left
    const used = await run(`SELECT DISTINCT \`${c}\` AS id FROM \`${t}\` WHERE \`${c}\` IN (${ph(list.length)})`, list);
    for (const u of Array.isArray(used) ? used : []) candidates.delete(String(u.id));
  }
  return [...candidates];
}

/**
 * Undo an import: its tasks go (their links, bookings and comments go with them), so does the
 * "Imported baseline" it saved, and the people it created unless something else uses them now.
 */
async function removeImported(scheduleId: string, u: ImportUndo, createdAt: unknown): Promise<number> {
  const ids = [...new Set(u.createdIds ?? [])];
  let removed = 0;
  await databaseService.transaction(async (conn) => {
    const run: Run = (sql, params) => databaseService.queryOn(conn, sql, params);
    if (ids.length > 0) {
      const res: any = await run(`DELETE FROM tasks WHERE id IN (${ph(ids.length)}) AND schedule_id = ?`, [...ids, scheduleId]);
      removed = Number(res?.affectedRows ?? ids.length);
      await touchScheduleForDelete(run, scheduleId);
    }
    if (u.baselineId) await run('DELETE FROM schedule_baselines WHERE id = ? AND schedule_id = ?', [u.baselineId, scheduleId]);
    const unused = await unusedResources(run, u.resourceIds ?? [], createdAt);
    if (unused.length > 0) await run(`DELETE FROM resources WHERE id IN (${ph(unused.length)})`, unused);
  });
  return removed;
}

class ChangeHistoryService {
  /**
   * Record a group change. Never throws: history must not break the change it records
   * (a missing line only means that one change can't be undone from History).
   */
  /**
   * A delete a person (or Claude) makes on one task — the task form, the Gantt menu, MCP
   * delete-task, the assistant: the schedule's own delete (roll-ups, audit, notices), with the
   * copy for Undo taken in the delete's transaction, then a History line ("Deleted 1 task:
   * Build") recorded after the roll-up. Undo puts it back exactly like a bulk delete.
   * (Moved here from ScheduleService in step 1D, so the schedule code doesn't call History.)
   */
  async deleteTaskWithHistory(taskId: string): Promise<{ deleted: boolean; changeId: string | null }> {
    const r = await scheduleService.removeTask(taskId, deleteTasksKeepingCopy);
    const snap = r.copy;
    if (!r.deleted || !snap || !r.projectId || !r.scheduleId) return { deleted: r.deleted, changeId: null };
    const changeId = await this.record({
      projectId: r.projectId,
      scheduleId: r.scheduleId,
      kind: 'bulk_delete',
      summary: deleteSummary(snap.tasks.map(t => String(t.name))),
      taskIds: snap.tasks.map(t => String(t.id)),
      undo: snap,
    });
    return { deleted: true, changeId };
  }

  async record(input: RecordInput): Promise<string | null> {
    try {
      if (input.taskIds.length === 0) return null;
      const ctx = getRequestContext();
      const id = uuidv4();
      const details = await describeChange(input).catch(() => [] as string[]);
      // Hours bookings the change moved: their exact old dates, so Undo puts them back as they were
      // (audit 2026-10-09 M1: re-following the task on Undo grew a booking that had been cut to fit)
      const bookingMoves = takeBookingMoves(input.taskIds);
      const payload = bookingMoves.length && input.undo && typeof input.undo === 'object' && !Array.isArray(input.undo)
        ? { ...(input.undo as Record<string, unknown>), bookingMoves }
        : input.undo;
      // A very large copy (a bulk delete of tasks with long notes and history) is not kept:
      // the change is still recorded, and says it can't be undone
      let undo = JSON.stringify(payload ?? null);
      let summary = input.summary;
      if (undo.length > MAX_UNDO_BYTES) {
        undo = 'null';
        summary = summary.slice(0, 500 - TOO_LARGE_NOTE.length) + TOO_LARGE_NOTE;
      }
      await databaseService.query(
        `INSERT INTO change_batches (id, project_id, schedule_id, kind, summary, actor_id, source, ref, task_ids, undo_payload, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.projectId, input.scheduleId, input.kind, summary.slice(0, 500), ctx?.userId ?? null,
          getActorSource(), input.ref ?? null, JSON.stringify([...new Set(input.taskIds)]), undo,
          JSON.stringify(details)],
      );
      return id;
    } catch (err: any) {
      logger.warn('[ChangeHistory] record failed', { kind: input.kind, scheduleId: input.scheduleId, error: err?.message });
      return null;
    }
  }

  /** Previous values of the given columns, for bulk update / status undo */
  async readPrevious(taskIds: string[], columns: string[]): Promise<PreviousValues[]> {
    if (taskIds.length === 0 || columns.length === 0) return [];
    const cols = columns.filter(c => Object.values(BULK_UPDATE_COLUMNS).includes(c));
    const select = cols.map(c => (DATE_COLUMNS.has(c) ? `DATE_FORMAT(${c}, '%Y-%m-%d') AS ${c}` : c)).join(', ');
    const rows = await databaseService.query<any>(
      `SELECT id, ${select} FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`, taskIds,
    );
    return rows.map((r: any) => ({ id: r.id, values: Object.fromEntries(cols.map(c => [c, r[c] ?? null])) }));
  }

  async list(scheduleId: string, days = 30): Promise<ChangeEntry[]> {
    const rows = await databaseService.query<any>(
      `SELECT id, kind, summary, actor_id, source, status, undone_at, undone_by, created_at, details,
              (undo_payload IS NULL OR CAST(undo_payload AS CHAR) = 'null') AS no_undo
       FROM change_batches
       WHERE schedule_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [scheduleId, days],
    );
    const ids = [...new Set(rows.flatMap((r: any) => [r.actor_id, r.undone_by]).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const users = await databaseService.queryControlPlane<any>(
        `SELECT id, full_name, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids,
      );
      for (const u of users) names.set(u.id, u.full_name || u.username);
    }
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    // Only the newest entry can be undone, while it is still applied and nothing has changed since
    const newest = rows[0];
    const newestUndoable = !!newest && newest.status === 'applied'
      && !(NEEDS_COPY.has(newest.kind) && Number(newest.no_undo))
      && !(await this.planChangedSince(scheduleId, newest.created_at));
    return rows.map((r: any, i: number) => ({
      id: r.id,
      kind: r.kind,
      summary: r.summary,
      actorId: r.actor_id,
      actorName: r.actor_id ? names.get(r.actor_id) ?? null : null,
      source: r.source,
      status: r.status,
      undoable: i === 0 && newestUndoable,
      createdAt: iso(r.created_at)!,
      undoneAt: iso(r.undone_at),
      undoneByName: r.undone_by ? names.get(r.undone_by) ?? null : null,
      details: parseJson<string[]>(r.details, []),
    }));
  }

  /**
   * The same rule for undo paths outside History (e.g. the Schedule Review panel's own Undo):
   * the change recorded for `kind`/`ref` must be the newest on the plan, with nothing changed since.
   */
  async assertLatestByRef(scheduleId: string, kind: ChangeKind, ref: string): Promise<void> {
    const [mine] = await databaseService.query<any>(
      `SELECT id, created_at FROM change_batches WHERE schedule_id = ? AND kind = ? AND ref = ? AND status = 'applied'
       ORDER BY created_at DESC LIMIT 1`, [scheduleId, kind, ref],
    );
    if (!mine) return; // applied before History existed — nothing to compare against
    const [latest] = await databaseService.query<any>(
      `SELECT id FROM change_batches WHERE schedule_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`, [scheduleId],
    );
    if (!latest || latest.id !== mine.id || await this.planChangedSince(scheduleId, mine.created_at)) throw new NotLatestChangeError();
  }

  /**
   * Has anything in the plan been edited since this moment? (a few seconds' grace for the change's
   * own follow-up writes). A task edit shows on the task; a task DELETE leaves nothing behind on the
   * tasks, so every delete stamps the schedule (touchScheduleForDelete) and that counts too.
   */
  private async planChangedSince(scheduleId: string, createdAt: unknown): Promise<boolean> {
    const edited = await databaseService.query<any>(
      `SELECT COUNT(*) AS cnt FROM tasks WHERE schedule_id = ? AND updated_at > DATE_ADD(?, INTERVAL 5 SECOND)
       UNION ALL
       SELECT COUNT(*) AS cnt FROM schedules WHERE id = ? AND updated_at > DATE_ADD(?, INTERVAL 5 SECOND)`,
      [scheduleId, createdAt, scheduleId, createdAt],
    );
    return edited.reduce((n: number, r: any) => n + Number(r?.cnt ?? 0), 0) > 0;
  }

  /** Mark a change undone when it was undone somewhere else (e.g. the review-fix panel's own Undo) */
  async markUndoneByRef(kind: ChangeKind, ref: string): Promise<void> {
    await databaseService.query(
      `UPDATE change_batches SET status = 'undone', undone_at = NOW(), undone_by = ? WHERE kind = ? AND ref = ? AND status = 'applied'`,
      [getRequestContext()?.userId ?? null, kind, ref],
    ).catch((err: any) => logger.warn('[ChangeHistory] markUndoneByRef failed', { kind, ref, error: err?.message }));
  }

  /**
   * Undo a change. Unless `force`, refuses (ChangeConflictError) when a task it touched
   * was edited afterwards — undoing would overwrite that later work.
   */
  async undo(scheduleId: string, changeId: string): Promise<{ summary: string; restored: number }> {
    const [row] = await databaseService.query<any>(
      `SELECT * FROM change_batches WHERE id = ? AND schedule_id = ?`, [changeId, scheduleId],
    );
    if (!row) throw new ChangeStateError('Change not found');
    if (row.status !== 'applied') throw new ChangeStateError('This change has already been undone');

    const taskIds = parseJson<string[]>(row.task_ids, []);
    // Only the newest change to this plan, and only if nothing in the plan changed since
    const [latest] = await databaseService.query<any>(
      `SELECT id FROM change_batches WHERE schedule_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`, [scheduleId],
    );
    if (!latest || latest.id !== changeId) throw new NotLatestChangeError();
    if (await this.planChangedSince(scheduleId, row.created_at)) throw new NotLatestChangeError();

    const payload = parseJson<any>(row.undo_payload, null);
    if (NEEDS_COPY.has(row.kind) && !payload) {
      throw new ChangeStateError('This change was too large to keep a copy of, so it can\'t be undone from History.');
    }
    const p = payload ?? {};
    // Bookings this change moved that nobody has changed since: put back exactly after the undo
    const bookingsBack = await untouchedBookingMoves((p.bookingMoves ?? []) as BookingMove[]);
    let restored = 0;
    switch (row.kind as ChangeKind) {
      case 'link': {
        const links = (p.links ?? []) as Array<{ taskId: string; dependencyId: string }>;
        if (links.length) restored += await scheduleService.bulkRemoveDependencies(scheduleId, links);
        const dates = (p.moved ?? []) as Array<{ taskId: string; startDate: string | null; endDate: string | null }>;
        if (dates.length) await restoreTaskDates(scheduleId, dates);
        break;
      }
      case 'bulk_update':
      case 'bulk_status': {
        const prev = (p.previous ?? []) as PreviousValues[];
        const allowed = new Set(Object.values(BULK_UPDATE_COLUMNS));
        // Summary tasks above the tasks put back (old and new parents) roll up afterwards
        const rollupIds = prev.filter(p => Object.keys(p.values).some(c => ROLLUP_COLUMNS.has(c))).map(p => p.id);
        const parents: string[] = [];
        // tasks a new predecessor pushed later go back first; the edited fields are then put back on top
        const pushed = (p.moved ?? []) as Array<{ taskId: string; startDate: string | null; endDate: string | null }>;
        if (pushed.length) await restoreTaskDates(scheduleId, pushed);
        await databaseService.transaction(async (conn) => {
          const run = (sql: string, params: any[]) => databaseService.queryOn(conn, sql, params);
          parents.push(...await parentIdsOf(run, scheduleId, rollupIds));
          const datesBefore = await taskDatesOf(run, prev.filter(p => 'start_date' in p.values || 'end_date' in p.values).map(p => p.id));
          for (const p of prev) {
            // eslint-disable-next-line no-restricted-syntax -- small: one changed task's own columns
            const cols = Object.keys(p.values).filter(c => allowed.has(c));
            if (!cols.length) continue;
            // eslint-disable-next-line no-await-in-loop -- undo of a bulk edit inside one transaction on one connection
            await databaseService.queryOn(conn,
              `UPDATE tasks SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = NOW() WHERE id = ? AND schedule_id = ?`,
              [...cols.map(c => p.values[c]), p.id, scheduleId]);
            restored++;
          }
          // booked hours move back with their tasks
          await moveBookingsWithTasks(run, datesBefore);
          await putLinksBack(run, scheduleId, (p.links ?? []) as LinksBefore);
          parents.push(...await parentIdsOf(run, scheduleId, rollupIds));
        });
        await rollUpSummaries(parents, scheduleId);
        break;
      }
      case 'bulk_create': {
        for (const id of (p.createdIds ?? []) as string[]) {
          // eslint-disable-next-line no-await-in-loop -- undo of a bulk create: each task delete cascades and may re-roll its summary, so they go one at a time
          if (await scheduleService.deleteTask(id).catch(() => false)) restored++;
        }
        break;
      }
      case 'review_fix':
      case 'reassign':
      case 'planner_move': {
        // The feature that made the change puts it back (registered at startup)
        const handler = undoHandlers.get(row.kind as ChangeKind);
        if (!handler) throw new ChangeStateError('This change can\'t be undone right now. Please try again in a minute.');
        restored = await handler(scheduleId, p, { ref: row.ref ?? null, userId: getRequestContext()?.userId ?? null });
        if (row.kind === 'review_fix') restored = taskIds.length;
        break;
      }
      case 'calendar':
      case 'ai_reschedule':
      case 'successors_moved': {
        const dates = (p.moved ?? []) as Array<{ taskId: string; startDate: string | null; endDate: string | null }>;
        restored = await restoreTaskDates(scheduleId, dates);
        // a re-date that also changed the task's predecessors: its old links back
        await putLinksBackNow(scheduleId, (p.links ?? []) as LinksBefore);
        break;
      }
      case 'group': {
        restored = await scheduleService.ungroupTasks(p.summaryId, p.previous ?? []);
        break;
      }
      case 'bulk_delete': {
        restored = await restoreDeletedTasks(scheduleId, p as DeleteSnapshot);
        break;
      }
      case 'import': {
        restored = await removeImported(scheduleId, p as ImportUndo, row.created_at);
        break;
      }
      default:
        throw new ChangeStateError(`Cannot undo a "${row.kind}" change`);
    }

    await putBookingsBack(bookingsBack, taskIds);

    const userId = getRequestContext()?.userId ?? null;
    await databaseService.query(
      `UPDATE change_batches SET status = 'undone', undone_at = NOW(), undone_by = ? WHERE id = ?`, [userId, changeId],
    );
    planChanged(scheduleId);
    auditLedgerService.append({
      actorId: userId ?? 'system',
      actorType: userId ? 'user' : 'system',
      action: 'change.undo',
      entityType: 'schedule',
      entityId: scheduleId,
      projectId: row.project_id,
      payload: { changeId, kind: row.kind, summary: row.summary, restored },
      source: getActorSource(),
    }).catch(err => logger.warn('[ChangeHistory] audit append failed', { changeId, error: err?.message }));
    return { summary: row.summary, restored };
  }
}

/** Undo's last step: the bookings back on their exact old dates (the undo's own re-follow is not a new change to remember) */
async function putBookingsBack(moves: BookingMove[], taskIds: string[]): Promise<void> {
  if (moves.length) {
    await writeBookingDates((sql, params) => databaseService.query(sql, params), moves.map(m => ({ id: m.id, start: m.start, end: m.end })));
  }
  takeBookingMoves(taskIds);
}

/** putLinksBack in a transaction of its own (nothing to do for no links) */
async function putLinksBackNow(scheduleId: string, links: LinksBefore): Promise<void> {
  if (links.length === 0) return;
  await databaseService.transaction(conn => putLinksBack((sql, params) => databaseService.queryOn(conn, sql, params), scheduleId, links));
}

/** The recorded booking moves whose bookings still have the dates the change gave them (none edited or removed since) */
async function untouchedBookingMoves(moves: BookingMove[]): Promise<BookingMove[]> {
  if (moves.length === 0) return [];
  const rows = await databaseService.query<any>(
    `SELECT id, DATE_FORMAT(start_date, '%Y-%m-%d') AS s, DATE_FORMAT(end_date, '%Y-%m-%d') AS e
       FROM resource_assignments WHERE id IN (${ph(moves.length)})`, moves.map(m => m.id));
  const now = new Map((Array.isArray(rows) ? rows : []).map((r: any) => [String(r.id), r]));
  return moves.filter(m => {
    const r = now.get(m.id);
    return !!r && r.s === m.newStart && r.e === m.newEnd;
  });
}

/** A task's links before a bulk edit set its predecessor (routes/core/bulk.ts keeps them) */
export type LinksBefore = Array<{ taskId: string; deps: Array<{ dependencyId: string; dependencyType: string; lagDays: number }> }>;

/** Undo of a bulk edit's predecessor: each task's links exactly as they were (tasks of this plan only) */
async function putLinksBack(run: Run, scheduleId: string, links: LinksBefore): Promise<void> {
  if (links.length === 0) return;
  const ids = links.map(l => l.taskId);
  const inPlan = new Set(((await run(
    `SELECT id FROM tasks WHERE schedule_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [scheduleId, ...ids])) as Array<{ id: string }>)
    .map(r => r.id));
  const mine = links.filter(l => inPlan.has(l.taskId));
  if (mine.length === 0) return;
  await run(`DELETE FROM task_dependencies WHERE task_id IN (${mine.map(() => '?').join(',')})`, mine.map(l => l.taskId));
  const rows = mine.flatMap(l => l.deps.map(d => [uuidv4(), l.taskId, d.dependencyId, d.dependencyType || 'FS', d.lagDays ?? 0]));
  if (rows.length) {
    await run(`INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`, rows.flat());
  }
  // the first link's copy on the task too (or none), so no screen still shows a removed predecessor
  await syncDependencyMirror(run, mine.map(l => l.taskId));
}

/** "12 Oct" from 'YYYY-MM-DD' */
function shortDay(v: unknown): string {
  if (!v) return '—';
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00Z');
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const FIELD_LABELS: Record<string, string> = {
  start_date: 'start', end_date: 'finish', name: 'name', status: 'status', priority: 'priority', assigned_to: 'assigned to',
  progress_percentage: 'progress', estimated_days: 'duration', is_milestone: 'milestone', parent_task_id: 'group',
  dependency: 'link', dependency_type: 'link type', comments: 'notes', sort_order: 'row',
};
const MAX_LINES = 20;

/**
 * What a change did, before -> after, in plain words. Read right after the change is applied,
 * so "after" is the task as it now stands. Best effort: never blocks the change being recorded.
 */
async function describeChange(input: RecordInput): Promise<string[]> {
  const undo: any = input.undo ?? {};
  const ids = [...new Set(input.taskIds)];
  if (ids.length === 0) return [];
  const rows = await databaseService.query<any>(
    `SELECT id, name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
            status, priority, assigned_to, progress_percentage, estimated_days, is_milestone, parent_task_id,
            dependency, dependency_type, comments, sort_order
       FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`, ids,
  );
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  const nameOf = (id: string) => byId.get(id)?.name ?? 'a task';
  const lines: string[] = [];
  /** Totals that must survive the line limit ("3 links removed with them") */
  const tail: string[] = [];
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // Plain words, not system codes: "In progress → Done", "High", "Yes", "40%"
  const show = (col: string, v: unknown): string => {
    if (col === 'start_date' || col === 'end_date') return shortDay(v);
    if (v == null || v === '') return '—';
    if (col === 'status') return TASK_STATUS_LABEL[String(v)] ?? String(v);
    if (col === 'priority') return String(v).charAt(0).toUpperCase() + String(v).slice(1);
    if (col === 'is_milestone') return Number(v) ? 'Yes' : 'No';
    if (col === 'progress_percentage') return `${v}%`;
    return String(v);
  };
  const moved = (list: Array<{ taskId: string; startDate: string | null; endDate: string | null }>) => {
    for (const m of list) {
      const now = byId.get(m.taskId); if (!now) continue;
      const parts: string[] = [];
      if ((m.startDate ?? null) !== (now.start_date ?? null)) parts.push(`start ${shortDay(m.startDate)} → ${shortDay(now.start_date)}`);
      if ((m.endDate ?? null) !== (now.end_date ?? null)) parts.push(`finish ${shortDay(m.endDate)} → ${shortDay(now.end_date)}`);
      if (parts.length) lines.push(`${now.name}: ${parts.join(', ')}`);
    }
  };
  switch (input.kind) {
    case 'link':
      for (const l of (undo.links ?? []) as Array<{ taskId: string; dependencyId: string }>) lines.push(`Linked ${nameOf(l.dependencyId)} → ${nameOf(l.taskId)}`);
      moved(undo.moved ?? []);
      break;
    case 'calendar':
    case 'ai_reschedule':
    case 'successors_moved':
      moved(undo.moved ?? []);
      break;
    case 'bulk_update':
    case 'bulk_status': {
      const datesShown = new Set<string>();
      for (const prev of (undo.previous ?? []) as PreviousValues[]) {
        const now = byId.get(prev.id); if (!now) continue;
        if ('start_date' in prev.values || 'end_date' in prev.values) datesShown.add(prev.id);
        // eslint-disable-next-line no-restricted-syntax -- small: one changed task's own columns
        const parts = Object.entries(prev.values)
          .filter(([c, v]) => String(v ?? '') !== String(now[c] ?? ''))
          .map(([c, v]) => `${FIELD_LABELS[c] ?? c} ${show(c, v)} → ${show(c, now[c])}`);
        if (parts.length) lines.push(`${now.name}: ${parts.join(', ')}`);
      }
      // tasks a new predecessor pushed later (their edited dates are already shown above)
      moved(((undo.moved ?? []) as Array<{ taskId: string; startDate: string | null; endDate: string | null }>).filter(m => !datesShown.has(m.taskId)));
      break;
    }
    case 'bulk_create':
      for (const id of (undo.createdIds ?? ids) as string[]) lines.push(`Added ${nameOf(id)}`);
      break;
    case 'group': {
      const summary = undo.summaryId ? nameOf(undo.summaryId) : 'a new group';
      const grouped = ids.filter(x => x !== undo.summaryId); // once, before the loop
      for (const id of grouped) lines.push(`${nameOf(id)} → grouped under ${summary}`);
      break;
    }
    case 'review_fix': {
      if (!Array.isArray(undo.fixes)) {
        // recorded before 2026-10-01: only the tasks were kept
        for (const id of ids) lines.push(`Changed by a Schedule Review fix: ${nameOf(id)}`);
        break;
      }
      for (const f of undo.fixes as string[]) lines.push(`Applied: ${f}`);
      const added = new Set<string>(undo.added ?? []);
      for (const id of added) if (byId.has(id)) lines.push(`Added ${nameOf(id)}`);
      moved(((undo.moved ?? []) as Array<{ taskId: string; startDate: string | null; endDate: string | null }>).filter(m => !added.has(m.taskId)));
      break;
    }
    case 'reassign': {
      const people = await databaseService.query<any>(
        'SELECT id, name FROM resources WHERE id IN (?, ?)', [undo.fromId ?? '', undo.toId ?? '']);
      const who = (id: string) => people.find((p: any) => p.id === id)?.name ?? 'someone';
      for (const id of ids) lines.push(`${nameOf(id)}: ${who(undo.fromId)} → ${who(undo.toId)}`);
      break;
    }
    case 'bulk_delete': {
      // The tasks are gone: the words come from the copy taken before the delete
      for (const t of (undo.tasks ?? []) as Array<Record<string, any>>) {
        const s = t.start_date ? String(t.start_date).slice(0, 10) : null;
        const e = t.end_date ? String(t.end_date).slice(0, 10) : null;
        lines.push(s || e ? `Deleted ${t.name} (${shortDay(s)} → ${shortDay(e)})` : `Deleted ${t.name}`);
      }
      const parts = [
        (undo.links ?? []).length ? count(undo.links.length, 'link') : '',
        (undo.bookings ?? []).length ? count(undo.bookings.length, 'booking') : '',
        (undo.comments ?? []).length ? count(undo.comments.length, 'comment') : '',
      ].filter(Boolean);
      if (parts.length) tail.push(`${parts.join(', ')} removed with them`);
      break;
    }
    case 'import': {
      for (const id of (undo.createdIds ?? ids) as string[]) lines.push(`Added ${nameOf(id)}`);
      if (Number(undo.links) > 0) tail.push(`Added ${count(Number(undo.links), 'link')}`);
      const created = (undo.resourceIds ?? []) as string[];
      if (created.length) {
        const people = await databaseService.query<any>(
          `SELECT id, name FROM resources WHERE id IN (${created.map(() => '?').join(',')})`, created);
        for (const p of people) tail.push(`Added person ${p.name}`);
      }
      if (undo.baselineId) tail.push("Saved baseline 'Imported baseline'");
      break;
    }
    case 'planner_move': {
      const r = undo.reassign;
      if (r) {
        const people = await databaseService.query<any>(
          'SELECT id, name FROM resources WHERE id IN (?, ?)', [r.fromId ?? '', r.toId ?? '']);
        const who = (id: string | null) => (id ? people.find((p: any) => p.id === id)?.name ?? 'someone' : 'no one');
        lines.push(`${nameOf(ids[0])}: ${who(r.fromId)} → ${who(r.toId)}`);
      }
      moved(undo.moved ?? []);
      break;
    }
  }
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `…and ${lines.length - MAX_LINES} more`] : lines;
  return [...shown, ...tail];
}

export const changeHistoryService = new ChangeHistoryService();
