import { databaseService } from '../database/connection';
import { resourceService } from './ResourceService';
import { scheduleService } from './ScheduleService';
import { rateCardService, ratesOn } from './RateCardService';
import { calendarsFor } from './weeklyLoad';
import { workingDaysBetween } from '../utils/workingDays';
import logger from '../utils/logger';
import { queueReviewRerun } from './scheduleReview/autoRerun';

/**
 * A task's budget = its planned work effort × rate (2026-10-02, agreed with the user) — never
 * typed. For each person (or generic role) booked on the task: their hours a day (weekly hours
 * ÷ 5) × the task's working days on the plan's calendar × their rate on the task's start day.
 * People use their own rate or the rate card; a generic role always uses the rate card for its
 * role, so unstaffed work still gets a planned cost. No booking or no rate → no budget.
 * Summary tasks roll up their children. Run ~20 s after a plan changes (with Schedule Review)
 * and when rates change.
 */

const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');

export class TaskBudgetService {
  async recalcSchedule(scheduleId: string): Promise<number> {
    const tasks = await databaseService.query<{ id: string; parent_task_id: string | null; budget_allocated: number | null }>(
      `SELECT id, parent_task_id, budget_allocated FROM tasks WHERE schedule_id = ? AND COALESCE(is_summary, 0) = 0`, [scheduleId]);
    if (tasks.length === 0) return 0;
    const bookings = await resourceService.findEffectiveAssignments({ scheduleIds: [scheduleId], includeDone: true });
    const resourceIds = [...new Set(bookings.map(b => b.resourceId))];
    const people = resourceIds.length === 0 ? [] : await databaseService.query<any>(
      `SELECT id, role, cost_rate_hourly, overtime_rate_hourly, use_rate_card, is_generic FROM resources WHERE id IN (${ph(resourceIds.length)})`, resourceIds);
    const byId = new Map(people.map((r: any) => [r.id, {
      role: r.role,
      costRateHourly: r.cost_rate_hourly != null ? Number(r.cost_rate_hourly) : null,
      overtimeRateHourly: r.overtime_rate_hourly != null ? Number(r.overtime_rate_hourly) : null,
      // A generic role has no rate of its own: the rate card for its role
      useRateCard: !!r.use_rate_card || !!r.is_generic,
    }]));
    const rateCard = await rateCardService.listSafe();
    const isWorking = (await calendarsFor([scheduleId], (id) => scheduleService.workingDayTest(id)))(scheduleId);

    let changed = 0;
    const parents = new Set<string>();
    for (const t of tasks) {
      let cost = 0;
      let priced = false;
      for (const b of bookings.filter(x => x.taskId === t.id)) {
        const person = byId.get(b.resourceId);
        if (!person) continue;
        const rate = ratesOn(person, b.startDate.slice(0, 10), rateCard).standard;
        if (!rate) continue;
        cost += (b.hoursPerWeek / 5) * workingDaysBetween(b.startDate, b.endDate, isWorking) * rate;
        priced = true;
      }
      const budget = priced ? Math.round(cost * 100) / 100 : null;
      const before = t.budget_allocated != null ? Number(t.budget_allocated) : null;
      if (budget !== before) {
        await databaseService.query('UPDATE tasks SET budget_allocated = ? WHERE id = ?', [budget, t.id]);
        changed++;
        if (t.parent_task_id) parents.add(t.parent_task_id);
      }
    }
    for (const pid of parents) {
      await scheduleService.recomputeParentRollup(pid).catch(err => logger.warn('[TaskBudget] roll-up failed', { pid, error: err?.message }));
    }
    return changed;
  }

  /** A person's rate changed: re-price the plans they're booked on (debounced, in the background) */
  async queueForResource(resourceId: string): Promise<void> {
    const bookings = await resourceService.findEffectiveAssignments({ resourceId, includeDone: true });
    for (const sid of new Set(bookings.map(b => b.scheduleId))) queueReviewRerun(sid);
  }

  /** The rate card changed: re-price every plan (debounced per plan, in the background) */
  async queueAll(): Promise<void> {
    const schedules = await databaseService.query<{ id: string }>('SELECT id FROM schedules');
    for (const s of schedules) queueReviewRerun(s.id);
  }
}

export const taskBudgetService = new TaskBudgetService();
