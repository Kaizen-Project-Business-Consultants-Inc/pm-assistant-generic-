import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import { scheduleService } from './ScheduleService';
import { restoreTaskDates } from './ScheduleRecomputeService';
import { auditLedgerService } from './AuditLedgerService';
import { queueReviewRerun } from './scheduleReview/autoRerun';
import logger from '../utils/logger';
import { TASK_STATUS_LABEL } from '../constants/taskStatus';

/**
 * Schedule History — one line per GROUP change, with an Undo that works later (the
 * client's 4-second toast and Ctrl+Z stack are lost on reload, and never covered
 * changes Claude made through the MCP server).
 *
 * Covered kinds and how each is undone:
 *  - link          remove the links added, put re-flowed dates back
 *  - bulk_update   write back the previous values of the fields that changed
 *  - bulk_status   write back each task's previous status
 *  - bulk_create   delete the tasks that were created
 *  - review_fix    the Schedule Review proposal's own undo (ref = proposal id)
 *  - ai_reschedule put the dates back
 *  - group         tasks back to their old parent, the new summary removed
 *  - calendar      put the dates back (a working-calendar change, or the days-off clean-up;
 *                  the calendar itself stays as it is)
 *  - reassign      the old resource back on the tasks ("Replace Generic Developer with …")
 *  - planner_move  a Team Planner drop: the person back, the dates (and hours bookings) back
 * Bulk delete and import are not covered yet.
 *
 * Product owner, 2026-10-01: History is a RECORD. Each entry says what it did, before -> after.
 * Only the newest change to a plan can be undone, and only until anything else in the plan
 * changes — undoing an older change would rewind one thread of a connected plan while later work
 * built on it stays. There is no "undo anyway".
 */

export type ChangeKind = 'link' | 'bulk_update' | 'bulk_status' | 'bulk_create' | 'review_fix' | 'ai_reschedule' | 'group' | 'calendar' | 'reassign' | 'planner_move';

/** Columns bulk update may change — the only ones we read before and write back on undo */
export const BULK_UPDATE_COLUMNS: Record<string, string> = {
  name: 'name', startDate: 'start_date', endDate: 'end_date', estimatedDays: 'estimated_days',
  progressPercentage: 'progress_percentage', status: 'status', priority: 'priority', assignedTo: 'assigned_to',
  dependency: 'dependency', dependencyType: 'dependency_type', comments: 'comments', isMilestone: 'is_milestone',
  sortOrder: 'sort_order', parentTaskId: 'parent_task_id',
};
const DATE_COLUMNS = new Set(['start_date', 'end_date']);

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

class ChangeHistoryService {
  /**
   * Record a group change. Never throws: history must not break the change it records
   * (a missing line only means that one change can't be undone from History).
   */
  async record(input: RecordInput): Promise<string | null> {
    try {
      if (input.taskIds.length === 0) return null;
      const ctx = getRequestContext();
      const id = uuidv4();
      const details = await describeChange(input).catch(() => [] as string[]);
      await databaseService.query(
        `INSERT INTO change_batches (id, project_id, schedule_id, kind, summary, actor_id, source, ref, task_ids, undo_payload, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.projectId, input.scheduleId, input.kind, input.summary.slice(0, 500), ctx?.userId ?? null,
          getActorSource(), input.ref ?? null, JSON.stringify([...new Set(input.taskIds)]), JSON.stringify(input.undo ?? null),
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
      `SELECT id, kind, summary, actor_id, source, status, undone_at, undone_by, created_at, details
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
    const newestUndoable = !!newest && newest.status === 'applied' && !(await this.planChangedSince(scheduleId, newest.created_at));
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

  /** Has anything in the plan been edited since this moment? (a few seconds' grace for the change's own follow-up writes) */
  private async planChangedSince(scheduleId: string, createdAt: unknown): Promise<boolean> {
    const edited = await databaseService.query<any>(
      `SELECT COUNT(*) AS cnt FROM tasks WHERE schedule_id = ? AND updated_at > DATE_ADD(?, INTERVAL 5 SECOND)`,
      [scheduleId, createdAt],
    );
    return Number(edited[0]?.cnt ?? 0) > 0;
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

    const payload = parseJson<any>(row.undo_payload, {});
    let restored = 0;
    switch (row.kind as ChangeKind) {
      case 'link': {
        const links = (payload.links ?? []) as Array<{ taskId: string; dependencyId: string }>;
        if (links.length) restored += await scheduleService.bulkRemoveDependencies(scheduleId, links);
        const dates = (payload.moved ?? []) as Array<{ taskId: string; startDate: string | null; endDate: string | null }>;
        if (dates.length) await restoreTaskDates(scheduleId, dates);
        break;
      }
      case 'bulk_update':
      case 'bulk_status': {
        const prev = (payload.previous ?? []) as PreviousValues[];
        const allowed = new Set(Object.values(BULK_UPDATE_COLUMNS));
        await databaseService.transaction(async (conn) => {
          for (const p of prev) {
            const cols = Object.keys(p.values).filter(c => allowed.has(c));
            if (!cols.length) continue;
            await databaseService.queryOn(conn,
              `UPDATE tasks SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = NOW() WHERE id = ? AND schedule_id = ?`,
              [...cols.map(c => p.values[c]), p.id, scheduleId]);
            restored++;
          }
        });
        break;
      }
      case 'bulk_create': {
        for (const id of (payload.createdIds ?? []) as string[]) {
          if (await scheduleService.deleteTask(id).catch(() => false)) restored++;
        }
        break;
      }
      case 'review_fix': {
        // Lazy import: the proposer service pulls in the review engine
        const { scheduleFixProposerService } = await import('./ScheduleFixProposerService');
        await scheduleFixProposerService.undo(scheduleId, row.ref, getRequestContext()?.userId ?? null);
        restored = taskIds.length;
        break;
      }
      case 'calendar':
      case 'ai_reschedule': {
        const dates = (payload.moved ?? []) as Array<{ taskId: string; startDate: string | null; endDate: string | null }>;
        restored = await restoreTaskDates(scheduleId, dates);
        break;
      }
      case 'group': {
        restored = await scheduleService.ungroupTasks(payload.summaryId, payload.previous ?? []);
        break;
      }
      case 'reassign': {
        const { resourceReplaceService } = await import('./ResourceReplaceService');
        restored = await resourceReplaceService.undo(scheduleId, payload);
        break;
      }
      case 'planner_move': {
        const { teamPlannerService } = await import('./TeamPlannerService');
        restored = await teamPlannerService.undo(scheduleId, payload);
        break;
      }
      default:
        throw new ChangeStateError(`Cannot undo a "${row.kind}" change`);
    }

    const userId = getRequestContext()?.userId ?? null;
    await databaseService.query(
      `UPDATE change_batches SET status = 'undone', undone_at = NOW(), undone_by = ? WHERE id = ?`, [userId, changeId],
    );
    queueReviewRerun(scheduleId);
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
      moved(undo.moved ?? []);
      break;
    case 'bulk_update':
    case 'bulk_status':
      for (const prev of (undo.previous ?? []) as PreviousValues[]) {
        const now = byId.get(prev.id); if (!now) continue;
        const parts = Object.entries(prev.values)
          .filter(([c, v]) => String(v ?? '') !== String(now[c] ?? ''))
          .map(([c, v]) => `${FIELD_LABELS[c] ?? c} ${show(c, v)} → ${show(c, now[c])}`);
        if (parts.length) lines.push(`${now.name}: ${parts.join(', ')}`);
      }
      break;
    case 'bulk_create':
      for (const id of (undo.createdIds ?? ids) as string[]) lines.push(`Added ${nameOf(id)}`);
      break;
    case 'group': {
      const summary = undo.summaryId ? nameOf(undo.summaryId) : 'a new group';
      for (const id of ids.filter(x => x !== undo.summaryId)) lines.push(`${nameOf(id)} → grouped under ${summary}`);
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
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `…and ${lines.length - MAX_LINES} more`] : lines;
}

export const changeHistoryService = new ChangeHistoryService();
