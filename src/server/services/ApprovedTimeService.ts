import { databaseService } from '../database/connection';
import { resourceService } from './ResourceService';
import { scheduleService } from './ScheduleService';
import { rateCardService, ratesOn } from './RateCardService';
import { calendarsFor } from './weeklyLoad';
import { workingDaysBetween } from '../utils/workingDays';
import { queueReviewRerun } from './scheduleReview/autoRerun';
import { projectService } from './ProjectService';
import logger from '../utils/logger';

/**
 * What approved time does to the plan (2026-10-02, agreed with the user). After a line manager
 * approves a week, for every task the week touched:
 *  - labour hours = all approved hours on the task; labour cost = each hour at the person's rate
 *    on the day it was worked (rate card or own rate; overtime rate for overtime hours);
 *  - actual cost = labour (work effort × rate; non-labour costs are project expenses) —
 *    summary tasks roll it up;
 *  - % complete = approved ÷ planned hours, stopping at 99% until the PM marks it done (tasks
 *    with no planned hours keep the PM's %); a task not started moves to in progress; the actual
 *    start is the first day worked;
 * and each project's money spent = its tasks' labour + its other costs. Recomputed from the
 * approved hours each time (not added on), so running it twice changes nothing.
 */

const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');
const money = (n: number) => Math.round(n * 100) / 100;

export class ApprovedTimeService {
  async applyToTasks(taskIds: string[]): Promise<{ tasks: number; projects: number }> {
    const ids = [...new Set(taskIds.filter(Boolean))];
    if (ids.length === 0) return { tasks: 0, projects: 0 };

    const tasks = await databaseService.query<any>(
      `SELECT t.id, t.schedule_id, t.parent_task_id, t.status, t.progress_percentage, s.project_id
         FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE t.id IN (${ph(ids.length)})`, ids);
    const entries = await databaseService.query<any>(
      `SELECT task_id, user_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, hours, rate_type
         FROM time_entries WHERE status = 'approved' AND task_id IN (${ph(ids.length)})`, ids);
    const userIds = [...new Set(entries.map((e: any) => e.user_id))];
    const people = userIds.length === 0 ? [] : await databaseService.query<any>(
      `SELECT * FROM resources WHERE COALESCE(is_generic, 0) = 0 AND user_id IN (${ph(userIds.length)})`, userIds);
    const personOf = new Map<string, any>();
    for (const r of people) if (!personOf.has(r.user_id)) personOf.set(r.user_id, {
      id: r.id, costRateHourly: r.cost_rate_hourly != null ? Number(r.cost_rate_hourly) : null,
      overtimeRateHourly: r.overtime_rate_hourly != null ? Number(r.overtime_rate_hourly) : null,
      useRateCard: !!r.use_rate_card, role: r.role,
    });
    const rateCard = await rateCardService.listSafe();

    // Everyone's planned hours on each task, for % complete
    const scheduleIds = [...new Set(tasks.map((t: any) => t.schedule_id))];
    const bookings = await resourceService.findEffectiveAssignments({ scheduleIds, includeDone: true });
    const calOf = await calendarsFor(scheduleIds, (id) => scheduleService.workingDayTest(id));

    const parents = new Set<string>();
    const projects = new Set<string>();
    for (const t of tasks) {
      const mine = entries.filter((e: any) => e.task_id === t.id);
      let hours = 0;
      let cost = 0;
      let firstDay: string | null = null;
      for (const e of mine) {
        const h = Number(e.hours);
        hours += h;
        const person = personOf.get(e.user_id);
        if (person) {
          const { standard, overtime } = ratesOn(person, e.date, rateCard);
          const rate = e.rate_type === 'overtime' ? (overtime ?? standard) : standard;
          if (rate) cost += h * rate;
        }
        if (!firstDay || e.date < firstDay) firstDay = e.date;
      }
      const planned = bookings.filter(b => b.taskId === t.id)
        .reduce((n, b) => n + (b.hoursPerWeek / 5) * workingDaysBetween(b.startDate, b.endDate, calOf(t.schedule_id)), 0);
      const done = t.status === 'completed' || t.status === 'cancelled';
      const progress = !done && planned > 0 ? Math.min(99, Math.round((hours / planned) * 100)) : null;
      const status = !done && hours > 0 && (t.status === 'pending' || t.status === 'not_started') ? 'in_progress' : null;

      // SET runs left to right: other_cost is fixed from the old figures before labour changes
      await databaseService.query(
        `UPDATE tasks SET
           other_cost = 0,
           labour_hours = ?, labour_cost = ?,
           actual_cost = CASE WHEN ? = 0 THEN NULL ELSE ROUND(?, 2) END,
           progress_percentage = COALESCE(?, progress_percentage),
           status = COALESCE(?, status),
           actual_start_date = COALESCE(actual_start_date, ?)
         WHERE id = ?`,
        [Math.round(hours * 100) / 100, money(cost), cost, money(cost), progress, status, firstDay, t.id]);
      if (t.parent_task_id) parents.add(t.parent_task_id);
      projects.add(t.project_id);
    }

    for (const pid of parents) {
      await scheduleService.recomputeParentRollup(pid).catch(err => logger.warn('[ApprovedTime] roll-up failed', { pid, error: err?.message }));
    }
    for (const projectId of projects) await this.applyToProject(projectId);
    for (const sid of scheduleIds) queueReviewRerun(sid);
    return { tasks: tasks.length, projects: projects.size };
  }

  /** % complete from approved hours for one task as if it were open (approved ÷ planned, max 99); null if nothing planned */
  async progressFor(taskId: string): Promise<number | null> {
    const [t] = await databaseService.query<any>('SELECT id, schedule_id FROM tasks WHERE id = ?', [taskId]);
    if (!t) return null;
    const [row] = await databaseService.query<{ total: number }>(
      `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries WHERE status = 'approved' AND task_id = ?`, [taskId]);
    const bookings = (await resourceService.findEffectiveAssignments({ scheduleIds: [t.schedule_id], includeDone: true })).filter(b => b.taskId === taskId);
    const cal = (await calendarsFor([t.schedule_id], (id) => scheduleService.workingDayTest(id)))(t.schedule_id);
    const planned = bookings.reduce((n, b) => n + (b.hoursPerWeek / 5) * workingDaysBetween(b.startDate, b.endDate, cal), 0);
    return planned > 0 ? Math.min(99, Math.round((Number(row?.total ?? 0) / planned) * 100)) : null;
  }

  /** A project's money spent = its tasks' labour + its other costs */
  async applyToProject(projectId: string): Promise<void> {
    await databaseService.query(
      `UPDATE projects p SET
         p.other_costs = COALESCE(p.other_costs, GREATEST(COALESCE(p.budget_spent, 0) - p.labour_cost, 0)),
         p.labour_cost = (SELECT COALESCE(SUM(t.labour_cost), 0) FROM tasks t JOIN schedules s ON s.id = t.schedule_id
                           WHERE s.project_id = p.id AND COALESCE(t.is_summary, 0) = 0),
         p.budget_spent = ROUND(COALESCE(p.other_costs, 0) + p.labour_cost, 2)
       WHERE p.id = ?`, [projectId]);
    // The project is cached for a few minutes; without this, screens showed the old spend
    await projectService.invalidateCache(projectId);
  }
}

export const approvedTimeService = new ApprovedTimeService();
