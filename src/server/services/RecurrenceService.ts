import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { type IsWorking, weekdaysOnly, onOrAfterWorking, shiftWorking, finishFor, utcDay, ymdOf } from '../utils/workingDays';

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

/**
 * The next date the rule's pattern falls on after `lastDate` (a UTC-midnight day).
 * DAILY steps to the next WORKING day when `isWorking` is given; the other patterns
 * return the pattern's own date, which may be a day off — `instanceDate` moves it.
 */
export function getNextOccurrence(rule: ParsedRule, lastDate: Date, isWorking?: IsWorking): Date {
  const last = utcDay(lastDate);

  switch (rule.freq) {
    case 'DAILY':
      return isWorking ? shiftWorking(last, 1, isWorking) : addCalendarDays(last, 1);

    case 'WEEKLY':
    case 'BIWEEKLY': {
      const increment = rule.freq === 'BIWEEKLY' ? 14 : 7;
      if (rule.byDay && rule.byDay.length > 0) {
        // Find the next matching day (UTC throughout: dates are calendar days)
        for (let i = 1; i <= increment; i++) {
          const candidate = addCalendarDays(last, i);
          if (rule.byDay.includes(DAY_NAMES[candidate.getUTCDay()])) return candidate;
        }
      }
      return addCalendarDays(last, increment);
    }

    case 'MONTHLY': {
      const y = last.getUTCFullYear();
      const m = last.getUTCMonth() + 1;
      const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const day = Math.min(rule.byMonthDay ?? last.getUTCDate(), daysInMonth);
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

    let created = 0;
    const used = new Set<string>();
    let next = getNextOccurrence(rule, anchor, isWorking);
    for (let guard = 0; next <= horizon && created < max && guard < 20000; guard++) {
      const day = instanceDate(next, isWorking);
      const ymd = formatDate(day);
      if ((!latest || day > latest) && !used.has(ymd)) {
        used.add(ymd);
        // Check if instance already exists for this date
        const existing = await databaseService.query(
          `SELECT id FROM tasks WHERE recurrence_parent_id = ? AND start_date = ?`,
          [tpl.id, ymd]
        );

        if (existing.length === 0) {
          const id = uuidv4();
          const duration = tpl.estimated_days || 1;
          const endDate = finishFor(day, duration, isWorking);

          await databaseService.query(
            `INSERT INTO tasks (id, schedule_id, name, description, status, priority, assigned_to,
              estimated_days, start_date, end_date, progress_percentage, parent_task_id,
              recurrence_parent_id, is_recurrence_template, sort_order, created_by)
             SELECT ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?, ?, 0, COALESCE(MAX(sort_order), -1) + 1, ? FROM tasks WHERE schedule_id = ?`,
            [
              id,
              tpl.schedule_id,
              tpl.name,
              tpl.description || null,
              tpl.priority || 'medium',
              tpl.assigned_to || null,
              tpl.estimated_days || null,
              ymd,
              formatDate(endDate),
              tpl.parent_task_id || null,
              tpl.id,
              tpl.created_by,
              tpl.schedule_id, // next free position in the schedule
            ]
          );
          created++;
        }
      }

      next = getNextOccurrence(rule, next, isWorking);
    }

    return created;
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
    const result: any = await databaseService.query(
      `DELETE FROM tasks WHERE recurrence_parent_id = ?`,
      [templateTaskId]
    );
    return result?.affectedRows ?? 0;
  }
}

export const recurrenceService = new RecurrenceService();
