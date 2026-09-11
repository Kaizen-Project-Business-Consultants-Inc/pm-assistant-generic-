import { databaseService } from '../database/connection';
import { projectMemberService } from './ProjectMemberService';
import logger from '../utils/logger';

export interface TimeAnomaly {
  id: string;
  type: 'excessive_hours' | 'duplicate_entry' | 'weekend_work' | 'over_estimate' | 'missing_hours';
  severity: 'high' | 'medium' | 'low';
  userId: string;
  userName?: string;
  taskId?: string;
  taskName?: string;
  date: string;
  message: string;
  details: Record<string, any>;
}

export interface ComplianceStatus {
  userId: string;
  userName: string;
  weekdays: { date: string; hours: number; compliant: boolean }[];
  compliancePercent: number;
  consecutiveMissing: number;
}

export interface WeeklyReview {
  projectId: string;
  weekStart: string;
  weekEnd: string;
  totalHours: number;
  hoursByUser: { userId: string; userName: string; hours: number }[];
  anomalyCount: number;
  anomalies: TimeAnomaly[];
  compliancePercent: number;
  topTasks: { taskId: string; taskName: string; hours: number }[];
  overBudgetTasks: { taskId: string; taskName: string; estimatedHours: number; actualHours: number; overBy: number }[];
}

class TimeAnomalyService {
  /**
   * Run all anomaly detection rules for a project within a date range.
   */
  async detectAnomalies(projectId: string, startDate: string, endDate: string): Promise<TimeAnomaly[]> {
    const anomalies: TimeAnomaly[] = [];

    let entries: any[];
    try {
      entries = await databaseService.query(
        `SELECT te.id, te.task_id, te.user_id, te.date, te.hours, te.description,
                t.name AS task_name, t.estimated_days,
                u.full_name AS user_name
         FROM time_entries te
         LEFT JOIN tasks t ON t.id = te.task_id
         LEFT JOIN pmassist.users u ON u.id = te.user_id
         WHERE te.project_id = ? AND te.date BETWEEN ? AND ?
         ORDER BY te.date, te.user_id`,
        [projectId, startDate, endDate],
      );
    } catch {
      return [];
    }

    if (entries.length === 0) return [];

    // Group entries by user+date for daily checks
    const byUserDate = new Map<string, any[]>();
    for (const e of entries) {
      const key = `${e.user_id}:${String(e.date).slice(0, 10)}`;
      if (!byUserDate.has(key)) byUserDate.set(key, []);
      byUserDate.get(key)!.push(e);
    }

    // 1. Excessive daily hours (>10h/day)
    for (const [key, dayEntries] of byUserDate) {
      const totalHours = dayEntries.reduce((sum: number, e: any) => sum + Number(e.hours), 0);
      if (totalHours > 10) {
        const e = dayEntries[0];
        anomalies.push({
          id: `excessive-${key}`,
          type: 'excessive_hours',
          severity: 'high',
          userId: e.user_id,
          userName: e.user_name,
          date: String(e.date).slice(0, 10),
          message: `${e.user_name || 'User'} logged ${totalHours.toFixed(1)}h on ${String(e.date).slice(0, 10)} (exceeds 10h limit)`,
          details: { totalHours, entries: dayEntries.length },
        });
      }
    }

    // 2. Excessive weekly hours (>50h/week)
    const byUserWeek = new Map<string, { hours: number; userName: string; userId: string; weekStart: string }>();
    for (const e of entries) {
      const d = new Date(e.date);
      const dayOfWeek = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
      const weekKey = `${e.user_id}:${monday.toISOString().slice(0, 10)}`;
      if (!byUserWeek.has(weekKey)) {
        byUserWeek.set(weekKey, { hours: 0, userName: e.user_name, userId: e.user_id, weekStart: monday.toISOString().slice(0, 10) });
      }
      byUserWeek.get(weekKey)!.hours += Number(e.hours);
    }
    for (const [key, data] of byUserWeek) {
      if (data.hours > 50) {
        anomalies.push({
          id: `weekly-excessive-${key}`,
          type: 'excessive_hours',
          severity: 'medium',
          userId: data.userId,
          userName: data.userName,
          date: data.weekStart,
          message: `${data.userName || 'User'} logged ${data.hours.toFixed(1)}h in week of ${data.weekStart} (exceeds 50h limit)`,
          details: { totalHours: data.hours, weekStart: data.weekStart },
        });
      }
    }

    // 3. Duplicate entries (same user + task + date)
    const dupeMap = new Map<string, any[]>();
    for (const e of entries) {
      const key = `${e.user_id}:${e.task_id}:${String(e.date).slice(0, 10)}`;
      if (!dupeMap.has(key)) dupeMap.set(key, []);
      dupeMap.get(key)!.push(e);
    }
    for (const [, dupes] of dupeMap) {
      if (dupes.length > 1) {
        const e = dupes[0];
        anomalies.push({
          id: `duplicate-${e.user_id}-${e.task_id}-${String(e.date).slice(0, 10)}`,
          type: 'duplicate_entry',
          severity: 'medium',
          userId: e.user_id,
          userName: e.user_name,
          taskId: e.task_id,
          taskName: e.task_name,
          date: String(e.date).slice(0, 10),
          message: `${e.user_name || 'User'} has ${dupes.length} entries for "${e.task_name}" on ${String(e.date).slice(0, 10)}`,
          details: { count: dupes.length, entryIds: dupes.map((d: any) => d.id) },
        });
      }
    }

    // 4. Weekend work
    for (const e of entries) {
      const d = new Date(e.date);
      const day = d.getDay();
      if (day === 0 || day === 6) {
        anomalies.push({
          id: `weekend-${e.id}`,
          type: 'weekend_work',
          severity: 'low',
          userId: e.user_id,
          userName: e.user_name,
          taskId: e.task_id,
          taskName: e.task_name,
          date: String(e.date).slice(0, 10),
          message: `${e.user_name || 'User'} logged ${Number(e.hours).toFixed(1)}h on ${day === 0 ? 'Sunday' : 'Saturday'} (${String(e.date).slice(0, 10)})`,
          details: { hours: Number(e.hours), dayName: day === 0 ? 'Sunday' : 'Saturday' },
        });
      }
    }

    // 5. Over-estimate: actual > 150% of estimated
    const taskActuals = new Map<string, { hours: number; taskName: string; estimatedDays: number }>();
    for (const e of entries) {
      if (!e.estimated_days || Number(e.estimated_days) <= 0) continue;
      if (!taskActuals.has(e.task_id)) {
        taskActuals.set(e.task_id, { hours: 0, taskName: e.task_name, estimatedDays: Number(e.estimated_days) });
      }
      taskActuals.get(e.task_id)!.hours += Number(e.hours);
    }
    for (const [taskId, data] of taskActuals) {
      const estimatedHours = data.estimatedDays * 8;
      if (data.hours > estimatedHours * 1.5) {
        anomalies.push({
          id: `over-estimate-${taskId}`,
          type: 'over_estimate',
          severity: 'high',
          userId: '',
          taskId,
          taskName: data.taskName,
          date: startDate,
          message: `"${data.taskName}" has ${data.hours.toFixed(1)}h logged vs ${estimatedHours.toFixed(1)}h estimated (${Math.round((data.hours / estimatedHours) * 100)}%)`,
          details: { actualHours: data.hours, estimatedHours, percent: Math.round((data.hours / estimatedHours) * 100) },
        });
      }
    }

    // 6. Missing hours: <6h on a weekday with entries
    for (const [key, dayEntries] of byUserDate) {
      const e = dayEntries[0];
      const d = new Date(e.date);
      const day = d.getDay();
      if (day === 0 || day === 6) continue; // skip weekends

      const totalHours = dayEntries.reduce((sum: number, entry: any) => sum + Number(entry.hours), 0);
      if (totalHours < 6) {
        anomalies.push({
          id: `missing-${key}`,
          type: 'missing_hours',
          severity: 'low',
          userId: e.user_id,
          userName: e.user_name,
          date: String(e.date).slice(0, 10),
          message: `${e.user_name || 'User'} logged only ${totalHours.toFixed(1)}h on ${String(e.date).slice(0, 10)} (under 6h minimum)`,
          details: { totalHours, entries: dayEntries.length },
        });
      }
    }

    return anomalies;
  }

  /**
   * Get per-user compliance status for a given week.
   */
  async getComplianceStatus(projectId: string, weekStart: string): Promise<ComplianceStatus[]> {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 4); // Mon-Fri
    const endStr = end.toISOString().slice(0, 10);

    // Get project members
    let memberRows: any[];
    try {
      memberRows = await databaseService.query(
        `SELECT pm.user_id, u.full_name
         FROM project_members pm
         LEFT JOIN pmassist.users u ON u.id = pm.user_id
         WHERE pm.project_id = ?`,
        [projectId],
      );
    } catch {
      return [];
    }

    if (memberRows.length === 0) return [];

    // Get time entries for the week
    let entries: any[];
    try {
      entries = await databaseService.query(
        `SELECT user_id, date, SUM(hours) AS total_hours
         FROM time_entries
         WHERE project_id = ? AND date BETWEEN ? AND ?
         GROUP BY user_id, date`,
        [projectId, weekStart, endStr],
      );
    } catch {
      return [];
    }

    const entryMap = new Map<string, number>();
    for (const e of entries) {
      const key = `${e.user_id}:${String(e.date).slice(0, 10)}`;
      entryMap.set(key, Number(e.total_hours));
    }

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const results: ComplianceStatus[] = [];

    for (const member of memberRows) {
      const weekdays: { date: string; hours: number; compliant: boolean }[] = [];
      let compliantDays = 0;
      let totalDays = 0;
      let consecutiveMissing = 0;
      let currentStreak = 0;

      for (let i = 0; i < 5; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dateStr = d.toISOString().slice(0, 10);

        // Only check days up to today
        if (dateStr > todayStr) break;

        totalDays++;
        const hours = entryMap.get(`${member.user_id}:${dateStr}`) || 0;
        const compliant = hours >= 6;
        weekdays.push({ date: dateStr, hours, compliant });

        if (compliant) {
          compliantDays++;
          currentStreak = 0;
        } else {
          currentStreak++;
          consecutiveMissing = Math.max(consecutiveMissing, currentStreak);
        }
      }

      results.push({
        userId: member.user_id,
        userName: member.full_name || 'Unknown',
        weekdays,
        compliancePercent: totalDays > 0 ? Math.round((compliantDays / totalDays) * 100) : 100,
        consecutiveMissing,
      });
    }

    return results;
  }

  /**
   * Generate a weekly review pack for a project.
   */
  async generateWeeklyReview(projectId: string, weekStart: string): Promise<WeeklyReview> {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6); // Mon-Sun
    const endStr = end.toISOString().slice(0, 10);

    // Get all entries for the week
    let entries: any[];
    try {
      entries = await databaseService.query(
        `SELECT te.id, te.task_id, te.user_id, te.date, te.hours,
                t.name AS task_name, t.estimated_days,
                u.full_name AS user_name
         FROM time_entries te
         LEFT JOIN tasks t ON t.id = te.task_id
         LEFT JOIN pmassist.users u ON u.id = te.user_id
         WHERE te.project_id = ? AND te.date BETWEEN ? AND ?`,
        [projectId, weekStart, endStr],
      );
    } catch {
      return {
        projectId, weekStart, weekEnd: endStr,
        totalHours: 0, hoursByUser: [], anomalyCount: 0, anomalies: [],
        compliancePercent: 100, topTasks: [], overBudgetTasks: [],
      };
    }

    // Total hours
    const totalHours = entries.reduce((sum: number, e: any) => sum + Number(e.hours), 0);

    // Hours by user
    const userHoursMap = new Map<string, { userId: string; userName: string; hours: number }>();
    for (const e of entries) {
      if (!userHoursMap.has(e.user_id)) {
        userHoursMap.set(e.user_id, { userId: e.user_id, userName: e.user_name || 'Unknown', hours: 0 });
      }
      userHoursMap.get(e.user_id)!.hours += Number(e.hours);
    }
    const hoursByUser = Array.from(userHoursMap.values()).sort((a, b) => b.hours - a.hours);

    // Top tasks by hours
    const taskHoursMap = new Map<string, { taskId: string; taskName: string; hours: number; estimatedDays: number }>();
    for (const e of entries) {
      if (!taskHoursMap.has(e.task_id)) {
        taskHoursMap.set(e.task_id, { taskId: e.task_id, taskName: e.task_name || 'Unknown', hours: 0, estimatedDays: Number(e.estimated_days) || 0 });
      }
      taskHoursMap.get(e.task_id)!.hours += Number(e.hours);
    }
    const topTasks = Array.from(taskHoursMap.values())
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10)
      .map(({ taskId, taskName, hours }) => ({ taskId, taskName, hours }));

    // Over-budget tasks
    const overBudgetTasks = Array.from(taskHoursMap.values())
      .filter(t => t.estimatedDays > 0)
      .map(t => {
        const estimatedHours = t.estimatedDays * 8;
        return {
          taskId: t.taskId,
          taskName: t.taskName,
          estimatedHours,
          actualHours: t.hours,
          overBy: t.hours - estimatedHours,
        };
      })
      .filter(t => t.overBy > 0)
      .sort((a, b) => b.overBy - a.overBy);

    // Anomalies
    const anomalies = await this.detectAnomalies(projectId, weekStart, endStr);

    // Compliance
    const compliance = await this.getComplianceStatus(projectId, weekStart);
    const compliancePercent = compliance.length > 0
      ? Math.round(compliance.reduce((sum, c) => sum + c.compliancePercent, 0) / compliance.length)
      : 100;

    return {
      projectId,
      weekStart,
      weekEnd: endStr,
      totalHours,
      hoursByUser,
      anomalyCount: anomalies.length,
      anomalies,
      compliancePercent,
      topTasks,
      overBudgetTasks,
    };
  }
}

export const timeAnomalyService = new TimeAnomalyService();
