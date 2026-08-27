import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { AIContextBuilder, ProjectContext } from './aiContextBuilder';
import { claudeService, PromptTemplate } from './claudeService';
import { logAIUsage } from './aiUsageLogger';
import { sanitizeForPrompt } from '../utils/promptSanitizer';
import { computeEVMMetrics, computeDeterministicRiskScore } from './predictiveIntelligence';
import { criticalPathService, type CPMTaskResult } from './CriticalPathService';
import { databaseService } from '../database/connection';
import type { AIScenarioRequest, AIScenarioResult } from '../schemas/phase5Schemas';
import { AIScenarioResultSchema } from '../schemas/phase5Schemas';

// ---------------------------------------------------------------------------
// Prompt Template
// ---------------------------------------------------------------------------

const scenarioPrompt = new PromptTemplate(
  `You are a project scenario modeling analyst for a project management system. A project manager is asking "What if...?" — model the cascading effects of the proposed change.

Current project state:
{{projectData}}

EVM metrics:
{{evmMetrics}}

Critical path tasks: {{criticalPathInfo}}

Scenario description: {{scenario}}
Applied numeric parameters: {{parameters}}

Deterministic baseline impact:
{{baselineImpact}}

Analyze the cascading effects on schedule, budget, resources, and risk. Consider:
- Downstream task dependencies and the critical path
- Resource reallocation needs
- Risk profile changes
- External factors (weather, supply chain, regulatory) relevant to the project type and location

Return a JSON object matching the schema with schedule/budget/resource/risk impacts, affected tasks, recommendations, and confidence (0.5-0.9).`,
  '2.0.0',
);

// ---------------------------------------------------------------------------
// Project-type risk coefficients (#9)
// ---------------------------------------------------------------------------

interface RiskCoefficients {
  budgetCutRiskPerPct: number;
  budgetAddRiskPerPct: number;
  timelineExtRiskPerDay: number;
  timelineCompressRiskPerDay: number;
  scopeRiskPerPct: number;
  scopeBudgetMultiplier: number;
}

function getCoefficients(projectType: string): RiskCoefficients {
  switch (projectType.toLowerCase()) {
    case 'construction':
    case 'infrastructure':
      // Physical projects: budget cuts are very risky, timeline is less flexible
      return { budgetCutRiskPerPct: 0.7, budgetAddRiskPerPct: 0.15, timelineExtRiskPerDay: 0.2, timelineCompressRiskPerDay: 0.7, scopeRiskPerPct: 0.4, scopeBudgetMultiplier: 0.7 };
    case 'it':
    case 'software':
    case 'technology':
      // Software projects: scope changes are very risky, timeline is more flexible
      return { budgetCutRiskPerPct: 0.4, budgetAddRiskPerPct: 0.2, timelineExtRiskPerDay: 0.25, timelineCompressRiskPerDay: 0.5, scopeRiskPerPct: 0.5, scopeBudgetMultiplier: 0.6 };
    case 'consulting':
    case 'professional_services':
      // People-driven: worker changes are most impactful
      return { budgetCutRiskPerPct: 0.5, budgetAddRiskPerPct: 0.2, timelineExtRiskPerDay: 0.3, timelineCompressRiskPerDay: 0.4, scopeRiskPerPct: 0.3, scopeBudgetMultiplier: 0.5 };
    default:
      return { budgetCutRiskPerPct: 0.5, budgetAddRiskPerPct: 0.2, timelineExtRiskPerDay: 0.3, timelineCompressRiskPerDay: 0.5, scopeRiskPerPct: 0.3, scopeBudgetMultiplier: 0.5 };
  }
}

// ---------------------------------------------------------------------------
// Helper: compute metrics from ProjectContext
// ---------------------------------------------------------------------------

function computeMetricsFromContext(ctx: ProjectContext): {
  completionRate: number;
  scheduleVariance: number;
  budgetUtilization: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  daysElapsed: number;
  daysRemaining: number;
} {
  const allTasks = ctx.schedules.flatMap(s => s.tasks);
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter(t => t.status === 'completed').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const now = new Date();
  const overdueTasks = allTasks.filter(
    t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now,
  ).length;

  const startDate = ctx.project.startDate ? new Date(ctx.project.startDate) : now;
  const endDate = ctx.project.endDate
    ? new Date(ctx.project.endDate)
    : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = Math.max(0, now.getTime() - startDate.getTime());
  const daysElapsed = Math.round(elapsed / (24 * 60 * 60 * 1000));
  const daysRemaining = Math.max(0, Math.round((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  const expectedPercent = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;
  const scheduleVariance = completionRate - expectedPercent;

  const budgetAllocated = ctx.project.budgetAllocated || 0;
  const budgetSpent = ctx.project.budgetSpent || 0;
  const budgetUtilization = budgetAllocated > 0 ? (budgetSpent / budgetAllocated) * 100 : 0;

  return { completionRate, scheduleVariance, budgetUtilization, totalTasks, completedTasks, overdueTasks, daysElapsed, daysRemaining };
}

// ---------------------------------------------------------------------------
// WhatIfScenarioService
// ---------------------------------------------------------------------------

export interface SavedScenario {
  id: string;
  projectId: string;
  userId: number;
  scenarioText: string;
  parameters: AIScenarioRequest['parameters'] | null;
  result: AIScenarioResult;
  aiPowered: boolean;
  confidence: number;
  createdAt: string;
}

export class WhatIfScenarioService {
  private contextBuilder: AIContextBuilder;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.contextBuilder = new AIContextBuilder(fastify);
  }

  // -------------------------------------------------------------------------
  // #1: Get actual team size from task_assignments + resources
  // -------------------------------------------------------------------------

  private async getProjectWorkerCount(projectId: string): Promise<number> {
    try {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(DISTINCT ta.resource_id) AS cnt
         FROM task_assignments ta
         JOIN tasks t ON ta.task_id = t.id
         JOIN schedules s ON t.schedule_id = s.id
         WHERE s.project_id = ? AND s.is_scenario = 0`,
        [projectId],
      );
      const fromAssignments = rows[0]?.cnt ?? 0;
      if (fromAssignments > 0) return fromAssignments;

      // Fallback: count distinct assigned_to names on active tasks
      const nameRows = await databaseService.query<any>(
        `SELECT COUNT(DISTINCT t.assigned_to) AS cnt
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         WHERE s.project_id = ? AND s.is_scenario = 0
           AND t.assigned_to IS NOT NULL AND t.assigned_to != ''`,
        [projectId],
      );
      return Math.max(1, nameRows[0]?.cnt ?? 1);
    } catch {
      return 1;
    }
  }

  // -------------------------------------------------------------------------
  // #4/#5: Smart affected tasks using critical path
  // -------------------------------------------------------------------------

  private async getSmartAffectedTasks(
    context: ProjectContext,
    params: AIScenarioRequest['parameters'],
  ): Promise<AIScenarioResult['affectedTasks']> {
    const scheduleIds = context.schedules.map(s => s.id);
    let criticalTaskIds = new Set<string>();
    let cpmResults: CPMTaskResult[] = [];

    // Get critical path for each schedule
    for (const sid of scheduleIds) {
      try {
        const cpResult = await criticalPathService.calculateCriticalPath(sid);
        cpResult.criticalPathTaskIds.forEach(id => criticalTaskIds.add(id));
        cpmResults.push(...cpResult.tasks);
      } catch { /* schedule may have no tasks */ }
    }

    const allTasks = context.schedules.flatMap(s => s.tasks);
    const activeTasks = allTasks.filter(t => t.status !== 'completed');
    if (activeTasks.length === 0) return [];

    const cpmMap = new Map(cpmResults.map(t => [t.taskId, t]));

    // Score tasks by relevance to the scenario
    const scored = activeTasks.map(t => {
      let score = 0;
      const cpm = cpmMap.get(t.id);
      const isCritical = criticalTaskIds.has(t.id);

      // Critical path tasks are most affected by timeline changes
      if (isCritical) score += 30;

      // Low float = high sensitivity
      if (cpm && cpm.totalFloat <= 2) score += 20;
      else if (cpm && cpm.totalFloat <= 5) score += 10;

      // Budget scenarios: prioritize tasks with highest remaining cost
      if (params?.budgetChangePct !== undefined) {
        // No per-task cost data in context, use estimated days as proxy
        score += (t.estimatedDays ?? 0) * 2;
      }

      // Timeline scenarios: prioritize tasks with latest due dates
      if (params?.daysExtension !== undefined && t.dueDate) {
        const daysUntilDue = Math.max(0, (new Date(t.dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        if (daysUntilDue < 14) score += 15; // due soon
      }

      // Scope scenarios: prioritize tasks with low progress
      if (params?.scopeChangePct !== undefined) {
        score += Math.max(0, 100 - (t.progressPercentage ?? 0)) / 5;
      }

      // Overdue tasks are always highly affected
      if (t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed') {
        score += 25;
      }

      return { task: t, score, isCritical };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, 8).map(({ task: t, isCritical }) => {
      let impact = '';
      let severity: 'low' | 'medium' | 'high' = 'medium';

      if (isCritical && params?.daysExtension !== undefined && params.daysExtension < 0) {
        impact = 'On critical path — timeline compression directly affects this task.';
        severity = 'high';
      } else if (isCritical) {
        impact = 'On critical path — any delay here extends the project end date.';
        severity = 'high';
      } else if (t.dueDate && new Date(t.dueDate) < new Date()) {
        impact = 'Already overdue — scenario change compounds existing delay.';
        severity = 'high';
      } else if (params?.budgetChangePct !== undefined && params.budgetChangePct < -10) {
        impact = 'May need scope reduction or resource reallocation due to budget cut.';
        severity = 'medium';
      } else if (params?.workerChange !== undefined && params.workerChange < 0) {
        impact = 'May be reassigned or delayed due to reduced team capacity.';
        severity = 'medium';
      } else {
        impact = 'May be indirectly affected through dependency chain.';
        severity = 'low';
      }

      return { taskName: t.name, impact, severity };
    });
  }

  // -------------------------------------------------------------------------
  // Main modeling method
  // -------------------------------------------------------------------------

  async modelScenario(
    request: AIScenarioRequest,
    userId?: string,
  ): Promise<{ result: AIScenarioResult; aiPowered: boolean; id: string }> {
    const context = await this.contextBuilder.buildProjectContext(request.projectId);
    const metrics = computeMetricsFromContext(context);
    const { project } = context;
    const projectType = project.projectType || 'other';
    const coeff = getCoefficients(projectType);

    const budgetAllocated = project.budgetAllocated || 0;
    const budgetSpent = project.budgetSpent || 0;
    const totalDays = metrics.daysElapsed + metrics.daysRemaining;

    const evm = computeEVMMetrics(
      budgetAllocated,
      budgetSpent,
      metrics.completionRate,
      metrics.daysElapsed,
      totalDays,
    );
    const { score: currentRiskScore } = computeDeterministicRiskScore(metrics, metrics.budgetUtilization);

    // #1: Get actual worker count
    const currentWorkers = await this.getProjectWorkerCount(request.projectId);

    // Apply numeric parameters with project-type-aware coefficients (#9)
    const params = request.parameters || {};
    let projectedBudget = budgetAllocated;
    let projectedDays = totalDays;
    let projectedWorkers = currentWorkers;
    let projectedRiskScore = currentRiskScore;

    if (params.budgetChangePct !== undefined) {
      projectedBudget = budgetAllocated * (1 + params.budgetChangePct / 100);
    }
    if (params.daysExtension !== undefined) {
      projectedDays = totalDays + params.daysExtension;
    }
    if (params.workerChange !== undefined) {
      projectedWorkers = Math.max(1, projectedWorkers + params.workerChange);
    }
    if (params.scopeChangePct !== undefined) {
      // #6: Better scope model — cross-reference with task count and velocity
      const taskCount = metrics.totalTasks;
      const newTasksEstimate = Math.round(taskCount * Math.abs(params.scopeChangePct) / 100);
      const velocity = metrics.completedTasks > 0 && metrics.daysElapsed > 0
        ? metrics.completedTasks / metrics.daysElapsed
        : 0.5; // default: 0.5 tasks/day
      const additionalDays = velocity > 0 ? Math.round(newTasksEstimate / velocity) : 0;

      projectedBudget *= (1 + Math.abs(params.scopeChangePct) / 100 * coeff.scopeBudgetMultiplier);
      projectedRiskScore = Math.min(100, currentRiskScore + Math.abs(params.scopeChangePct) * coeff.scopeRiskPerPct);

      // Auto-extend timeline if scope increases and no explicit days change
      if (params.scopeChangePct > 0 && params.daysExtension === undefined) {
        projectedDays += additionalDays;
      }
    }

    // Budget change adjusts risk (project-type coefficients)
    if (params.budgetChangePct !== undefined && params.budgetChangePct < 0) {
      projectedRiskScore = Math.min(100, currentRiskScore + Math.abs(params.budgetChangePct) * coeff.budgetCutRiskPerPct);
    } else if (params.budgetChangePct !== undefined && params.budgetChangePct > 0) {
      projectedRiskScore = Math.max(0, currentRiskScore - params.budgetChangePct * coeff.budgetAddRiskPerPct);
    }

    // Timeline extension reduces risk, contraction increases
    if (params.daysExtension !== undefined && params.daysExtension > 0) {
      projectedRiskScore = Math.max(0, projectedRiskScore - params.daysExtension * coeff.timelineExtRiskPerDay);
    } else if (params.daysExtension !== undefined && params.daysExtension < 0) {
      projectedRiskScore = Math.min(100, projectedRiskScore + Math.abs(params.daysExtension) * coeff.timelineCompressRiskPerDay);
    }

    projectedRiskScore = Math.round(projectedRiskScore);

    const budgetChangePctResult = budgetAllocated > 0
      ? parseFloat(((projectedBudget - budgetAllocated) / budgetAllocated * 100).toFixed(1))
      : 0;
    const scheduleChangePct = totalDays > 0
      ? parseFloat(((projectedDays - totalDays) / totalDays * 100).toFixed(1))
      : 0;

    // #4/#5: Smart affected tasks with critical path analysis
    const affectedTasks = await this.getSmartAffectedTasks(context, request.parameters);

    // Get critical path info for AI prompt
    let criticalPathInfo = 'No critical path data available.';
    try {
      const scheduleIds = context.schedules.map(s => s.id);
      for (const sid of scheduleIds) {
        const cp = await criticalPathService.calculateCriticalPath(sid);
        if (cp.criticalPathTaskIds.length > 0) {
          const cpTasks = cp.tasks.filter(t => t.isCritical).map(t => `${t.name} (${t.duration}d, float: ${t.totalFloat}d)`);
          criticalPathInfo = `Project duration: ${cp.projectDuration} days. Critical tasks: ${cpTasks.join(', ')}`;
          break;
        }
      }
    } catch { /* ignore */ }

    const fallbackResult: AIScenarioResult = {
      scheduleImpact: {
        originalDays: totalDays,
        projectedDays,
        changePct: scheduleChangePct,
        explanation: scheduleChangePct !== 0
          ? `Timeline changes by ${scheduleChangePct > 0 ? '+' : ''}${scheduleChangePct}% (${totalDays} \u2192 ${projectedDays} days).`
          : 'No direct schedule impact from the proposed change.',
      },
      budgetImpact: {
        originalBudget: budgetAllocated,
        projectedBudget: Math.round(projectedBudget),
        changePct: budgetChangePctResult,
        explanation: budgetChangePctResult !== 0
          ? `Budget changes by ${budgetChangePctResult > 0 ? '+' : ''}${budgetChangePctResult}% ($${budgetAllocated.toLocaleString()} \u2192 $${Math.round(projectedBudget).toLocaleString()}).`
          : 'No direct budget impact from the proposed change.',
      },
      resourceImpact: {
        currentWorkers,
        projectedWorkers,
        explanation: projectedWorkers !== currentWorkers
          ? `Team size changes from ${currentWorkers} to ${projectedWorkers}.`
          : 'No direct resource impact from the proposed change.',
      },
      riskImpact: {
        currentRiskScore,
        projectedRiskScore,
        newRisks: this.inferNewRisks(params, coeff),
        explanation: `Risk score moves from ${currentRiskScore} to ${projectedRiskScore} (${projectType} project coefficients applied).`,
      },
      affectedTasks,
      recommendations: this.buildRecommendations(params, budgetChangePctResult, scheduleChangePct, projectType),
      confidence: 0.35,
    };

    let finalResult: AIScenarioResult;
    let aiPowered = false;

    if (claudeService.isAvailable()) {
      try {
        const projectPrompt = this.contextBuilder.toPromptString(context);
        const evmStr = Object.entries(evm).map(([k, v]) => `${k}: ${v}`).join('\n');

        const systemPrompt = scenarioPrompt.render({
          projectData: projectPrompt,
          evmMetrics: evmStr,
          criticalPathInfo,
          scenario: request.scenario,
          parameters: JSON.stringify(params),
          baselineImpact: JSON.stringify({
            scheduleChangePct,
            budgetChangePct: budgetChangePctResult,
            projectedRiskScore,
            projectedWorkers,
            currentWorkers,
          }),
        });

        const result = await claudeService.completeWithJsonSchema({
          systemPrompt,
          userMessage: `Model this scenario: "${sanitizeForPrompt(request.scenario)}". Return the impact analysis JSON.`,
          schema: AIScenarioResultSchema,
          temperature: 0.4,
        });

        logAIUsage({
          userId,
          feature: 'what_if_scenario',
          model: 'claude',
          usage: result.usage,
          latencyMs: result.latencyMs,
          success: true,
          requestContext: { projectId: request.projectId },
        });

        finalResult = result.data;
        aiPowered = true;
      } catch (err) {
        this.fastify.log.warn({ err }, 'AI scenario modeling failed, using deterministic fallback');
        finalResult = fallbackResult;
      }
    } else {
      finalResult = fallbackResult;
    }

    // #2: Persist scenario to DB
    const id = uuidv4();
    try {
      await databaseService.query(
        `INSERT INTO scenario_analyses (id, project_id, user_id, scenario_text, parameters, result, ai_powered, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, request.projectId, userId ?? 0, request.scenario,
         JSON.stringify(request.parameters ?? null),
         JSON.stringify(finalResult),
         aiPowered ? 1 : 0,
         finalResult.confidence],
      );
    } catch (err) {
      this.fastify.log.warn({ err }, 'Failed to persist scenario analysis');
    }

    return { result: finalResult, aiPowered, id };
  }

  // -------------------------------------------------------------------------
  // #2: Scenario history
  // -------------------------------------------------------------------------

  async getHistory(projectId: string, limit = 10): Promise<SavedScenario[]> {
    const rows = await databaseService.query<any>(
      `SELECT * FROM scenario_analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      [projectId, limit],
    );
    return rows.map((r: any) => ({
      id: r.id,
      projectId: r.project_id,
      userId: r.user_id,
      scenarioText: r.scenario_text,
      parameters: typeof r.parameters === 'string' ? JSON.parse(r.parameters) : r.parameters,
      result: typeof r.result === 'string' ? JSON.parse(r.result) : r.result,
      aiPowered: !!r.ai_powered,
      confidence: Number(r.confidence),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  async deleteScenario(id: string): Promise<boolean> {
    const result = await databaseService.query<{ affectedRows?: number }>(
      'DELETE FROM scenario_analyses WHERE id = ?',
      [id],
    );
    return ((result as any).affectedRows ?? 0) > 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private inferNewRisks(params: AIScenarioRequest['parameters'], coeff: RiskCoefficients): string[] {
    const risks: string[] = [];
    if (!params) return risks;
    if (params.budgetChangePct !== undefined && params.budgetChangePct < -10) {
      risks.push('Budget reduction may force scope cuts or quality compromises.');
    }
    if (params.workerChange !== undefined && params.workerChange < 0) {
      risks.push('Reduced workforce increases schedule pressure on remaining team.');
    }
    if (params.daysExtension !== undefined && params.daysExtension < 0) {
      risks.push('Compressed timeline increases risk of quality issues and burnout.');
      if (Math.abs(params.daysExtension) * coeff.timelineCompressRiskPerDay > 15) {
        risks.push('Severe compression — consider fast-tracking or crashing only non-critical-path tasks.');
      }
    }
    if (params.scopeChangePct !== undefined && params.scopeChangePct > 10) {
      risks.push('Scope increase without proportional budget/time increase creates delivery risk.');
    }
    if (params.scopeChangePct !== undefined && params.scopeChangePct > 25) {
      risks.push('Scope increase >25% typically requires formal change control and re-baselining.');
    }
    return risks;
  }

  private buildRecommendations(
    params: AIScenarioRequest['parameters'],
    budgetChangePct: number,
    scheduleChangePct: number,
    projectType: string,
  ): string[] {
    const recs: string[] = [];
    if (!params) {
      recs.push('No numeric parameters provided. Consider adding budget, timeline, or resource changes for quantitative analysis.');
      return recs;
    }
    if (budgetChangePct < -15) {
      recs.push('Significant budget reduction. Prioritize critical path tasks and consider phased delivery.');
    }
    if (scheduleChangePct < -10) {
      recs.push('Timeline compression detected. Identify parallelizable tasks and consider adding resources.');
      if (projectType === 'construction' || projectType === 'infrastructure') {
        recs.push('For physical projects, consider overtime or additional shifts rather than fast-tracking dependent activities.');
      }
    }
    if (scheduleChangePct > 20) {
      recs.push('Extended timeline provides buffer. Use this to improve quality and address backlog.');
    }
    if (params.workerChange !== undefined && params.workerChange < -1) {
      recs.push('With reduced team, consider redistributing workload and updating the resource assignment matrix.');
    }
    if (params.scopeChangePct !== undefined && params.scopeChangePct > 15) {
      recs.push('Scope increase warrants a formal change request. Update the project baseline and communicate to stakeholders.');
    }
    if (recs.length === 0) {
      recs.push('The proposed changes appear manageable. Monitor key metrics closely during implementation.');
    }
    return recs;
  }
}
