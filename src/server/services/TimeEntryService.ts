import { v4 as uuidv4 } from 'uuid';
import { timeEntryRepository, TimeEntry } from '../database/TimeEntryRepository';
import { scheduleService } from './ScheduleService';

export type { TimeEntry } from '../database/TimeEntryRepository';

export class TimeEntryService {

  async create(data: {
    taskId: string;
    scheduleId: string;
    projectId: string;
    userId: string;
    date: string;
    hours: number;
    description?: string;
    billable?: boolean;
  }): Promise<TimeEntry> {
    const id = uuidv4();
    return timeEntryRepository.insert(
      id, data.taskId, data.scheduleId, data.projectId, data.userId,
      data.date, data.hours, data.description || null, data.billable !== false,
    );
  }

  async update(id: string, data: { date?: string; hours?: number; description?: string; billable?: boolean }): Promise<TimeEntry> {
    const entry = await timeEntryRepository.findById(id);
    if (entry && (entry.status === 'submitted' || entry.status === 'approved')) {
      throw Object.assign(new Error('Cannot edit a time entry that has been submitted or approved'), { statusCode: 409 });
    }
    const sets: string[] = [];
    const params: any[] = [];
    if (data.date !== undefined) { sets.push('date = ?'); params.push(data.date); }
    if (data.hours !== undefined) { sets.push('hours = ?'); params.push(data.hours); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.billable !== undefined) { sets.push('billable = ?'); params.push(data.billable); }
    await timeEntryRepository.updateFields(id, sets, params);
    return (await timeEntryRepository.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    const entry = await timeEntryRepository.findById(id);
    if (entry && (entry.status === 'submitted' || entry.status === 'approved')) {
      throw Object.assign(new Error('Cannot delete a time entry that has been submitted or approved'), { statusCode: 409 });
    }
    await timeEntryRepository.deleteById(id);
  }

  async getByTask(taskId: string): Promise<TimeEntry[]> {
    return timeEntryRepository.findByTask(taskId);
  }

  async getByProject(projectId: string, startDate?: string, endDate?: string, userId?: string): Promise<TimeEntry[]> {
    return timeEntryRepository.findByProject(projectId, startDate, endDate, userId);
  }

  async getWeeklyTimesheet(userId: string, weekStart: string): Promise<{
    entries: TimeEntry[];
    days: string[];
    totalHours: number;
  }> {
    const start = new Date(weekStart);
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
    const endDate = days[6];

    const entries = await timeEntryRepository.findByUserAndDateRange(userId, weekStart, endDate);
    const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
    return { entries, days, totalHours };
  }

  async getActualVsEstimated(scheduleId: string): Promise<{
    tasks: Array<{
      taskId: string;
      taskName: string;
      estimatedHours: number;
      actualHours: number;
    }>;
  }> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const rows = await timeEntryRepository.sumHoursBySchedule(scheduleId);
    const actualMap = new Map(rows.map(r => [r.task_id, Number(r.total)]));

    return {
      tasks: tasks.map(t => ({
        taskId: t.id,
        taskName: t.name,
        estimatedHours: (t.estimatedDays || 0) * 8,
        actualHours: actualMap.get(t.id) || 0,
      })),
    };
  }
  // Submitting and approving timesheets: WeeklyTimesheetService (one per person per week,
  // approved by their line manager — 2026-10-02).
}

export const timeEntryService = new TimeEntryService();
