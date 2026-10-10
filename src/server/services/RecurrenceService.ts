import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { type IsWorking, weekdaysOnly, onOrAfterWorking, shiftWorking, finishFor, utcDay, ymdOf, mondayOf, calendarDaysBetween } from '../utils/workingDays';
import { chunksOf } from '../utils/chunksOf';
import { planChanged } from './domainEvents';
import logger from '../utils/logger';

interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  byDay?: string[];       // MO, TU, WE, TH, FR, SA, SU
  byMonthDay?: number;    // 1-31
}

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRecurrenceRule(rule: string): ParsedRule | null {
  if (!rule) return null;
  const parts = rule.split(';');
  const map: Record<string, string> = {};
  for (const part of parts) {
    const [key, val] = part.split('=');
    if (key && val) map[key.trim()] = val.trim();
  }
  const freq = map.FREQ as ParsedRule['freq'];
  if (!freq || !['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'].includes(freq)) return null;

  return {
    freq,
    byDay: map.BYDAY ? map.BYDAY.split(',').map(d => d.trim()) : undefined,
    byMonthDay: map.BYMONTHDAY ? parseInt(map.BYMONTHDAY, 10) : undefined,
  };
}

/** d plus n calendar days, as a UTC-midnight Date (recurrence patterns step by the calendar) */
function addCalendarDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

/** Whole weeks (Monday to Sunday) from the week holding `from` to the week holding `to` */
function weeksBetween(from: Date, to: Date): number {
  return calendarDaysBetween(mondayOf(ymdOf(from)), mondayOf(ymdOf(to))) / 7;
}

/**
 * The next date the rule's pattern falls on after `lastDate` (a UTC-midnight day).
 * DAILY steps to the next WORKING day when `isWorking` is given; the other patterns
 * return the pattern's own date, which may be a day off — `instanceDate` moves it.
 *
 * `anchor` is where the pattern started (the template's start; defaults to `lastDate`):
 * BIWEEKLY with chosen days repeats in the anchor's week and every other week after it, and
 * MONTHLY keeps the anchor's day of the month — 31 Jan gives 28 Feb, then 31 Mar (the clamp
 * to a short month is never carried forward). Audit 2026-10-09: biweekly repeated every week,
 * and monthly drifted to the 28th after February.
 */
export function getNextOccurrence(rule: ParsedRule, lastDate: Date, isWorking?: IsWorking, anchor: Date = lastDate): Date {
  const last = utcDay(lastDate);
  const start = utcDay(anchor);

  switch (rule.freq) {
    case 'DAILY':
      return isWorking ? shiftWorking(last, 1, isWorking) : addCalendarDays(last, 1);

    case 'WEEKLY':
    case 'BIWEEKLY': {
      const biweekly = rule.freq === 'BIWEEKLY';
      const increment = biweekly ? 14 : 7;
      if (rule.byDay && rule.byDay.length > 0) {
        // The next chosen weekday — for biweekly, only in the anchor's week or every other week
        // after it (UTC throughout: dates are calendar days). 20 days reach any day of the next "on" week.
        for (let i = 1; i <= 20; i++) {
          const candidate = addCalendarDays(last, i);
          if (!rule.byDay.includes(DAY_NAMES[candidate.getUTCDay()])) continue;
          if (biweekly && weeksBetween(start, candidate) % 2 !== 0) continue;
          return candidate;
        }
      }
      return addCalendarDays(last, increment);
    }

    case 'MONTHLY': {
      const y = last.getUTCFullYear();
      const m = last.getUTCMonth() + 1;
      const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const day = Math.min(rule.byMonthDay ?? start.getUTCDate(), daysInMonth);
      return new Date(Date.UTC(y, m, day));
    }
  }
  return addCalendarDays(last, 1);
}

/** The day an occurrence is scheduled: its pattern date, or the next working day if that is a day off */
export function instanceDate(patternDate: Date, isWorking: IsWorking): Date {
  return onOrAfterWorking(patternDate, isWorking);
}

function formatDate(d: Date): string {
  return ymdOf(d);
}

export class RecurrenceService {
  /**
   * Generate recurring task instances for all templates.
   * Called daily by the agent scheduler.
   */
  async generateInstances(horizonDays = 14): Promise<number> {
    // Find all active recurrence templates
    const templates = await databaseService.query(
      `SELECT * FROM tasks WHERE is_recurrence_template = 1 AND status != 'cancelled'`
    );

    let created = 0;
    const horizon = addCalendarDays(utcDay(new Date()), horizonDays);

    for (const tpl of templates) {
      const rule = parseRecurrenceRule(tpl.recurrence_rule);
      if (!rule) continue;
      // eslint-disable-next-line no-await-in-loop -- each template on its own plan's calendar; a few reads per template, not per date
      created += await this.expand(tpl, rule, horizon, Infinity);
    }

    return created;
  }

  /**
   * On-demand expansion for a specific template task.
   * Called from the API when a user creates/updates a recurring template.
   */
  async expandTemplate(templateTaskId: string, horizonDays = 90): Promise<number> {
    const templates = await databaseService.query(
      `SELECT * FROM tasks WHERE id = ? AND is_recurrence_template = 1`,
      [templateTaskId]
    );
    if (templates.length === 0) return 0;
    const tpl = templates[0];

    const rule = parseRecurrenceRule(tpl.recurrence_rule);
    if (!rule) return 0;

    return this.expand(tpl, rule, addCalendarDays(utcDay(new Date()), horizonDays), 100);
  }

  /**
   * Create the template's missing instances up to `horizon`. Instances land on WORKING
   * days of the project calendar: DAILY skips days off, and a weekly/monthly date that
   * falls on a day off moves to the next working day (never two on one day). Each
   * instance finishes after its duration in working days, the start day counted.
   *
   * The pattern is walked from the template's own start so a moved instance does not
   * drag later ones with it ("every Monday" stays on Mondays after a holiday Monday).
   */
  private async expand(tpl: any, rule: ParsedRule, horizon: Date, max: number): Promise<number> {
    const isWorking = await this.workingDayTest(tpl.schedule_id);

    // Find the latest instance created from this template
    const instances = await databaseService.query(
      `SELECT start_date FROM tasks WHERE recurrence_parent_id = ? ORDER BY start_date DESC LIMIT 1`,
      [tpl.id]
    );
    const latest = instances.length > 0 && instances[0].start_date ? utcDay(instances[0].start_date) : null;
    const anchor = tpl.start_date ? utcDay(tpl.start_date) : (latest ?? utcDay(new Date()));

    // The dates due (each working day once), then: one read of those already made, one read of the
    // next free position, one INSERT per 200 — it was a read and an INSERT per date (2026-10-09)
    const due: Array<{ day: Date; ymd: string }> = [];
    const used = new Set<string>();
    let next = getNextOccurrence(rule, anchor, isWorking, anchor);
    for (let guard = 0; next <= horizon && due.length < max && guard < 20000; guard++) {
      const day = instanceDate(next, isWorking);
      const ymd = formatDate(day);
      if ((!latest || day > latest) && !used.has(ymd)) {
        used.add(ymd);
        due.push({ day, ymd });
      }
      next = getNextOccurrence(rule, next, isWorking, anchor);
    }
    if (due.length === 0) return 0;

    const made = new Set<string>();
    for (const part of chunksOf(due, 500)) {
      // eslint-disable-next-line no-await-in-loop -- one read per 500 dates
      const rows = await databaseService.query(
        `SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS d FROM tasks WHERE recurrence_parent_id = ? AND start_date IN (${part.map(() => '?').join(',')})`,
        [tpl.id, ...part.map(x => x.ymd)],
      );
      for (const r of rows) made.add(r.d);
    }
    const toMake = due.filter(x => !made.has(x.ymd)).slice(0, max === Infinity ? undefined : max);
    if (toMake.length === 0) return 0;

    const orderRows = await databaseService.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tasks WHERE schedule_id = ?',
      [tpl.schedule_id],
    );
    const firstOrder = Number(orderRows[0]?.next_order ?? 0);
    const duration = tpl.estimated_days || 1;
    const rows = toMake.map((x, i) => [
      uuidv4(), tpl.schedule_id, tpl.name, tpl.description || null, tpl.priority || 'medium', tpl.assigned_to || null,
      tpl.estimated_days || null, x.ymd, formatDate(finishFor(x.day, duration, isWorking)),
      tpl.parent_task_id || null, tpl.id, tpl.created_by, firstOrder + i,
    ]);
    for (const part of chunksOf(rows, 200)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 instances, positions in date order
      await databaseService.query(
        `INSERT INTO tasks (id, schedule_id, name, description, status, priority, assigned_to,
          estimated_days, start_date, end_date, progress_percentage, parent_task_id,
          recurrence_parent_id, is_recurrence_template, created_by, sort_order)
         VALUES ${part.map(() => "(?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?)").join(', ')}`,
        part.flat(),
      );
    }
    const created = toMake.length;
    // The new instances sit under the template's summary task: it rolls up (dates, %, totals), and
    // open screens and plan watchers hear the plan changed (audit 2026-10-09: neither happened)
    await this.afterInstancesChanged(tpl.schedule_id, tpl.parent_task_id, isWorking);

    return created;
  }

  /** The summary task above a template's instances rolls up; the plan-changed notice goes out */
  private async afterInstancesChanged(scheduleId: string, parentTaskId: string | null | undefined, isWorking?: IsWorking): Promise<void> {
    if (parentTaskId) {
      const { scheduleService } = await import('./ScheduleService');
      await scheduleService.recomputeParentRollup(parentTaskId, 0, { isWorking }).catch((err: any) =>
        logger.warn('[Recurrence] roll-up after instances changed failed', { parentTaskId, error: err?.message }));
    }
    planChanged(scheduleId);
  }

  /** The schedule's project calendar; Mon–Fri when it cannot be read */
  private async workingDayTest(scheduleId: string): Promise<IsWorking> {
    try {
      const { scheduleService } = await import('./ScheduleService');
      return (await scheduleService.workingDayTest(scheduleId)) ?? weekdaysOnly;
    } catch {
      return weekdaysOnly;
    }
  }

  /**
   * Delete all instances created from a template.
   */
  async deleteChildren(templateTaskId: string): Promise<number> {
    const [tpl] = await databaseService.query(`SELECT schedule_id, parent_task_id FROM tasks WHERE id = ?`, [templateTaskId]);
    const result: any = await databaseService.query(
      `DELETE FROM tasks WHERE recurrence_parent_id = ?`,
      [templateTaskId]
    );
    const removed = result?.affectedRows ?? 0;
    if (removed > 0 && tpl) await this.afterInstancesChanged(tpl.schedule_id, tpl.parent_task_id);
    return removed;
  }
}

export const recurrenceService = new RecurrenceService();
