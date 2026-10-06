import { databaseService } from '../database/connection';
import { resourceService } from './ResourceService';
import { scheduleService } from './ScheduleService';
import { rateCardService, ratesOn } from './RateCardService';
import { calendarsFor } from './weeklyLoad';
import { workingDaysBetween } from '../utils/workingDays';
import logger from '../utils/logger';
import { planChanged } from './domainEvents';

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

    const parents = new Set<string>();
    const writes: Array<{ id: string; budget: number | null }> = [];
    const bookingsByTask = new Map<string, typeof bookings>();
    for (const b of bookings) bookingsByTask.set(b.taskId, [...(bookingsByTask.get(b.taskId) ?? []), b]);
    for (const t of tasks) {
      let cost = 0;
      let priced = false;
      for (const b of bookingsByTask.get(t.id) ?? []) {
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
        writes.push({ id: t.id, budget });
        if (t.parent_task_id) parents.add(t.parent_task_id);
      }
    }
    // Written 100 at a time (it was one UPDATE per task — 2026-10-04 audit). A worked-out figure,
    // not an edit: updated_at stays, so a background re-price ~20 s after a change doesn't count as
    // "the plan changed since" and block its Undo in Schedule History
    for (let i = 0; i < writes.length; i += 100) {
      const chunk = writes.slice(i, i + 100);
      await databaseService.query(
        `UPDATE tasks SET budget_allocated = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END, updated_at = updated_at
          WHERE id IN (${chunk.map(() => '?').join(',')})`,
        [...chunk.flatMap(w => [w.id, w.budget]), ...chunk.map(w => w.id)],
      );
    }
    const changed = writes.length;
    for (const pid of parents) {
      await scheduleService.recomputeParentRollup(pid, 0, { quiet: true }).catch(err => logger.warn('[TaskBudget] roll-up failed', { pid, error: err?.message }));
    }
    return changed;
  }

  /** A person's rate changed: re-price the plans they're booked on (debounced, in the background) */
  async queueForResource(resourceId: string): Promise<void> {
    const bookings = await resourceService.findEffectiveAssignments({ resourceId, includeDone: true });
    for (const sid of new Set(bookings.map(b => b.scheduleId))) planChanged(sid);
  }

  /**
   * The rate card changed: re-price every live plan (debounced per plan, in the background).
   * Archived projects and the sample are left alone — they are history / never count, and
   * re-pricing them only added to the burst (2026-10-03).
   */
  async queueAll(): Promise<void> {
    const schedules = await databaseService.query<{ id: string }>(
      `SELECT s.id FROM schedules s JOIN projects p ON p.id = s.project_id
        WHERE p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0`);
    for (const s of schedules) planChanged(s.id);
  }
}

export const taskBudgetService = new TaskBudgetService();
