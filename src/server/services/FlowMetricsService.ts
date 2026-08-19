import { databaseService } from '../database/connection';

interface FlowMetrics {
  avgLeadTimeDays: number;
  avgCycleTimeDays: number;
  medianLeadTimeDays: number;
  medianCycleTimeDays: number;
  distribution: Array<{ bucket: string; count: number }>;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

class FlowMetricsService {
  async getFlowMetrics(scheduleId: string): Promise<FlowMetrics> {
    const MS_PER_DAY = 86_400_000;

    // Get completed tasks with their creation time
    const tasks = await databaseService.query(
      `SELECT t.id, t.created_at
       FROM tasks t
       WHERE t.schedule_id = ? AND t.status = 'completed'`,
      [scheduleId],
    );

    if (tasks.length === 0) {
      return { avgLeadTimeDays: 0, avgCycleTimeDays: 0, medianLeadTimeDays: 0, medianCycleTimeDays: 0, distribution: [] };
    }

    const taskIds = tasks.map((t: any) => t.id);
    const placeholders = taskIds.map(() => '?').join(', ');

    // Get status change activities for these tasks
    const activities = await databaseService.query(
      `SELECT task_id, new_value, created_at
       FROM task_activities
       WHERE task_id IN (${placeholders}) AND field = 'status'
       ORDER BY task_id, created_at`,
      taskIds,
    );

    // Build map: taskId -> activities
    const activityMap = new Map<string, Array<{ newValue: string; createdAt: string }>>();
    for (const a of activities) {
      const list = activityMap.get(a.task_id) || [];
      list.push({ newValue: a.new_value, createdAt: String(a.created_at) });
      activityMap.set(a.task_id, list);
    }

    const leadTimes: number[] = [];
    const cycleTimes: number[] = [];

    for (const task of tasks) {
      const acts = activityMap.get(task.id) || [];
      const createdAt = new Date(task.created_at).getTime();

      // Lead time: created_at -> completed
      const completedAct = acts.find(a => a.newValue === 'completed');
      if (completedAct) {
        const completedAt = new Date(completedAct.createdAt).getTime();
        const lt = (completedAt - createdAt) / MS_PER_DAY;
        if (lt >= 0) leadTimes.push(Math.round(lt * 10) / 10);
      }

      // Cycle time: first in_progress -> completed
      const startAct = acts.find(a => a.newValue === 'in_progress');
      if (startAct && completedAct) {
        const startedAt = new Date(startAct.createdAt).getTime();
        const completedAt = new Date(completedAct.createdAt).getTime();
        const ct = (completedAt - startedAt) / MS_PER_DAY;
        if (ct >= 0) cycleTimes.push(Math.round(ct * 10) / 10);
      }
    }

    leadTimes.sort((a, b) => a - b);
    cycleTimes.sort((a, b) => a - b);

    const avg = (arr: number[]) => arr.length === 0 ? 0 : Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10;

    // Build distribution buckets for lead time
    const buckets = [
      { label: '< 1 day', max: 1 },
      { label: '1-3 days', max: 3 },
      { label: '3-7 days', max: 7 },
      { label: '7-14 days', max: 14 },
      { label: '14+ days', max: Infinity },
    ];
    const distribution = buckets.map(b => ({ bucket: b.label, count: 0 }));
    for (const lt of leadTimes) {
      for (let i = 0; i < buckets.length; i++) {
        if (lt < buckets[i].max || i === buckets.length - 1) {
          distribution[i].count++;
          break;
        }
      }
    }

    return {
      avgLeadTimeDays: avg(leadTimes),
      avgCycleTimeDays: avg(cycleTimes),
      medianLeadTimeDays: median(leadTimes),
      medianCycleTimeDays: median(cycleTimes),
      distribution,
    };
  }
}

export const flowMetricsService = new FlowMetricsService();
