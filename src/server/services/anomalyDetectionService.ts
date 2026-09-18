import { FastifyInstance } from 'fastify';
import { AIContextBuilder, ProjectContext } from './aiContextBuilder';
import { claudeService, PromptTemplate } from './claudeService';
import { logAIUsage } from './aiUsageLogger';
import type { AIAnomaly, AIAnomalyReport } from '../schemas/phase5Schemas';
import { isOverdue, toCalendarDate, CalendarDate } from '../utils/calendarDate';
import { statusDateFor } from './StatusDateService';

// ---------------------------------------------------------------------------
// Prompt Template
// ---------------------------------------------------------------------------

const anomalyExplanationPrompt = new PromptTemplate(
  `You are a project anomaly analyst. Review the detected anomalies below and provide root-cause analysis, prioritized recommendations, and an overall health trend assessment.

Detected anomalies:
{{anomalies}}

Portfolio context:
{{portfolioContext}}

Return a JSON object with:
- "anomalies": the same array but with enhanced "description" and "recommendation" fields
- "summary": a 1-2 sentence summary of the portfolio's anomaly state
- "overallHealthTrend": "improving" | "stable" | "deteriorating"`,
  '1.0.0',
);

// ---------------------------------------------------------------------------
// Helper: compute metrics from ProjectContext
// ---------------------------------------------------------------------------

/**
 * Metrics are measured as at the project's status date, not the clock — so the figures
 * in a report do not change while someone is reading it, and two people in different
 * countries see the same answer. See services/StatusDateService.ts.
 */
function computeMetricsFromContext(ctx: ProjectContext, statusDate: CalendarDate): {
  completionRate: number;
  budgetUtilization: number;
  totalTasks: number;
  overdueTasks: number;
  daysElapsed: number;
  daysRemaining: number;
} {
  const allTasks = ctx.schedules.flatMap(s => s.tasks);
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter(t => t.status === 'completed').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const overdueTasks = allTasks.filter(
    t => t.status !== 'completed' && t.dueDate && isOverdue(t.dueDate, statusDate),
  ).length;

  const now = toCalendarDate(statusDate) ?? new Date();
  const startDate = ctx.project.startDate ? new Date(ctx.project.startDate) : now;
  const endDate = ctx.project.endDate
    ? new Date(ctx.project.endDate)
    : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const daysElapsed = Math.max(0, Math.round((now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  const daysRemaining = Math.max(0, Math.round((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

  const budgetAllocated = ctx.project.budgetAllocated || 0;
  const budgetSpent = ctx.project.budgetSpent || 0;
  const budgetUtilization = budgetAllocated > 0 ? (budgetSpent / budgetAllocated) * 100 : 0;

  return { completionRate, budgetUtilization, totalTasks, overdueTasks, daysElapsed, daysRemaining };
}

// ---------------------------------------------------------------------------
// AnomalyDetectionService
// ---------------------------------------------------------------------------

export class AnomalyDetectionService {
  private contextBuilder: AIContextBuilder;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.contextBuilder = new AIContextBuilder(fastify);
  }

  // -----------------------------------------------------------------------
  // Portfolio-wide anomaly scan
  // -----------------------------------------------------------------------

  async detectPortfolioAnomalies(
    userId?: string,
  ): Promise<AIAnomalyReport> {
    const portfolio = await this.contextBuilder.buildPortfolioContext();
    const anomalies: AIAnomaly[] = [];

    for (const p of portfolio.projects) {
      if (p.status !== 'active' && p.status !== 'in_progress') continue;
      const projectAnomalies = await this.detectForProject(p.id, p.name);
      anomalies.push(...projectAnomalies);
    }

    // Sort by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const deterministicReport: AIAnomalyReport = {
      anomalies,
      summary: anomalies.length === 0
        ? 'No anomalies detected across the portfolio.'
        : `${anomalies.length} anomalie(s) detected across ${portfolio.projects.length} projects.`,
      overallHealthTrend: this.inferHealthTrend(anomalies),
      scannedProjects: portfolio.projects.length,
      aiPowered: false,
    };

    if (!claudeService.isAvailable() || anomalies.length === 0) {
      return deterministicReport;
    }

    // Claude enhancement
    try {
      const portfolioPrompt = this.contextBuilder.portfolioToPromptString(portfolio);
      const anomaliesStr = JSON.stringify(anomalies, null, 2);

      const systemPrompt = anomalyExplanationPrompt.render({
        anomalies: anomaliesStr,
        portfolioContext: portfolioPrompt,
      });

      const result = await claudeService.complete({
        systemPrompt,
        userMessage: 'Analyze the anomalies and return the enhanced JSON.',
        responseFormat: 'json',
        temperature: 0.3,
      });

      logAIUsage({
        userId,
        feature: 'anomaly_detection',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
        requestContext: {},
      });

      const parsed = JSON.parse(result.content);
      return {
        anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : anomalies,
        summary: parsed.summary || deterministicReport.summary,
        overallHealthTrend: parsed.overallHealthTrend || deterministicReport.overallHealthTrend,
        scannedProjects: portfolio.projects.length,
        aiPowered: true,
      };
    } catch (err) {
      this.fastify.log.warn({ err }, 'AI anomaly enhancement failed, using deterministic results');
      return deterministicReport;
    }
  }

  // -----------------------------------------------------------------------
  // Single project anomaly scan
  // -----------------------------------------------------------------------

  async detectProjectAnomalies(
    projectId: string,
    _userId?: string,
  ): Promise<AIAnomalyReport> {
    const context = await this.contextBuilder.buildProjectContext(projectId);
    const anomalies = await this.detectForProject(projectId, context.project.name);

    return {
      anomalies,
      summary: anomalies.length === 0
        ? `No anomalies detected for "${context.project.name}".`
        : `${anomalies.length} anomalie(s) detected for "${context.project.name}".`,
      overallHealthTrend: this.inferHealthTrend(anomalies),
      scannedProjects: 1,
      aiPowered: false,
    };
  }

  // -----------------------------------------------------------------------
  // Deterministic anomaly detection for a single project
  // -----------------------------------------------------------------------

  private async detectForProject(projectId: string, projectName: string): Promise<AIAnomaly[]> {
    const anomalies: AIAnomaly[] = [];
    const now = new Date().toISOString();

    try {
      const context = await this.contextBuilder.buildProjectContext(projectId);
      const metrics = computeMetricsFromContext(context, await statusDateFor(projectId));

      // 1. Budget spike: budget >90% utilized but project <50% complete
      if (metrics.daysElapsed > 14 && (context.project.budgetSpent || 0) > 0) {
        if (metrics.budgetUtilization > 90 && metrics.completionRate < 50) {
          anomalies.push({
            type: 'budget_spike',
            projectId,
            projectName,
            severity: metrics.budgetUtilization > 100 ? 'critical' : 'high',
            title: 'Budget Utilization Spike',
            description: `Budget is ${Math.round(metrics.budgetUtilization)}% utilized but project is only ${metrics.completionRate}% complete.`,
            recommendation: 'Conduct an immediate budget review. Identify unplanned expenditures and consider pausing non-critical activities.',
            detectedAt: now,
            dataPoints: { budgetUtilization: metrics.budgetUtilization, completionRate: metrics.completionRate },
          });
        }
      }

      // 2. Stale project: active project with very low progress relative to elapsed time
      //    (No historical data needed — we use a heuristic based on elapsed time vs. completion)
      if (context.project.status === 'active' && metrics.daysElapsed > 0) {
        const totalDuration = metrics.daysElapsed + metrics.daysRemaining;
        const expectedProgressPct = totalDuration > 0
          ? (metrics.daysElapsed / totalDuration) * 100
          : 0;
        // If the project should be >30% done by time but is <5% done, flag it
        if (expectedProgressPct > 30 && metrics.completionRate < 5) {
          anomalies.push({
            type: 'stale_project',
            projectId,
            projectName,
            severity: expectedProgressPct > 60 ? 'high' : 'medium',
            title: 'Stale Project',
            description: `Project is ${metrics.completionRate}% complete but ${Math.round(expectedProgressPct)}% of the timeline has elapsed. Very little progress detected.`,
            recommendation: 'Check if the project is still active. Update task progress or change project status to "on_hold".',
            detectedAt: now,
            dataPoints: { completionRate: metrics.completionRate, expectedProgressPct: Math.round(expectedProgressPct), daysElapsed: metrics.daysElapsed },
          });
        }
      }

      // 3. Task rescheduling: >30% of active tasks are overdue
      if (metrics.totalTasks > 0) {
        const overdueRatio = metrics.overdueTasks / metrics.totalTasks;
        if (overdueRatio > 0.3) {
          anomalies.push({
            type: 'task_rescheduling',
            projectId,
            projectName,
            severity: overdueRatio > 0.5 ? 'high' : 'medium',
            title: 'High Overdue Task Ratio',
            description: `${metrics.overdueTasks} of ${metrics.totalTasks} tasks (${(overdueRatio * 100).toFixed(0)}%) are overdue.`,
            recommendation: 'Review task deadlines and reassign or reschedule overdue tasks. Consider extending the project timeline.',
            detectedAt: now,
            dataPoints: { overdueTasks: metrics.overdueTasks, totalTasks: metrics.totalTasks, overdueRatio },
          });
        }
      }

      // 4. Budget flatline: active project with tasks in progress but no budget spent
      if (context.project.status === 'active' && metrics.completionRate > 0 && metrics.completionRate < 100) {
        const budgetAllocated = context.project.budgetAllocated || 0;
        const budgetSpent = context.project.budgetSpent || 0;
        if (budgetAllocated > 0 && budgetSpent === 0 && metrics.completionRate > 20) {
          anomalies.push({
            type: 'budget_flatline',
            projectId,
            projectName,
            severity: 'medium',
            title: 'Budget Flatline',
            description: `Project is ${metrics.completionRate}% complete but no budget expenditure recorded.`,
            recommendation: 'Verify that expenditures are being recorded. Update budget_spent to reflect actual costs.',
            detectedAt: now,
            dataPoints: { budgetSpent, completionRate: metrics.completionRate },
          });
        }
      }
    } catch (err) {
      this.fastify.log.warn({ err, projectId }, 'Anomaly detection failed for project (non-critical)');
    }

    return anomalies;
  }

  private inferHealthTrend(anomalies: AIAnomaly[]): 'improving' | 'stable' | 'deteriorating' {
    const criticalOrHigh = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high').length;
    if (criticalOrHigh >= 3) return 'deteriorating';
    if (criticalOrHigh >= 1) return 'stable';
    return 'improving';
  }
}
