import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { resourceService } from './ResourceService';
import { scheduleService } from './ScheduleService';
import { projectMemberService } from './ProjectMemberService';
import { notificationService } from './NotificationService';
import { hoursInWeek, calendarsFor } from './weeklyLoad';
import { approvedTimeService } from './ApprovedTimeService';
import { mondayOf, weekEndOf, workingDaysBetween, daysOfWeek } from '../utils/workingDays';
import { getRequestContext } from '../middleware/requestContext';
import { organizationTimezone } from './StatusDateService';
import { today as calendarToday } from '../utils/calendarDate';
import logger from '../utils/logger';

/**
 * Weekly timesheets (2026-10-02, mock approved). One timesheet per person per week, across all
 * their projects, approved by ONE person: their line manager (resources.line_manager_user_id).
 * Each line is a task: the hours planned for the person this week (their share of the task,
 * spread over its working days), the hours worked, and how far the task is — worked out from
 * approved hours, so nobody enters "time left". PMs see pending hours on their projects and can
 * flag a line for the line manager.
 */

export type SheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/**
 * Months lock automatically (user, 2026-10-02): a month's hours can't be added, changed or
 * removed from the 5th of the next month — September locks on 5 October. Days are the
 * company's calendar days (its time zone).
 */
export const MONTH_LOCK_DAY = 5;
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The day a month locks: the MONTH_LOCK_DAY of the following month */
export function lockDateFor(day: string): string {
  const y = Number(day.slice(0, 4)); const m = Number(day.slice(5, 7));
  return m === 12 ? `${y + 1}-01-${pad(MONTH_LOCK_DAY)}` : `${y}-${pad(m + 1)}-${pad(MONTH_LOCK_DAY)}`;
}
export function isMonthLocked(day: string, today: string): boolean {
  return today.slice(0, 10) >= lockDateFor(day.slice(0, 10));
}
export function lockMessage(day: string): string {
  const lock = lockDateFor(day);
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)} is closed (it locked on ${Number(lock.slice(8, 10))} ${MONTHS[Number(lock.slice(5, 7)) - 1].slice(0, 3)}). Hours in a closed month can't be added, changed or removed.`;
}

export class TimesheetError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

export interface TimesheetLine {
  projectId: string;
  projectName: string;
  scheduleId: string;
  taskId: string;
  taskName: string;
  /** Planned for this person this week (their booking on the task, this week's working days only) */
  plannedThisWeek: number;
  /** date → the person's entry that day */
  days: Record<string, { entryId: string; hours: number; status: string }>;
  workedThisWeek: number;
  /** The person's whole planned share of the task, and their approved hours on it so far */
  taskPlanned: number;
  taskApproved: number;
  remaining: number;
  overPlanBy: number;
  percent: number;
  taskDone: boolean;
}

export interface WeekView {
  weekStart: string;
  days: string[];
  /** Days of this week in a closed (locked) month */
  lockedDays: string[];
  lockNote: string | null;
  status: SheetStatus;
  sheet: { id: string; status: SheetStatus; submittedAt: string | null; reviewedAt: string | null; rejectionReason: string | null } | null;
  approver: { userId: string; name: string } | null;
  lines: TimesheetLine[];
  totals: { planned: number; worked: number };
  flags: Array<{ id: string; taskId: string; projectId: string; note: string; flaggedByName: string; createdAt: string }>;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');

export class WeeklyTimesheetService {
  /** The seven days of the week holding `date` (Monday first) */
  weekOf(date: string): { weekStart: string; weekEnd: string; days: string[] } {
    const weekStart = mondayOf(date);
    const weekEnd = weekEndOf(weekStart);
    return { weekStart, weekEnd, days: daysOfWeek(weekStart) };
  }

  private async personOf(userId: string): Promise<{ id: string; lineManagerUserId: string | null } | null> {
    const [r] = await databaseService.query<{ id: string; line_manager_user_id: string | null }>(
      'SELECT id, line_manager_user_id FROM resources WHERE user_id = ? AND COALESCE(is_generic, 0) = 0 ORDER BY created_at LIMIT 1', [userId]);
    return r ? { id: r.id, lineManagerUserId: r.line_manager_user_id } : null;
  }

  private async companyOwnerId(): Promise<string | null> {
    const orgId = getRequestContext()?.organizationId;
    if (!orgId) return null;
    const [org] = await databaseService.queryControlPlane<{ owner_user_id: string }>('SELECT owner_user_id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
    return org?.owner_user_id ?? null;
  }

  /** Who approves this person's timesheets: their line manager, else the company owner */
  async approverFor(userId: string): Promise<string | null> {
    const person = await this.personOf(userId);
    const owner = await this.companyOwnerId();
    const lm = person?.lineManagerUserId;
    if (lm && (lm !== userId || lm === owner)) return lm;
    return owner;
  }

  async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    const out = new Map<string, string>();
    if (list.length === 0) return out;
    const rows = await databaseService.queryControlPlane<{ id: string; full_name: string | null; username: string }>(
      `SELECT id, full_name, username FROM users WHERE id IN (${ph(list.length)})`, list);
    for (const r of rows) out.set(r.id, r.full_name || r.username);
    return out;
  }

  private async sheetRow(userId: string, weekStart: string): Promise<any | null> {
    const [row] = await databaseService.query<any>(
      `SELECT * FROM timesheets WHERE user_id = ? AND week_start = ?`, [userId, weekStart]);
    return row ?? null;
  }

  /**
   * One person's week: a line for every task they're planned on this week or logged time on,
   * grouped by project. `projectIds` limits it to those projects (a PM's view of someone else).
   */
  async weekView(userId: string, date: string, projectIds?: Set<string>): Promise<WeekView> {
    const { weekStart, weekEnd, days } = this.weekOf(date);
    const entries = await databaseService.query<any>(
      `SELECT id, task_id, schedule_id, project_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, hours, status
         FROM time_entries WHERE user_id = ? AND date >= ? AND date <= ?`, [userId, weekStart, weekEnd]);

    // What the person is planned on this week (finished tasks too: the time may still be logged)
    const person = await this.personOf(userId);
    const bookings = person
      ? await resourceService.findEffectiveAssignments({ resourceId: person.id, from: weekStart, to: weekEnd, includeDone: true })
      : [];
    const allBookings = person
      ? await resourceService.findEffectiveAssignments({ resourceId: person.id, includeDone: true })
      : [];
    const calOf = await calendarsFor([...entries.map((e: any) => e.schedule_id), ...allBookings.map(b => b.scheduleId)], (id) => scheduleService.workingDayTest(id));

    const taskIds = [...new Set([...entries.map((e: any) => e.task_id), ...bookings.map(b => b.taskId)])];
    const info = new Map<string, { name: string; projectId: string; projectName: string; scheduleId: string; status: string }>();
    if (taskIds.length > 0) {
      const rows = await databaseService.query<any>(
        `SELECT t.id, t.name, t.status, t.schedule_id, p.id AS project_id, p.name AS project_name
           FROM tasks t JOIN schedules s ON s.id = t.schedule_id JOIN projects p ON p.id = s.project_id
          WHERE t.id IN (${ph(taskIds.length)})`, taskIds);
      for (const r of rows) info.set(r.id, { name: r.name, projectId: r.project_id, projectName: r.project_name, scheduleId: r.schedule_id, status: r.status });
    }
    const approvedRows = taskIds.length === 0 ? [] : await databaseService.query<{ task_id: string; total: number }>(
      `SELECT task_id, SUM(hours) AS total FROM time_entries WHERE user_id = ? AND status = 'approved' AND task_id IN (${ph(taskIds.length)}) GROUP BY task_id`,
      [userId, ...taskIds]);
    const approvedBy = new Map(approvedRows.map(r => [r.task_id, Number(r.total)]));

    const lines: TimesheetLine[] = [];
    for (const taskId of taskIds) {
      const t = info.get(taskId);
      if (!t) continue;
      if (projectIds && !projectIds.has(t.projectId)) continue;
      const cal = calOf(t.scheduleId);
      const plannedThisWeek = r1(bookings.filter(b => b.taskId === taskId).reduce((n, b) => n + hoursInWeek(b, weekStart, cal), 0));
      const taskPlanned = r1(allBookings.filter(b => b.taskId === taskId)
        .reduce((n, b) => n + (b.hoursPerWeek / 5) * workingDaysBetween(b.startDate, b.endDate, cal), 0));
      const dayMap: TimesheetLine['days'] = {};
      for (const e of entries.filter((x: any) => x.task_id === taskId)) {
        const prev = dayMap[e.date];
        dayMap[e.date] = { entryId: prev?.entryId ?? e.id, hours: r1((prev?.hours ?? 0) + Number(e.hours)), status: e.status };
      }
      const workedThisWeek = r1(Object.values(dayMap).reduce((n, d) => n + d.hours, 0));
      const taskApproved = r1(approvedBy.get(taskId) ?? 0);
      // This week's hours still to be approved count toward "over plan" as soon as they're entered
      const notYetApproved = entries.filter((x: any) => x.task_id === taskId && x.status !== 'approved').reduce((n: number, x: any) => n + Number(x.hours), 0);
      const taskDone = t.status === 'completed';
      // % stops at 99 until the PM marks the task done (user's rule, 2026-10-02)
      const raw = taskPlanned > 0 ? Math.round((taskApproved / taskPlanned) * 100) : 0;
      lines.push({
        projectId: t.projectId, projectName: t.projectName, scheduleId: t.scheduleId, taskId, taskName: t.name,
        plannedThisWeek, days: dayMap, workedThisWeek, taskPlanned, taskApproved,
        remaining: r1(Math.max(0, taskPlanned - taskApproved)),
        overPlanBy: taskPlanned > 0 ? r1(Math.max(0, taskApproved + notYetApproved - taskPlanned)) : 0,
        percent: taskDone ? 100 : Math.min(99, raw),
        taskDone,
      });
    }
    lines.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.taskName.localeCompare(b.taskName));

    const row = await this.sheetRow(userId, weekStart);
    const sheetStatus: SheetStatus = row?.status ?? 'draft';
    const approverId = row?.approver_user_id ?? await this.approverFor(userId);
    const flags = row ? await databaseService.query<any>(
      `SELECT id, task_id, project_id, note, flagged_by, created_at FROM timesheet_flags WHERE timesheet_id = ? ORDER BY created_at`, [row.id]) : [];
    const names = await this.userNames([approverId, ...flags.map((f: any) => f.flagged_by)]);
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

    const todayKey = await this.companyToday();
    const lockedDays = days.filter(d => isMonthLocked(d, todayKey));
    return {
      weekStart, days,
      lockedDays,
      lockNote: lockedDays.length ? lockMessage(lockedDays[0]) : null,
      status: sheetStatus,
      sheet: row ? { id: row.id, status: row.status, submittedAt: iso(row.submitted_at), reviewedAt: iso(row.reviewed_at), rejectionReason: row.rejection_reason ?? null } : null,
      approver: approverId ? { userId: approverId, name: names.get(approverId) ?? 'Line manager' } : null,
      lines,
      totals: { planned: r1(lines.reduce((n, l) => n + l.plannedThisWeek, 0)), worked: r1(lines.reduce((n, l) => n + l.workedThisWeek, 0)) },
      flags: flags
        .filter((f: any) => !projectIds || projectIds.has(f.project_id))
        .map((f: any) => ({ id: f.id, taskId: f.task_id, projectId: f.project_id, note: f.note, flaggedByName: names.get(f.flagged_by) ?? 'A PM', createdAt: iso(f.created_at)! })),
    };
  }

  /** Today in the company's time zone */
  async companyToday(): Promise<string> {
    const zone = await organizationTimezone(getRequestContext()?.organizationId).catch(() => 'UTC');
    return calendarToday(zone);
  }

  /** Refuse any change to hours on a day whose month is closed */
  async assertDayOpen(date: string): Promise<void> {
    if (isMonthLocked(date, await this.companyToday())) throw new TimesheetError(lockMessage(date), 409);
  }

  /** Can hours be added or changed on this day? Not in a closed month, nor once its week is sent or approved. */
  async assertWeekOpen(userId: string, date: string): Promise<void> {
    await this.assertDayOpen(date);
    const { weekStart } = this.weekOf(date);
    const row = await this.sheetRow(userId, weekStart);
    if (row?.status === 'submitted') throw new TimesheetError('This week has been sent for approval. Recall it first to change your hours.', 409);
    if (row?.status === 'approved') throw new TimesheetError('This week has been approved, so its hours can no longer change.', 409);
  }

  async submit(userId: string, date: string): Promise<WeekView> {
    const { weekStart, weekEnd } = this.weekOf(date);
    const row = await this.sheetRow(userId, weekStart);
    if (row?.status === 'submitted') throw new TimesheetError('This week is already waiting for approval.', 409);
    if (row?.status === 'approved') throw new TimesheetError('This week has already been approved.', 409);
    const entries = await databaseService.query<{ id: string; hours: number }>(
      `SELECT id, hours FROM time_entries WHERE user_id = ? AND date >= ? AND date <= ? AND status IN ('draft', 'rejected')`, [userId, weekStart, weekEnd]);
    if (entries.length === 0) throw new TimesheetError('There are no hours to send for this week. Enter your hours first.');
    const approver = await this.approverFor(userId);
    if (!approver) throw new TimesheetError("No line manager is set for you and the company has no owner on record. Ask an admin to set your line manager.", 409);
    const total = r1(entries.reduce((n, e) => n + Number(e.hours), 0));

    await databaseService.transaction(async (conn) => {
      await databaseService.queryOn(conn, `UPDATE time_entries SET status = 'submitted' WHERE id IN (${ph(entries.length)})`, entries.map(e => e.id));
      await databaseService.queryOn(conn,
        `INSERT INTO timesheets (id, user_id, week_start, status, approver_user_id, total_hours, submitted_at)
         VALUES (?, ?, ?, 'submitted', ?, ?, NOW())
         ON DUPLICATE KEY UPDATE status = 'submitted', approver_user_id = VALUES(approver_user_id), total_hours = VALUES(total_hours),
           submitted_at = NOW(), reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL`,
        [uuidv4(), userId, weekStart, approver, total]);
      // A fresh submission starts with no flags
      if (row?.id) await databaseService.queryOn(conn, 'DELETE FROM timesheet_flags WHERE timesheet_id = ?', [row.id]);
    });

    const names = await this.userNames([userId]);
    notificationService.create({
      userId: approver,
      type: 'timesheet_submitted',
      severity: 'medium',
      title: 'Timesheet to approve',
      message: `${names.get(userId) ?? 'Someone'} sent their timesheet for the week of ${weekStart} (${total}h) for your approval.`,
    }).catch(err => logger.warn('[Timesheet] notify approver failed', { error: err?.message }));
    return this.weekView(userId, weekStart);
  }

  async recall(userId: string, date: string): Promise<WeekView> {
    const { weekStart, weekEnd } = this.weekOf(date);
    const row = await this.sheetRow(userId, weekStart);
    if (!row || row.status !== 'submitted') throw new TimesheetError('Only a week that is waiting for approval can be recalled.', 409);
    await databaseService.transaction(async (conn) => {
      await databaseService.queryOn(conn,
        `UPDATE time_entries SET status = 'draft' WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'submitted'`, [userId, weekStart, weekEnd]);
      await databaseService.queryOn(conn, 'DELETE FROM timesheet_flags WHERE timesheet_id = ?', [row.id]);
      await databaseService.queryOn(conn, 'DELETE FROM timesheets WHERE id = ?', [row.id]);
    });
    return this.weekView(userId, weekStart);
  }

  private async reviewable(sheetId: string, reviewerId: string): Promise<any> {
    const [row] = await databaseService.query<any>('SELECT * FROM timesheets WHERE id = ?', [sheetId]);
    if (!row) throw new TimesheetError('Timesheet not found.', 404);
    // One approver: the line manager it was sent to (the company owner can step in, e.g. when
    // that person has left)
    if (row.approver_user_id !== reviewerId && reviewerId !== await this.companyOwnerId()) {
      throw new TimesheetError("Only the person's line manager can approve or send back this timesheet.", 403);
    }
    if (row.status !== 'submitted') throw new TimesheetError('This timesheet is not waiting for approval.', 409);
    if (row.user_id === reviewerId && reviewerId !== await this.companyOwnerId()) throw new TimesheetError("You can't approve your own timesheet.", 403);
    return row;
  }

  /** Approve a week. Returns the entries approved (for the plan and cost updates). */
  async approve(sheetId: string, reviewerId: string): Promise<{ approvedEntryIds: string[] }> {
    const row = await this.reviewable(sheetId, reviewerId);
    const weekStart = new Date(row.week_start).toISOString().slice(0, 10);
    const weekEnd = weekEndOf(weekStart);
    const entries = await databaseService.query<{ id: string }>(
      `SELECT id FROM time_entries WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'submitted'`, [row.user_id, weekStart, weekEnd]);
    await databaseService.transaction(async (conn) => {
      if (entries.length) {
        await databaseService.queryOn(conn,
          `UPDATE time_entries SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id IN (${ph(entries.length)})`,
          [reviewerId, ...entries.map(e => e.id)]);
      }
      await databaseService.queryOn(conn, `UPDATE timesheets SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`, [reviewerId, sheetId]);
    });
    // The plan and budgets follow the approved hours: task labour, cost, % and start; project spend
    if (entries.length) {
      const touched = await databaseService.query<{ task_id: string }>(
        `SELECT DISTINCT task_id FROM time_entries WHERE id IN (${ph(entries.length)})`, entries.map(e => e.id));
      await approvedTimeService.applyToTasks(touched.map(t => t.task_id));
    }
    notificationService.create({
      userId: row.user_id, type: 'timesheet_approved', severity: 'low',
      title: 'Timesheet approved', message: `Your timesheet for the week of ${weekStart} has been approved.`,
    }).catch(err => logger.warn('[Timesheet] notify approved failed', { error: err?.message }));
    return { approvedEntryIds: entries.map(e => e.id) };
  }

  async reject(sheetId: string, reviewerId: string, reason: string): Promise<void> {
    const row = await this.reviewable(sheetId, reviewerId);
    const weekStart = new Date(row.week_start).toISOString().slice(0, 10);
    await databaseService.transaction(async (conn) => {
      await databaseService.queryOn(conn,
        `UPDATE time_entries SET status = 'rejected' WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'submitted'`,
        [row.user_id, weekStart, weekEndOf(weekStart)]);
      await databaseService.queryOn(conn,
        `UPDATE timesheets SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), rejection_reason = ? WHERE id = ?`, [reviewerId, reason, sheetId]);
    });
    notificationService.create({
      userId: row.user_id, type: 'timesheet_rejected', severity: 'high',
      title: 'Timesheet sent back', message: `Your timesheet for the week of ${weekStart} was sent back: ${reason}`,
    }).catch(err => logger.warn('[Timesheet] notify rejected failed', { error: err?.message }));
  }

  /** Is this user anyone's line manager (or the company owner)? Decides whether "To approve" shows. */
  async isApprover(userId: string): Promise<boolean> {
    if (userId === await this.companyOwnerId()) return true;
    const [row] = await databaseService.query<{ n: number }>('SELECT COUNT(*) AS n FROM resources WHERE line_manager_user_id = ?', [userId]);
    return Number(row?.n ?? 0) > 0;
  }

  /** The line manager's queue: timesheets waiting for them (the company owner also sees ones whose approver has left) */
  async pendingFor(reviewerId: string): Promise<Array<{ id: string; userId: string; userName: string; weekStart: string; totalHours: number; projectCount: number; flagCount: number; submittedAt: string }>> {
    const owner = await this.companyOwnerId();
    const rows = await databaseService.query<any>(
      `SELECT ts.*, (SELECT COUNT(DISTINCT project_id) FROM time_entries te
                      WHERE te.user_id = ts.user_id AND te.date BETWEEN ts.week_start AND DATE_ADD(ts.week_start, INTERVAL 6 DAY)) AS project_count,
              (SELECT COUNT(*) FROM timesheet_flags f WHERE f.timesheet_id = ts.id) AS flag_count
         FROM timesheets ts WHERE ts.status = 'submitted' AND (ts.approver_user_id = ?${reviewerId === owner ? ' OR ts.approver_user_id IS NULL' : ''})
        ORDER BY ts.week_start, ts.submitted_at`, [reviewerId]);
    const names = await this.userNames(rows.map((r: any) => r.user_id));
    return rows.map((r: any) => ({
      id: r.id, userId: r.user_id, userName: names.get(r.user_id) ?? 'Someone',
      weekStart: new Date(r.week_start).toISOString().slice(0, 10), totalHours: Number(r.total_hours),
      projectCount: Number(r.project_count), flagCount: Number(r.flag_count), submittedAt: new Date(r.submitted_at).toISOString(),
    }));
  }

  /** A timesheet for its approver (or the person themselves) to read */
  async sheetDetail(sheetId: string, viewerId: string): Promise<WeekView & { userId: string; userName: string }> {
    const [row] = await databaseService.query<any>('SELECT * FROM timesheets WHERE id = ?', [sheetId]);
    if (!row) throw new TimesheetError('Timesheet not found.', 404);
    const owner = await this.companyOwnerId();
    if (row.approver_user_id !== viewerId && row.user_id !== viewerId && viewerId !== owner) throw new TimesheetError('Timesheet not found.', 404);
    const weekStart = new Date(row.week_start).toISOString().slice(0, 10);
    const view = await this.weekView(row.user_id, weekStart);
    const names = await this.userNames([row.user_id]);
    return { ...view, userId: row.user_id, userName: names.get(row.user_id) ?? 'Someone' };
  }

  /** A PM flags one task line of a submitted timesheet for the line manager */
  async flag(sheetId: string, taskId: string, note: string, pmUserId: string): Promise<void> {
    const [row] = await databaseService.query<any>('SELECT * FROM timesheets WHERE id = ?', [sheetId]);
    if (!row) throw new TimesheetError('Timesheet not found.', 404);
    if (row.status !== 'submitted') throw new TimesheetError('Only a timesheet waiting for approval can be flagged.', 409);
    const task = await scheduleService.findTaskById(taskId);
    const schedule = task ? await scheduleService.findById(task.scheduleId) : null;
    if (!task || !schedule) throw new TimesheetError('Task not found.', 404);
    if (!(await projectMemberService.hasRole(schedule.projectId, pmUserId, 'manager'))) {
      throw new TimesheetError("Only this project's PM can flag hours on it.", 403);
    }
    // Only a line that's on this timesheet: hours on this task in that week (any PM could flag
    // any waiting timesheet with their own task — 2026-10-05 audit)
    const [onSheet] = await databaseService.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM time_entries
        WHERE user_id = ? AND task_id = ? AND date >= ? AND date < DATE_ADD(?, INTERVAL 7 DAY)`,
      [row.user_id, taskId, row.week_start, row.week_start]);
    if (!Number(onSheet?.n)) throw new TimesheetError("That task isn't on this timesheet.", 400);
    await databaseService.query(
      `INSERT INTO timesheet_flags (id, timesheet_id, project_id, task_id, flagged_by, note) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), sheetId, schedule.projectId, taskId, pmUserId, note]);
    if (row.approver_user_id) {
      const names = await this.userNames([pmUserId, row.user_id]);
      notificationService.create({
        userId: row.approver_user_id, type: 'timesheet_flagged', severity: 'medium',
        title: 'A PM flagged a timesheet line',
        message: `${names.get(pmUserId) ?? 'A PM'} flagged "${task.name}" on ${names.get(row.user_id) ?? 'a'} timesheet: ${note}`,
        projectId: schedule.projectId,
      }).catch(err => logger.warn('[Timesheet] notify flag failed', { error: err?.message }));
    }
  }

  /**
   * A PM's view of time on their project: hours waiting for approval, by person and week, with
   * the timesheet each belongs to (so a line can be flagged). This project's hours only.
   */
  async projectPending(projectId: string): Promise<Array<{ sheetId: string | null; userId: string; userName: string; weekStart: string; lines: Array<{ taskId: string; taskName: string; hours: number; plannedThisWeek: number }> }>> {
    const rows = await databaseService.query<any>(
      `SELECT te.user_id, te.task_id, t.name AS task_name, DATE_FORMAT(DATE_SUB(te.date, INTERVAL WEEKDAY(te.date) DAY), '%Y-%m-%d') AS week_start, SUM(te.hours) AS hours
         FROM time_entries te JOIN tasks t ON t.id = te.task_id
        WHERE te.project_id = ? AND te.status = 'submitted'
        GROUP BY te.user_id, te.task_id, t.name, week_start
        ORDER BY week_start, te.user_id`, [projectId]);
    const groups = new Map<string, { sheetId: string | null; userId: string; userName: string; weekStart: string; lines: any[] }>();
    const names = await this.userNames(rows.map((r: any) => r.user_id));
    // every person-week's sheet in one read (was one per person-week; 2026-10-09)
    const pairs = [...new Map(rows.map((r: any) => [`${r.user_id}|${r.week_start}`, [r.user_id, r.week_start]])).values()] as string[][];
    const sheetOf = new Map<string, string>();
    if (pairs.length) {
      const sheets = await databaseService.query<any>(
        `SELECT id, user_id, DATE_FORMAT(week_start, '%Y-%m-%d') AS week_start FROM timesheets WHERE (user_id, week_start) IN (${pairs.map(() => '(?, ?)').join(', ')})`,
        pairs.flat());
      for (const sh of sheets) sheetOf.set(`${sh.user_id}|${sh.week_start}`, sh.id);
    }
    for (const r of rows) {
      const key = `${r.user_id}|${r.week_start}`;
      if (!groups.has(key)) {
        groups.set(key, { sheetId: sheetOf.get(key) ?? null, userId: r.user_id, userName: names.get(r.user_id) ?? 'Someone', weekStart: r.week_start, lines: [] });
      }
      groups.get(key)!.lines.push({ taskId: r.task_id, taskName: r.task_name, hours: r1(Number(r.hours)), plannedThisWeek: 0 });
    }
    // Planned hours for each line, from the person's week (this project only)
    for (const g of groups.values()) {
      // eslint-disable-next-line no-await-in-loop -- one person's planned week per sheet waiting for approval (a few); each reads that person's own bookings and calendar
      const view = await this.weekView(g.userId, g.weekStart, new Set([projectId]));
      for (const l of g.lines) l.plannedThisWeek = view.lines.find(x => x.taskId === l.taskId)?.plannedThisWeek ?? 0;
    }
    return [...groups.values()];
  }
}

export const weeklyTimesheetService = new WeeklyTimesheetService();
