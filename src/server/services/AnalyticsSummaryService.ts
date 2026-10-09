import { analyticsSummaryRepository } from '../database/AnalyticsSummaryRepository';
import { readableProjectIds } from '../utils/readableProjects';
import { utcDay } from '../utils/workingDays';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrendDirection = 'improving' | 'declining' | 'stable';

export interface TrendIndicators {
  overdueTasksTrend: TrendDirection;
  completionRateTrend: TrendDirection;
  healthTrend: TrendDirection;
}

export interface AnalyticsSummary {
  portfolio: {
    totalProjects: number;
    byStatus: Record<string, number>;
    avgProgress: number;
    atRiskProjects: Array<{ id: string; name: string; reason: string }>;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    overdue: number;
    completedLast30Days: number;
  };
  budget: {
    totalAllocated: number;
    totalSpent: number;
    utilizationPercent: number;
    projectsOverBudget: Array<{ id: string; name: string; overrunPercent: number }>;
  };
  trends: {
    tasksCompletedByWeek: Array<{ week: string; count: number }>;
  };
  trendIndicators?: TrendIndicators;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Portfolio totals leave the read-only sample project out; its own summary still shows its numbers. */
const NOT_SAMPLE = 'COALESCE(p.is_demo, 0) = 0';

class AnalyticsSummaryService {
  // -----------------------------------------------------------------------
  // Full portfolio summary for a user
  // -----------------------------------------------------------------------
  async getSummary(userId: string, role: string): Promise<AnalyticsSummary> {
    // The projects you can read — created, member of, or the sample project — the same rule as
    // the dashboard list and the Morning Briefing (2026-10-01: "created by you" only, so the
    // Overdue tile said 0 above a briefing listing 5 late tasks on the sample project)
    const readable = await readableProjectIds({ userId, role });
    if (readable === 'all') return this.getSummaryAll();
    const ids = [...readable];
    if (ids.length === 0) return this.buildSummary('1 = 0', []);
    // ...but the sample project never counts in the totals (it stays on the project list)
    return this.buildSummary(`(p.id IN (${ids.map(() => '?').join(',')})) AND ${NOT_SAMPLE}`, ids);
  }

  // -----------------------------------------------------------------------
  // Full portfolio summary across all projects (no user filter)
  // -----------------------------------------------------------------------
  async getSummaryAll(): Promise<AnalyticsSummary> {
    return this.buildSummary(NOT_SAMPLE, []);
  }

  // -----------------------------------------------------------------------
  // Single-project summary
  // -----------------------------------------------------------------------
  async getProjectSummary(projectId: string): Promise<AnalyticsSummary> {
    const projectCondition = `(p.id = ?)`;
    const projectParams: any[] = [projectId];

    return this.buildSummary(projectCondition, projectParams);
  }

  // -----------------------------------------------------------------------
  // Shared builder
  // -----------------------------------------------------------------------
  private async buildSummary(
    projectCondition: string,
    projectParams: any[],
  ): Promise<AnalyticsSummary> {
    // 1. Fetch matching projects
    const projects = await analyticsSummaryRepository.findProjects(projectCondition, projectParams);

    // 2. Portfolio stats
    const byStatus: Record<string, number> = {};
    let totalAllocated = 0;
    let totalSpent = 0;
    const atRiskProjects: Array<{ id: string; name: string; reason: string }> = [];
    const atRiskIds = new Set<string>(); // ids already in atRiskProjects
    const overBudgetProjects: Array<{ id: string; name: string; overrunPercent: number }> = [];

    const projectIds = projects.map((p) => p.id);

    for (const p of projects) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;

      const allocated = Number(p.budget_allocated) || 0;
      const spent = Number(p.budget_spent) || 0;
      totalAllocated += allocated;
      totalSpent += spent;

      // At-risk: budget utilisation > 80 %
      if (allocated > 0 && spent / allocated > 0.8) {
        atRiskIds.add(p.id);
        atRiskProjects.push({
          id: p.id,
          name: p.name,
          reason: `Budget utilisation at ${((spent / allocated) * 100).toFixed(0)}%`,
        });
      }

      // Also at-risk: behind schedule (progress < expected based on timeline)
      if (p.start_date && p.end_date) {
        const start = new Date(p.start_date).getTime();
        const end = new Date(p.end_date).getTime();
        const now = utcDay(new Date()).getTime(); // today, not this moment
        if (end > start && now > start) {
          const elapsed = Math.min(1, (now - start) / (end - start));
          const actualProgress = Number(p.progress) || 0;
          if (elapsed > 0.3 && actualProgress < elapsed * 100 - 20) {
            // Only flag if not already flagged for budget
            if (!atRiskIds.has(p.id)) {
              atRiskIds.add(p.id);
              atRiskProjects.push({
                id: p.id,
                name: p.name,
                reason: `Progress ${actualProgress.toFixed(0)}% vs expected ${(elapsed * 100).toFixed(0)}%`,
              });
            }
          }
        }
      }

      // Over budget
      if (allocated > 0 && spent > allocated) {
        overBudgetProjects.push({
          id: p.id,
          name: p.name,
          overrunPercent: Math.round(((spent - allocated) / allocated) * 100),
        });
      }
    }

    const utilizationPercent =
      totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0;

    // 3. Task stats — only for projects that belong to this user
    let tasksByStatus: Record<string, number> = {};
    let totalTasks = 0;
    let overdueCount = 0;
    let completedLast30 = 0;
    let weeklyTrends: Array<{ week: string; count: number }> = [];

    if (projectIds.length > 0) {
      // Tasks by status
      const taskStatusRows = await analyticsSummaryRepository.getTaskStatusCounts(projectIds);
      for (const row of taskStatusRows) {
        tasksByStatus[row.status] = Number(row.cnt);
        totalTasks += Number(row.cnt);
      }

      // Overdue tasks
      overdueCount = await analyticsSummaryRepository.getOverdueCount(projectIds);

      // Completed in last 30 days
      completedLast30 = await analyticsSummaryRepository.getCompletedLast30Days(projectIds);

      // Trends: tasks completed by week (last 12 weeks)
      const weekRows = await analyticsSummaryRepository.getWeeklyCompletionTrends(projectIds);
      weeklyTrends = weekRows.map((r) => ({
        week: r.week_label,
        count: Number(r.cnt),
      }));
    }

    // Average progress — use task completion ratio as proxy
    const avgProgress =
      totalTasks > 0
        ? Math.round(
            (((tasksByStatus['completed'] || 0) + (tasksByStatus['done'] || 0)) / totalTasks) * 100,
          )
        : 0;

    // Trend indicators (7-day comparison)
    let trendIndicators: TrendIndicators | undefined;
    if (projectIds.length > 0) {
      try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
        const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);

        const [overdueWeekAgo, completedThisWeek, completedLastWeek, healthNow, healthWeekAgo] =
          await Promise.all([
            analyticsSummaryRepository.getOverdueCountAtDate(projectIds, sevenDaysAgo),
            analyticsSummaryRepository.getCompletedInRange(projectIds, sevenDaysAgo, now),
            analyticsSummaryRepository.getCompletedInRange(projectIds, fourteenDaysAgo, sevenDaysAgo),
            analyticsSummaryRepository.getAvgHealthScoreAtDate(projectIds, now),
            analyticsSummaryRepository.getAvgHealthScoreAtDate(projectIds, sevenDaysAgo),
          ]);

        // Overdue: fewer is better → improving if current < week ago
        const overdueTasksTrend: TrendDirection =
          overdueCount < overdueWeekAgo ? 'improving' : overdueCount > overdueWeekAgo ? 'declining' : 'stable';

        // Completions: more is better → improving if this week > last week
        const completionRateTrend: TrendDirection =
          completedThisWeek > completedLastWeek ? 'improving' : completedThisWeek < completedLastWeek ? 'declining' : 'stable';

        // Health: higher is better, ±3 threshold for stable
        let healthTrend: TrendDirection = 'stable';
        if (healthNow != null && healthWeekAgo != null) {
          const delta = healthNow - healthWeekAgo;
          healthTrend = delta > 3 ? 'improving' : delta < -3 ? 'declining' : 'stable';
        }

        trendIndicators = { overdueTasksTrend, completionRateTrend, healthTrend };
      } catch {
        // Non-critical — omit trend indicators on failure
      }
    }

    return {
      portfolio: {
        totalProjects: projects.length,
        byStatus,
        avgProgress,
        atRiskProjects,
      },
      tasks: {
        total: totalTasks,
        byStatus: tasksByStatus,
        overdue: overdueCount,
        completedLast30Days: completedLast30,
      },
      budget: {
        totalAllocated,
        totalSpent,
        utilizationPercent,
        projectsOverBudget: overBudgetProjects,
      },
      trends: {
        tasksCompletedByWeek: weeklyTrends,
      },
      trendIndicators,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const analyticsSummaryService = new AnalyticsSummaryService();
