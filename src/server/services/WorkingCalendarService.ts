import { databaseService } from '../database/connection';
import { HOME_CALENDAR, calendarService, CalendarService, type CalendarSpec, type CompanyHoliday } from './CalendarService';
import { scheduleService } from './ScheduleService';
import { scheduleRecomputeService, type DateDelta, type RescheduleReason } from './ScheduleRecomputeService';
import { changeHistoryService } from './ChangeHistoryService';
import { planChanged } from './domainEvents';
import type { IsWorking } from '../utils/workingDays';
import logger from '../utils/logger';

/**
 * The project working calendar as people use it: change the working weekdays, add or
 * remove a day off / an extra working day, or change the company holidays — see which
 * tasks move first (preview), then apply. Applying re-fits every plan in the affected
 * projects to the new calendar (tasks keep their working-day length; a task now on a
 * day off moves to the next working day; later tasks follow) and records one line per
 * plan in Schedule History, whose Undo puts the dates back.
 */

export type ProjectCalendarChange =
  | { workingDays: number[] }
  | { add: { date: string; type: 'holiday' | 'working'; name?: string } }
  | { removeId: string };

/** A change to one holiday calendar (U8: 'home' = Company holidays when calendarId is left out) */
export type CompanyHolidayChange =
  | { calendarId?: string; add: { date: string; name?: string } }
  | { calendarId?: string; removeId: string };

export interface CalendarMove extends DateDelta { projectId: string; scheduleId: string; scheduleName: string }

export interface CalendarPreview {
  moves: CalendarMove[];
  tasksMoved: number;
  projectsAffected: number;
  /** Latest finish over the affected plans, before and after (single project only) */
  finishBefore: string | null;
  finishAfter: string | null;
}

export class CalendarChangeError extends Error {}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function checker(spec: CalendarSpec): IsWorking {
  return d => CalendarService.isWorking(d.toISOString().slice(0, 10), spec);
}

function cloneSpec(s: CalendarSpec): CalendarSpec {
  return { workingDays: [...s.workingDays], holidays: new Set(s.holidays), working: new Set(s.working), company: new Set(s.company) };
}

function fmt(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${day} ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

export class WorkingCalendarService {
  async get(projectId: string) {
    const calendar = await calendarService.getOrCreateDefault(projectId);
    const exceptions = await calendarService.getExceptions(calendar.id);
    // the holidays of the project's client's calendar (U8)
    const calendarId = await calendarService.calendarIdForProject(projectId).catch(() => HOME_CALENDAR);
    const companyHolidays = await calendarService.listCompanyHolidays(calendarId).catch(() => [] as CompanyHoliday[]);
    return {
      workingDays: calendar.workingDays,
      exceptions: exceptions.map(e => ({ id: e.id, date: e.exceptionDate, type: e.type, name: e.name ?? '' })),
      companyHolidays,
    };
  }

  /** The project's calendar after a change, and a one-line description of the change */
  private async proposed(projectId: string, change: ProjectCalendarChange): Promise<{ before: CalendarSpec; after: CalendarSpec; label: string }> {
    const before = await calendarService.calendarSpec(projectId);
    const after = cloneSpec(before);
    let label: string;
    if ('workingDays' in change) {
      const days = [...new Set(change.workingDays)].filter(d => d >= 0 && d <= 6).sort();
      if (days.length === 0) throw new CalendarChangeError('Keep at least one working day in the week');
      after.workingDays = days;
      label = `Working days set to ${days.map(d => DAY_NAMES[d].slice(0, 3)).join(', ')}`;
    } else if ('add' in change) {
      const { date, type } = change.add;
      after.holidays.delete(date); after.working.delete(date);
      (type === 'holiday' ? after.holidays : after.working).add(date);
      label = `${type === 'holiday' ? 'Day off' : 'Working day'} added: ${fmt(date)}${change.add.name ? ` (${change.add.name})` : ''}`;
    } else {
      const cal = await calendarService.getOrCreateDefault(projectId);
      const ex = (await calendarService.getExceptions(cal.id)).find(e => e.id === change.removeId);
      if (!ex) throw new CalendarChangeError('That date is no longer in the calendar — refresh and try again');
      (ex.type === 'holiday' ? after.holidays : after.working).delete(ex.exceptionDate);
      label = `${ex.type === 'holiday' ? 'Day off' : 'Working day'} removed: ${fmt(ex.exceptionDate)}`;
    }
    return { before, after, label };
  }

  /** Re-fit every plan in the project; dry run for a preview */
  private async refit(projectId: string, wasWorking: IsWorking, isWorking: IsWorking, opts: { dryRun: boolean; reason: RescheduleReason; label: string }): Promise<CalendarMove[]> {
    const schedules = (await scheduleService.findByProjectId(projectId)).filter((s: any) => !s.isScenario);
    const moves: CalendarMove[] = [];
    for (const sch of schedules) {
      // eslint-disable-next-line no-await-in-loop -- a project has a handful of plans; each re-flow rewrites many task dates, so plans go one at a time
      const res = await scheduleRecomputeService.recompute(sch.id, {
        respan: true, dryRun: opts.dryRun, reason: opts.reason, calendar: { isWorking, wasWorking },
      });
      moves.push(...res.deltas.map(d => ({ ...d, projectId, scheduleId: sch.id, scheduleName: sch.name })));
      if (!opts.dryRun && res.deltas.length > 0) {
        // eslint-disable-next-line no-await-in-loop -- history entry for the plan just re-flowed; one per plan, after its re-flow
        await changeHistoryService.record({
          projectId, scheduleId: sch.id, kind: 'calendar',
          summary: `${opts.label} — moved ${res.deltas.length} task${res.deltas.length === 1 ? '' : 's'}`,
          taskIds: res.deltas.map(d => d.taskId),
          undo: { moved: res.deltas.map(d => ({ taskId: d.taskId, startDate: d.oldStart, endDate: d.oldEnd })) },
        });
        planChanged(sch.id);
      }
    }
    return moves;
  }

  private summarise(moves: CalendarMove[], projects: number): CalendarPreview {
    const ends = (key: 'oldEnd' | 'newEnd') => moves.map(m => m[key]).filter((x): x is string => !!x).sort();
    return {
      moves,
      tasksMoved: moves.length,
      projectsAffected: projects,
      finishBefore: ends('oldEnd').pop() ?? null,
      finishAfter: ends('newEnd').pop() ?? null,
    };
  }

  async previewProjectChange(projectId: string, change: ProjectCalendarChange): Promise<CalendarPreview> {
    const { before, after, label } = await this.proposed(projectId, change);
    const moves = await this.refit(projectId, checker(before), checker(after), { dryRun: true, reason: 'calendar_change', label });
    return this.summarise(moves, moves.length ? 1 : 0);
  }

  async applyProjectChange(projectId: string, change: ProjectCalendarChange): Promise<CalendarPreview> {
    const { before, after, label } = await this.proposed(projectId, change);
    const cal = await calendarService.getOrCreateDefault(projectId);
    if ('workingDays' in change) await calendarService.update(cal.id, { workingDays: after.workingDays });
    else if ('add' in change) await calendarService.addException(cal.id, change.add.date, change.add.type, change.add.name);
    else await calendarService.removeException(change.removeId);
    const moves = await this.refit(projectId, checker(before), checker(after), { dryRun: false, reason: 'calendar_change', label });
    return this.summarise(moves, moves.length ? 1 : 0);
  }

  /** Active projects that use a holiday calendar (their client's, or the home one) */
  private async activeProjectIds(calendarId: string): Promise<string[]> {
    const rows = await databaseService.query<any>(
      `SELECT p.id FROM projects p LEFT JOIN project_groups g ON g.id = p.group_id
        WHERE p.archived_at IS NULL AND COALESCE(g.holiday_calendar_id, ?) = ?`, [HOME_CALENDAR, calendarId]);
    return rows.map((r: any) => r.id);
  }

  private async companyRun(change: CompanyHolidayChange, dryRun: boolean, userId: string | null): Promise<CalendarPreview> {
    let date: string;
    let label: string;
    const calendarId = change.calendarId || HOME_CALENDAR;
    if (!(await calendarService.listCalendars()).some(c => c.id === calendarId)) {
      throw new CalendarChangeError('That holiday calendar no longer exists — refresh and try again');
    }
    const current = await calendarService.listCompanyHolidays(calendarId);
    if ('add' in change) {
      date = change.add.date;
      label = `Company holiday added: ${fmt(date)}${change.add.name ? ` (${change.add.name})` : ''}`;
    } else {
      const h = current.find(x => x.id === change.removeId);
      if (!h) throw new CalendarChangeError('That holiday is no longer in the list — refresh and try again');
      date = h.date;
      label = `Company holiday removed: ${fmt(date)}`;
    }
    if (!dryRun) {
      if ('add' in change) await calendarService.addCompanyHoliday(date, change.add.name, userId, calendarId);
      else await calendarService.removeCompanyHoliday(change.removeId);
    }
    const moves: CalendarMove[] = [];
    let projects = 0;
    for (const projectId of await this.activeProjectIds(calendarId)) {
      // Before/after for this project, whichever way round the saved state now is
      // eslint-disable-next-line no-await-in-loop -- a company holiday change (rare, admin) re-fits each active project on its own calendar, one after another
      const spec = await calendarService.calendarSpec(projectId);
      const withIt = cloneSpec(spec); withIt.company.add(date);
      const without = cloneSpec(spec); without.company.delete(date);
      const [b, a] = 'add' in change ? [without, withIt] : [withIt, without];
      // eslint-disable-next-line no-await-in-loop -- as above
      const m = await this.refit(projectId, checker(b), checker(a), { dryRun, reason: 'calendar_change', label });
      if (m.length) projects++;
      moves.push(...m);
    }
    return this.summarise(moves, projects);
  }

  /**
   * A client switches holiday calendar (U8): its active projects' dates are re-fitted from the
   * old calendar's holidays to the new one's. Preview first (dryRun), then apply.
   */
  async clientCalendarRun(clientId: string, calendarId: string, dryRun: boolean): Promise<CalendarPreview> {
    const rows = await databaseService.query<any>('SELECT holiday_calendar_id FROM project_groups WHERE id = ?', [clientId]);
    if (!rows.length) throw new CalendarChangeError('That client no longer exists — refresh and try again');
    const known = await calendarService.listCalendars();
    if (!known.some(c => c.id === calendarId)) throw new CalendarChangeError('That calendar no longer exists — refresh and try again');
    const fromId = rows[0].holiday_calendar_id || HOME_CALENDAR;
    const [fromDays, toDays] = await Promise.all([calendarService.listCompanyHolidays(fromId), calendarService.listCompanyHolidays(calendarId)]);
    const label = `Holiday calendar changed to ${known.find(c => c.id === calendarId)!.name}`;
    if (!dryRun) await databaseService.query('UPDATE project_groups SET holiday_calendar_id = ? WHERE id = ?', [calendarId === HOME_CALENDAR ? null : calendarId, clientId]);
    const projectIds = (await databaseService.query<any>('SELECT id FROM projects WHERE archived_at IS NULL AND group_id = ?', [clientId])).map((r: any) => r.id);
    const moves: CalendarMove[] = [];
    let projects = 0;
    for (const projectId of projectIds) {
      // eslint-disable-next-line no-await-in-loop -- a client's calendar change (rare) re-fits each of its projects on its own calendar
      const spec = await calendarService.calendarSpec(projectId);
      const before = cloneSpec(spec); before.company = new Set(fromDays.map(h => h.date));
      const after = cloneSpec(spec); after.company = new Set(toDays.map(h => h.date));
      // eslint-disable-next-line no-await-in-loop -- as above
      const m = await this.refit(projectId, checker(before), checker(after), { dryRun, reason: 'calendar_change', label });
      if (m.length) projects++;
      moves.push(...m);
    }
    return this.summarise(moves, projects);
  }

  /**
   * A project moved to another client (U8): if that client uses a different holiday calendar, its
   * dates are re-fitted from the old calendar's holidays to the new one's. `before` is the
   * project's calendar read before the move.
   */
  async refitAfterClientMove(projectId: string, before: CalendarSpec): Promise<void> {
    const after = await calendarService.calendarSpec(projectId);
    const same = before.company.size === after.company.size && [...before.company].every(d => after.company.has(d));
    if (same) return;
    await this.refit(projectId, checker(before), checker(after), { dryRun: false, reason: 'calendar_change', label: 'Moved to another client with a different holiday calendar' });
  }

  previewCompanyChange(change: CompanyHolidayChange): Promise<CalendarPreview> {
    return this.companyRun(change, true, null);
  }

  applyCompanyChange(change: CompanyHolidayChange, userId: string | null): Promise<CalendarPreview> {
    return this.companyRun(change, false, userId);
  }

  /**
   * One-time clean-up (user decision 2026-09-29): every task that starts or finishes on
   * a day off moves to working days, keeping its working-day length; later tasks follow.
   * One Schedule History line per plan, with Undo.
   */
  async moveTasksOffDaysOff(projectId: string, opts: { dryRun?: boolean } = {}): Promise<CalendarPreview> {
    const isWorking = checker(await calendarService.calendarSpec(projectId));
    const moves = await this.refit(projectId, isWorking, isWorking, {
      dryRun: !!opts.dryRun, reason: 'days_off_cleanup', label: 'Moved tasks off days off (weekends and holidays)',
    });
    if (moves.length) logger.info('[WorkingCalendar] days-off clean-up', { projectId, moved: moves.length, dryRun: !!opts.dryRun });
    return this.summarise(moves, moves.length ? 1 : 0);
  }
}

export const workingCalendarService = new WorkingCalendarService();
