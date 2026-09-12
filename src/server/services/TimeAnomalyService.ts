import { databaseService } from '../database/connection';
import { projectMemberService } from './ProjectMemberService';
import { timeEntryRepository } from '../database/TimeEntryRepository';
import { config } from '../config';
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
  narrative?: string;
}

export interface BurndownForecast {
  dataPoints: { date: string; cumulative: number }[];
  budgetHours: number;
  actualHours: number;
  projectedFinishDate: string | null;
  burnRate: number;
  isOverBudget: boolean;
}

export interface TrendAnalysis {
  weeks: { weekStart: string; hours: number; delta: number | null; rollingAvg: number }[];
  velocityTrend: 'increasing' | 'decreasing' | 'stable';
  avgWeeklyHours: number;
  peakWeek: { weekStart: string; hours: number } | null;
}

export interface HeatmapCell {
  userId: string;
  date: string;
  hours: number;
  utilization: number;
}

export interface UtilizationHeatmapData {
  users: { userId: string; userName: string }[];
  dates: string[];
  cells: HeatmapCell[];
  summary: { userId: string; userName: string; avgHours: number; avgUtilization: number }[];
}

export type TimeCategory = 'meeting' | 'admin' | 'productive';

export interface AnomalyExplanation {
  rootCause: string;
  suggestedActions: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface TimeSuggestion {
  taskName: string;
  taskId?: string;
  hours: number;
  description?: string;
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

    // AI narrative (Feature 3)
    let narrative: string | undefined;
    try {
      narrative = await this.generateWeeklyNarrative({
        projectId, weekStart, weekEnd: endStr, totalHours, hoursByUser,
        anomalyCount: anomalies.length, anomalies, compliancePercent, topTasks, overBudgetTasks,
      });
    } catch (err) {
      logger.warn('[TimeAnomaly] Narrative generation failed, skipping', { error: err });
    }

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
      narrative,
    };
  }

  // ---------------------------------------------------------------------------
  // Feature 5: Burndown Forecast
  // ---------------------------------------------------------------------------
  async getBurndownForecast(projectId: string): Promise<BurndownForecast> {
    let dailyRows: any[];
    try {
      dailyRows = await databaseService.query(
        `SELECT DATE(date) AS d, SUM(hours) AS hours
         FROM time_entries WHERE project_id = ?
         GROUP BY d ORDER BY d`,
        [projectId],
      );
    } catch {
      dailyRows = [];
    }

    let budgetRows: any[];
    try {
      budgetRows = await databaseService.query(
        `SELECT SUM(t.estimated_days) * 8 AS budget_hours
         FROM tasks t
         JOIN schedules s ON s.id = t.schedule_id
         WHERE s.project_id = ? AND t.estimated_days > 0`,
        [projectId],
      );
    } catch {
      budgetRows = [{ budget_hours: 0 }];
    }

    const budgetHours = Number(budgetRows[0]?.budget_hours) || 0;
    let cumulative = 0;
    const dataPoints: { date: string; cumulative: number }[] = [];
    for (const row of dailyRows) {
      cumulative += Number(row.hours);
      dataPoints.push({ date: String(row.d).slice(0, 10), cumulative });
    }

    const actualHours = cumulative;
    const isOverBudget = budgetHours > 0 && actualHours > budgetHours;

    // Compute average daily velocity from days that have entries
    const totalDaysWithEntries = dataPoints.length;
    const burnRate = totalDaysWithEntries > 0 ? actualHours / totalDaysWithEntries : 0;

    // Project finish date
    let projectedFinishDate: string | null = null;
    if (budgetHours > 0 && burnRate > 0 && actualHours < budgetHours) {
      const remainingHours = budgetHours - actualHours;
      const remainingDays = Math.ceil(remainingHours / burnRate);
      const lastDate = dataPoints.length > 0 ? new Date(dataPoints[dataPoints.length - 1].date) : new Date();
      lastDate.setDate(lastDate.getDate() + remainingDays);
      projectedFinishDate = lastDate.toISOString().slice(0, 10);
    }

    return { dataPoints, budgetHours, actualHours, projectedFinishDate, burnRate, isOverBudget };
  }

  // ---------------------------------------------------------------------------
  // Feature 6: Trend Analysis
  // ---------------------------------------------------------------------------
  async getTrendAnalysis(projectId: string, weeks: number = 12): Promise<TrendAnalysis> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - weeks * 7);

    const rows = await timeEntryRepository.sumHoursByProjectAndWeekRange(
      projectId,
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10),
    );

    const weekData: TrendAnalysis['weeks'] = [];
    let prevHours: number | null = null;

    for (let i = 0; i < rows.length; i++) {
      const { weekStart, totalHours } = rows[i];
      const delta = prevHours !== null ? ((totalHours - prevHours) / (prevHours || 1)) * 100 : null;

      // 4-week rolling average
      const windowStart = Math.max(0, i - 3);
      const windowSlice = rows.slice(windowStart, i + 1);
      const rollingAvg = windowSlice.reduce((s, r) => s + r.totalHours, 0) / windowSlice.length;

      weekData.push({ weekStart, hours: totalHours, delta: delta !== null ? Math.round(delta) : null, rollingAvg: Math.round(rollingAvg * 10) / 10 });
      prevHours = totalHours;
    }

    const avgWeeklyHours = rows.length > 0 ? rows.reduce((s, r) => s + r.totalHours, 0) / rows.length : 0;
    const peakWeek = rows.length > 0 ? rows.reduce((max, r) => r.totalHours > max.totalHours ? r : max) : null;

    // Determine trend from last 4 weeks
    let velocityTrend: TrendAnalysis['velocityTrend'] = 'stable';
    if (weekData.length >= 4) {
      const recent = weekData.slice(-4);
      let increasing = 0, decreasing = 0;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i].hours > recent[i - 1].hours) increasing++;
        else if (recent[i].hours < recent[i - 1].hours) decreasing++;
      }
      if (increasing >= 2) velocityTrend = 'increasing';
      else if (decreasing >= 2) velocityTrend = 'decreasing';
    }

    return {
      weeks: weekData,
      velocityTrend,
      avgWeeklyHours: Math.round(avgWeeklyHours * 10) / 10,
      peakWeek: peakWeek ? { weekStart: peakWeek.weekStart, hours: peakWeek.totalHours } : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Feature 7: Team Utilization Heatmap
  // ---------------------------------------------------------------------------
  async getUtilizationHeatmap(projectId: string, startDate: string, endDate: string): Promise<UtilizationHeatmapData> {
    let rows: any[];
    try {
      rows = await databaseService.query(
        `SELECT te.user_id, DATE(te.date) AS d, SUM(te.hours) AS hours, u.full_name AS user_name
         FROM time_entries te
         LEFT JOIN pmassist.users u ON u.id = te.user_id
         WHERE te.project_id = ? AND te.date BETWEEN ? AND ?
         GROUP BY te.user_id, d, u.full_name
         ORDER BY u.full_name, d`,
        [projectId, startDate, endDate],
      );
    } catch {
      rows = [];
    }

    const usersMap = new Map<string, string>();
    const datesSet = new Set<string>();
    const cells: HeatmapCell[] = [];

    for (const row of rows) {
      const userId = row.user_id;
      const date = String(row.d).slice(0, 10);
      const hours = Number(row.hours);
      usersMap.set(userId, row.user_name || 'Unknown');
      datesSet.add(date);
      cells.push({ userId, date, hours, utilization: Math.round((hours / 8) * 100) });
    }

    const users = Array.from(usersMap.entries()).map(([userId, userName]) => ({ userId, userName }));
    const dates = Array.from(datesSet).sort();

    // Summary per user
    const summary = users.map(u => {
      const userCells = cells.filter(c => c.userId === u.userId);
      const avgHours = userCells.length > 0 ? userCells.reduce((s, c) => s + c.hours, 0) / userCells.length : 0;
      return { userId: u.userId, userName: u.userName, avgHours: Math.round(avgHours * 10) / 10, avgUtilization: Math.round((avgHours / 8) * 100) };
    });

    return { users, dates, cells, summary };
  }

  // ---------------------------------------------------------------------------
  // Feature 8: Auto-Categorization
  // ---------------------------------------------------------------------------
  categorizeEntry(taskName: string, description?: string): TimeCategory {
    const text = `${taskName || ''} ${description || ''}`.toLowerCase();
    if (/\b(meeting|standup|stand-up|review|sync|call|demo|retro|retrospective)\b/.test(text)) return 'meeting';
    if (/\b(admin|planning|setup|onboard|onboarding|document|documentation|report|status|email|timesheet)\b/.test(text)) return 'admin';
    return 'productive';
  }

  // ---------------------------------------------------------------------------
  // Feature 1: Smart Time Suggestions (AI with fallback)
  // ---------------------------------------------------------------------------
  async getTimeSuggestion(userId: string, projectId: string, date: string): Promise<TimeSuggestion | null> {
    // Fetch last 10 user entries for this project
    let recentEntries: any[];
    try {
      recentEntries = await databaseService.query(
        `SELECT te.hours, te.description, t.name AS task_name, t.id AS task_id, te.date
         FROM time_entries te
         LEFT JOIN tasks t ON t.id = te.task_id
         WHERE te.user_id = ? AND te.project_id = ?
         ORDER BY te.date DESC, te.created_at DESC
         LIMIT 10`,
        [userId, projectId],
      );
    } catch {
      return null;
    }

    if (recentEntries.length === 0) return null;

    // Try AI suggestion
    if (config.AI_ENABLED) {
      try {
        const { claudeService } = await import('./claudeService');
        const { z } = await import('zod');

        const activeTasks = await databaseService.query(
          `SELECT t.id, t.name FROM tasks t
           JOIN schedules s ON s.id = t.schedule_id
           WHERE s.project_id = ? AND t.status NOT IN ('completed', 'cancelled')
           LIMIT 20`,
          [projectId],
        );

        const result = await claudeService.completeWithJsonSchema({
          systemPrompt: 'You are a time tracking assistant. Based on the user\'s recent time entries and active tasks, predict what task they are most likely to log time for today. Return a JSON object.',
          userMessage: `Recent entries:\n${recentEntries.map(e => `- ${e.task_name}: ${e.hours}h on ${String(e.date).slice(0, 10)} "${e.description || ''}"` ).join('\n')}\n\nActive tasks:\n${activeTasks.map((t: any) => `- ${t.name} (${t.id})`).join('\n')}\n\nDate: ${date}\nPredict the most likely task, hours, and optional description.`,
          schema: z.object({
            taskName: z.string(),
            taskId: z.string().optional(),
            hours: z.number(),
            description: z.string().optional(),
          }),
          maxTokens: 200,
          temperature: 0.3,
        });

        return result.data;
      } catch (err) {
        logger.warn('[TimeAnomaly] AI suggestion failed, using fallback', { error: err });
      }
    }

    // Fallback: most frequently logged task + modal hours
    const taskFreq = new Map<string, { count: number; taskName: string; taskId: string; totalHours: number }>();
    for (const e of recentEntries) {
      const key = e.task_id;
      if (!key) continue;
      if (!taskFreq.has(key)) taskFreq.set(key, { count: 0, taskName: e.task_name, taskId: key, totalHours: 0 });
      const f = taskFreq.get(key)!;
      f.count++;
      f.totalHours += Number(e.hours);
    }

    if (taskFreq.size === 0) return null;
    const top = Array.from(taskFreq.values()).sort((a, b) => b.count - a.count)[0];
    return { taskName: top.taskName, taskId: top.taskId, hours: Math.round((top.totalHours / top.count) * 4) / 4 };
  }

  // ---------------------------------------------------------------------------
  // Feature 2: Anomaly Explanations (AI with fallback)
  // ---------------------------------------------------------------------------
  async explainAnomaly(anomaly: TimeAnomaly, projectId: string): Promise<AnomalyExplanation> {
    if (config.AI_ENABLED) {
      try {
        const { claudeService } = await import('./claudeService');
        const { z } = await import('zod');

        // Get some context
        let recentEntries: any[];
        try {
          recentEntries = await databaseService.query(
            `SELECT te.hours, te.date, t.name AS task_name, u.full_name AS user_name
             FROM time_entries te
             LEFT JOIN tasks t ON t.id = te.task_id
             LEFT JOIN pmassist.users u ON u.id = te.user_id
             WHERE te.project_id = ?
             ORDER BY te.date DESC LIMIT 20`,
            [projectId],
          );
        } catch {
          recentEntries = [];
        }

        const result = await claudeService.completeWithJsonSchema({
          systemPrompt: 'You are a time tracking analyst. Analyze the given anomaly and project context to determine the root cause and suggest corrective actions. Be concise.',
          userMessage: `Anomaly: ${anomaly.type} — "${anomaly.message}"\nSeverity: ${anomaly.severity}\nDetails: ${JSON.stringify(anomaly.details)}\n\nRecent project entries:\n${recentEntries.slice(0, 10).map(e => `- ${e.user_name}: ${e.hours}h on ${String(e.date).slice(0, 10)} for "${e.task_name}"`).join('\n')}`,
          schema: z.object({
            rootCause: z.string(),
            suggestedActions: z.array(z.string()),
            riskLevel: z.enum(['low', 'medium', 'high']),
          }),
          maxTokens: 300,
          temperature: 0.3,
        });

        return result.data;
      } catch (err) {
        logger.warn('[TimeAnomaly] AI explanation failed, using fallback', { error: err });
      }
    }

    // Static fallback
    const fallbacks: Record<string, AnomalyExplanation> = {
      excessive_hours: { rootCause: 'User logged more hours than expected for a single day or week.', suggestedActions: ['Verify entries are accurate', 'Check if overtime was approved', 'Review task scope'], riskLevel: 'medium' },
      duplicate_entry: { rootCause: 'Multiple time entries exist for the same user, task, and date.', suggestedActions: ['Review and merge duplicate entries', 'Check for accidental double submissions'], riskLevel: 'low' },
      weekend_work: { rootCause: 'Time was logged on a weekend day.', suggestedActions: ['Confirm weekend work was authorized', 'Check if entry date is correct'], riskLevel: 'low' },
      over_estimate: { rootCause: 'Actual hours significantly exceed the original task estimate.', suggestedActions: ['Review task scope for creep', 'Update estimate to reflect reality', 'Break task into smaller units'], riskLevel: 'high' },
      missing_hours: { rootCause: 'User logged fewer hours than the minimum expected for a weekday.', suggestedActions: ['Remind user to log remaining hours', 'Check if user was on leave'], riskLevel: 'low' },
    };

    return fallbacks[anomaly.type] || { rootCause: 'Unknown anomaly type.', suggestedActions: ['Review the anomaly details manually.'], riskLevel: 'medium' };
  }

  // ---------------------------------------------------------------------------
  // Feature 3: Weekly Review Narrative (AI with fallback)
  // ---------------------------------------------------------------------------
  async generateWeeklyNarrative(review: Omit<WeeklyReview, 'narrative'>): Promise<string> {
    if (config.AI_ENABLED) {
      try {
        const { claudeService } = await import('./claudeService');

        const result = await claudeService.complete({
          systemPrompt: 'You are a project management assistant. Write a 2-3 sentence plain-language summary of the weekly time review data provided. Be concise and highlight the most important insights. Do not use markdown.',
          userMessage: `Week: ${review.weekStart} to ${review.weekEnd}\nTotal hours: ${review.totalHours.toFixed(1)}h\nContributors: ${review.hoursByUser.length}\nTop tasks: ${review.topTasks.slice(0, 3).map(t => `${t.taskName} (${t.hours.toFixed(1)}h)`).join(', ')}\nAnomalies: ${review.anomalyCount}\nCompliance: ${review.compliancePercent}%\nOver-budget tasks: ${review.overBudgetTasks.length}`,
          maxTokens: 150,
          temperature: 0.5,
        });

        return result.content.trim();
      } catch (err) {
        logger.warn('[TimeAnomaly] AI narrative failed, using fallback', { error: err });
      }
    }

    // Template-based fallback
    const parts = [`The team logged ${review.totalHours.toFixed(1)} hours this week across ${review.hoursByUser.length} contributor(s).`];
    if (review.anomalyCount > 0) parts.push(`${review.anomalyCount} anomalies were detected.`);
    if (review.overBudgetTasks.length > 0) parts.push(`${review.overBudgetTasks.length} task(s) are over budget.`);
    if (review.compliancePercent < 80) parts.push(`Compliance is at ${review.compliancePercent}% — below the 80% target.`);
    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------
  // Feature 4: Utilization Coaching Tip (AI with fallback)
  // ---------------------------------------------------------------------------
  async generateCoachingTip(userName: string, pattern: 'under' | 'over', avgDailyHours: number, projectName: string): Promise<string> {
    if (config.AI_ENABLED) {
      try {
        const { claudeService } = await import('./claudeService');

        const result = await claudeService.complete({
          systemPrompt: 'You are a supportive project management coach. Write a brief, encouraging 1-paragraph coaching tip for a team member based on their time utilization pattern. Be specific and actionable. Do not use markdown.',
          userMessage: `Team member: ${userName}\nProject: ${projectName}\nPattern: ${pattern === 'under' ? 'Under-utilized' : 'Over-utilized'}\nAverage daily hours: ${avgDailyHours.toFixed(1)}h (target: 8h)\n${pattern === 'under' ? 'They are logging significantly fewer hours than expected.' : 'They are consistently logging more hours than sustainable.'}`,
          maxTokens: 150,
          temperature: 0.6,
        });

        return result.content.trim();
      } catch (err) {
        logger.warn('[TimeAnomaly] AI coaching tip failed, using fallback', { error: err });
      }
    }

    // Static fallback
    if (pattern === 'under') {
      return `Hi ${userName}, your average daily hours on ${projectName} have been ${avgDailyHours.toFixed(1)}h, which is below the expected 8h target. If you're blocked or need support, please reach out to your project manager.`;
    }
    return `Hi ${userName}, you've been averaging ${avgDailyHours.toFixed(1)}h/day on ${projectName}, which is above the sustainable 8h target. Consider delegating tasks or discussing workload redistribution with your manager to avoid burnout.`;
  }
}

export const timeAnomalyService = new TimeAnomalyService();
