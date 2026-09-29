import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import { scheduleService } from './ScheduleService';
import { restoreTaskDates } from './ScheduleRecomputeService';
import { auditLedgerService } from './AuditLedgerService';
import { queueReviewRerun } from './scheduleReview/autoRerun';
import logger from '../utils/logger';

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
 * Bulk delete and import are not covered yet.
 */

export type ChangeKind = 'link' | 'bulk_update' | 'bulk_status' | 'bulk_create' | 'review_fix' | 'ai_reschedule' | 'group' | 'calendar';

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
}

export class ChangeConflictError extends Error {
  constructor(public editedCount: number) { super(`${editedCount} task(s) were edited after this change`); }
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
      await databaseService.query(
        `INSERT INTO change_batches (id, project_id, schedule_id, kind, summary, actor_id, source, ref, task_ids, undo_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.projectId, input.scheduleId, input.kind, input.summary.slice(0, 500), ctx?.userId ?? null,
          getActorSource(), input.ref ?? null, JSON.stringify([...new Set(input.taskIds)]), JSON.stringify(input.undo ?? null)],
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
      `SELECT id, kind, summary, actor_id, source, status, undone_at, undone_by, created_at
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
    return rows.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      summary: r.summary,
      actorId: r.actor_id,
      actorName: r.actor_id ? names.get(r.actor_id) ?? null : null,
      source: r.source,
      status: r.status,
      undoable: r.status === 'applied',
      createdAt: iso(r.created_at)!,
      undoneAt: iso(r.undone_at),
      undoneByName: r.undone_by ? names.get(r.undone_by) ?? null : null,
    }));
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
  async undo(scheduleId: string, changeId: string, opts: { force?: boolean } = {}): Promise<{ summary: string; restored: number }> {
    const [row] = await databaseService.query<any>(
      `SELECT * FROM change_batches WHERE id = ? AND schedule_id = ?`, [changeId, scheduleId],
    );
    if (!row) throw new ChangeStateError('Change not found');
    if (row.status !== 'applied') throw new ChangeStateError('This change has already been undone');

    const taskIds = parseJson<string[]>(row.task_ids, []);
    if (!opts.force && taskIds.length > 0) {
      // A few seconds' grace: the change's own follow-up writes (parent rollups) land just after it
      const edited = await databaseService.query<any>(
        `SELECT COUNT(*) AS cnt FROM tasks
         WHERE id IN (${taskIds.map(() => '?').join(',')}) AND updated_at > DATE_ADD(?, INTERVAL 5 SECOND)`,
        [...taskIds, row.created_at],
      );
      const n = Number(edited[0]?.cnt ?? 0);
      if (n > 0) throw new ChangeConflictError(n);
    }

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
      payload: { changeId, kind: row.kind, summary: row.summary, restored, forced: !!opts.force },
      source: getActorSource(),
    }).catch(err => logger.warn('[ChangeHistory] audit append failed', { changeId, error: err?.message }));
    return { summary: row.summary, restored };
  }
}

export const changeHistoryService = new ChangeHistoryService();
