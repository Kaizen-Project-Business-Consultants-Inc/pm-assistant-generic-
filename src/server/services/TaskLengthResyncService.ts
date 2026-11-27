import { databaseService } from '../database/connection';
import { scheduleService } from './ScheduleService';
import { taskWorkingDuration, utcDay, ymdOf, finishFor } from '../utils/workingDays';
import { chunksOf } from '../utils/chunksOf';

interface ResyncResult { checked: number; changed: number; examples: string[]; log: string[] }

type Calendars = Map<string, Awaited<ReturnType<typeof scheduleService.workingDayTest>>>;
const calendarFor = async (calendars: Calendars, scheduleId: string) => {
  if (!calendars.has(scheduleId)) calendars.set(scheduleId, await scheduleService.workingDayTest(scheduleId));
  return calendars.get(scheduleId)!;
};

const SPAN_FIELDS = `id, schedule_id, parent_task_id, start_date, end_date, estimated_days, name FROM tasks
     WHERE COALESCE(is_summary, 0) = 0 AND COALESCE(is_milestone, 0) = 0`;

interface Row { id: string; schedule_id: string; parent_task_id: string | null; start_date: string; end_date: string; estimated_days: number | null; name: string }

async function writeLengths(fixes: Array<{ id: string; days: number }>) {
  for (const chunk of chunksOf(fixes, 200)) {
    // eslint-disable-next-line no-await-in-loop -- one statement per 200 tasks
    await databaseService.query(
      `UPDATE tasks SET estimated_days = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (${chunk.map(() => '?').join(',')})`,
      [...chunk.flatMap(f => [f.id, f.days]), ...chunk.map(f => f.id)],
    );
  }
}

/** A heading's % is weighted by its tasks' lengths: redo each heading above a changed task (it climbs upward itself) */
async function refreshHeadings(changed: Row[], calendars: Calendars) {
  const bySchedule = new Map<string, Set<string>>();
  for (const r of changed) {
    if (!r.parent_task_id) continue;
    if (!bySchedule.has(r.schedule_id)) bySchedule.set(r.schedule_id, new Set());
    bySchedule.get(r.schedule_id)!.add(r.parent_task_id);
  }
  for (const [scheduleId, parents] of bySchedule) {
    // eslint-disable-next-line no-await-in-loop -- one plan at a time: each reads its own calendar
    const isWorking = await calendarFor(calendars, scheduleId);
    for (const p of parents) {
      // eslint-disable-next-line no-await-in-loop -- headings one after another (nested ones settle in order)
      await scheduleService.recomputeParentRollup(p, 0, { isWorking });
    }
  }
}

/**
 * One-time fix (2026-11-27, "one Duration"): a task's stored length is set to the working days its
 * own dates cover, using its project's calendar. Before this, changing the dates left the stored
 * number behind, so Duration and Est Days disagreed. Headings, milestones and tasks without both
 * dates are left alone (archived projects and scenario copies are included); saved baselines are not
 * touched. Headings above a changed task get their % redone (it is weighted by length). Run inside a
 * company (runWithTenantContext). `dryRun` only counts. `log` lists every changed task with its old value.
 */
export async function resyncTaskLengths(dryRun = false): Promise<ResyncResult> {
  const rows = await databaseService.query<Row>(`SELECT ${SPAN_FIELDS} AND start_date IS NOT NULL AND end_date IS NOT NULL`);
  const calendars: Calendars = new Map();
  const fixes: Array<{ id: string; days: number }> = [];
  const changedRows: Row[] = [];
  const examples: string[] = [];
  const log: string[] = [];
  for (const r of rows) {
    const days = taskWorkingDuration({ startDate: r.start_date, endDate: r.end_date, estimatedDays: r.estimated_days }, await calendarFor(calendars, r.schedule_id)); // eslint-disable-line no-await-in-loop -- once per plan, cached
    if (days > 0 && Number(r.estimated_days) !== days) {
      fixes.push({ id: r.id, days });
      changedRows.push(r);
      log.push(`${r.id}\t${r.estimated_days ?? ''}\t${days}`);
      if (examples.length < 5) examples.push(`${r.name}: ${r.estimated_days ?? '-'} -> ${days}`);
    }
  }
  if (!dryRun) {
    await writeLengths(fixes);
    await refreshHeadings(changedRows, calendars);
  }
  return { checked: rows.length, changed: fixes.length, examples, log };
}

/**
 * After a bulk edit (PUT /bulk/tasks) writes dates and lengths straight to the rows: dates sent without
 * a length -> the length follows the dates; a length sent without dates -> End moves to fit (same rule
 * as ScheduleService.updateTask). Headings and milestones are left alone.
 */
export async function syncLengthsAfterBulk(edits: Array<{ id: string; datesSent: boolean; lengthSent: boolean }>): Promise<void> {
  const wanted = new Map(edits.filter(e => e.datesSent !== e.lengthSent).map(e => [e.id, e]));
  if (wanted.size === 0) return;
  const calendars: Calendars = new Map();
  const changed: Row[] = [];
  for (const chunk of chunksOf([...wanted.keys()], 200)) {
    // eslint-disable-next-line no-await-in-loop -- one read per 200 tasks
    const rows = await databaseService.query<Row>(`SELECT ${SPAN_FIELDS} AND id IN (${chunk.map(() => '?').join(',')})`, chunk);
    const lengths: Array<{ id: string; days: number }> = [];
    for (const r of rows) {
      const isWorking = await calendarFor(calendars, r.schedule_id); // eslint-disable-line no-await-in-loop -- once per plan, cached
      if (wanted.get(r.id)!.datesSent) {
        if (r.start_date && r.end_date) {
          const days = taskWorkingDuration({ startDate: r.start_date, endDate: r.end_date, estimatedDays: r.estimated_days }, isWorking);
          if (days > 0 && Number(r.estimated_days) !== days) { lengths.push({ id: r.id, days }); changed.push(r); }
        }
      } else if (r.start_date && Number(r.estimated_days) > 0) {
        const end = ymdOf(finishFor(utcDay(r.start_date), Number(r.estimated_days), isWorking));
        // eslint-disable-next-line no-await-in-loop -- only the rare "length without dates" edits
        await databaseService.query('UPDATE tasks SET end_date = ? WHERE id = ?', [end, r.id]);
        changed.push(r);
      }
    }
    // eslint-disable-next-line no-await-in-loop -- one write per 200 tasks
    await writeLengths(lengths);
  }
  await refreshHeadings(changed, calendars);
}
