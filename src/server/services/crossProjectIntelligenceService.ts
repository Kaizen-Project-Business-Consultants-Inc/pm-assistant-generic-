import { FastifyInstance } from 'fastify';
import { AIContextBuilder } from './aiContextBuilder';
import { claudeService, PromptTemplate } from './claudeService';
import { logAIUsage } from './aiUsageLogger';
import { computeEVMMetrics } from './predictiveIntelligence';
import type { AICrossProjectInsight } from '../schemas/phase5Schemas';
import { MS_PER_DAY } from '../utils/constants';

// ---------------------------------------------------------------------------
// Prompt Template
// ---------------------------------------------------------------------------

const crossProjectPrompt = new PromptTemplate(
  `You are a portfolio intelligence analyst for a project management system. Analyze cross-project data and provide strategic insights.

Portfolio context:
{{portfolioContext}}

Resource conflicts:
{{resourceConflicts}}

Budget reallocation candidates:
{{budgetData}}

Similar project data:
{{similarProjects}}

Return a JSON object with:
- "summary": 1-2 sentence strategic overview
- "recommendations": array of budget reallocation suggestions
- "similarProjectInsights": enhanced with "lessonsLearned" field for each similar project

Keep recommendations specific and actionable.`,
  '1.0.0',
);

// ---------------------------------------------------------------------------
// Helper: compute inline metrics for a portfolio project
// ---------------------------------------------------------------------------

function computePortfolioProjectMetrics(p: {
  budgetAllocated?: number;
  budgetSpent?: number;
  startDate?: string;
  endDate?: string;
  completionPercentage?: number;
  status: string;
}): {
  completionRate: number;
  budgetUtilization: number;
  daysElapsed: number;
  daysRemaining: number;
  healthScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
} {
  const now = new Date();
  const startDate = p.startDate ? new Date(p.startDate) : now;
  const endDate = p.endDate
    ? new Date(p.endDate)
    : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const daysElapsed = Math.max(0, Math.round((now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  const daysRemaining = Math.max(0, Math.round((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

  const completionRate = p.completionPercentage ?? 0;
  const budgetAllocated = p.budgetAllocated || 0;
  const budgetSpent = p.budgetSpent || 0;
  const budgetUtilization = budgetAllocated > 0 ? (budgetSpent / budgetAllocated) * 100 : 0;

  // Weighted health: 40% schedule, 30% budget, 30% general
  const scheduleHealth = Math.min(completionRate, 100);
  const budgetHealth = budgetUtilization <= 100
    ? 100 - budgetUtilization * 0.5
    : Math.max(0, 100 - budgetUtilization);
  const generalHealth = p.status === 'active' || p.status === 'completed'
    ? 85
    : p.status === 'on_hold'
      ? 55
      : p.status === 'cancelled'
        ? 25
        : 70;

  const healthScore = Math.round(scheduleHealth * 0.4 + budgetHealth * 0.3 + generalHealth * 0.3);

  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (healthScore >= 75) riskLevel = 'low';
  else if (healthScore >= 50) riskLevel = 'medium';
  else if (healthScore >= 25) riskLevel = 'high';
  else riskLevel = 'critical';

  return { completionRate, budgetUtilization, daysElapsed, daysRemaining, healthScore, riskLevel };
}

// ---------------------------------------------------------------------------
// CrossProjectIntelligenceService
// ---------------------------------------------------------------------------

export class CrossProjectIntelligenceService {
  private contextBuilder: AIContextBuilder;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.contextBuilder = new AIContextBuilder(fastify);
  }

  // -----------------------------------------------------------------------
  // Full portfolio analysis
  // -----------------------------------------------------------------------

  async analyzePortfolio(
    userId?: string,
    userRole?: string,
  ): Promise<{ insight: AICrossProjectInsight; aiPowered: boolean }> {
    // Only the projects this person can see (the whole portfolio used to be analysed for anyone)
    const portfolio = await this.contextBuilder.buildPortfolioContext({ userId, role: userRole });

    // 1. Resource conflicts
    //    No per-user task assignment tracking in the generic version — return empty
    const resourceConflicts: AICrossProjectInsight['resourceConflicts'] = [];

    // 2. Portfolio risk heat map
    const portfolioRiskHeatMap: AICrossProjectInsight['portfolioRiskHeatMap'] = portfolio.projects.map(p => {
      const m = computePortfolioProjectMetrics(p);
      return {
        projectId: p.id,
        projectName: p.name,
        healthScore: m.healthScore,
        riskLevel: m.riskLevel,
        budgetUtilization: Math.round(m.budgetUtilization * 10) / 10,
        progress: m.completionRate,
      };
    });

    // 3. Budget reallocation analysis
    const surplusCandidates: AICrossProjectInsight['budgetReallocation']['surplusCandidates'] = [];
    const deficitCandidates: AICrossProjectInsight['budgetReallocation']['deficitCandidates'] = [];

    for (const p of portfolio.projects) {
      if (p.status !== 'active') continue;

      try {
        const m = computePortfolioProjectMetrics(p);
        const totalDays = m.daysElapsed + m.daysRemaining;
        const budgetAllocated = p.budgetAllocated || 0;
        const budgetSpent = p.budgetSpent || 0;

        if (budgetAllocated === 0) continue;

        const evm = computeEVMMetrics(
          budgetAllocated,
          budgetSpent,
          m.completionRate,
          m.daysElapsed,
          totalDays,
        );

        if (evm.cpi > 1.1 && evm.spi > 1.1) {
          surplusCandidates.push({
            projectId: p.id,
            projectName: p.name,
            cpi: evm.cpi,
            spi: evm.spi,
            estimatedSurplus: Math.max(0, evm.vac),
          });
        } else if (evm.cpi < 0.9 || (m.budgetUtilization > 90 && m.completionRate < 70)) {
          deficitCandidates.push({
            projectId: p.id,
            projectName: p.name,
            cpi: evm.cpi,
            spi: evm.spi,
            estimatedDeficit: Math.abs(Math.min(0, evm.vac)),
          });
        }
      } catch {
        // Skip projects with insufficient data
      }
    }

    const budgetRecommendations: string[] = [];
    if (surplusCandidates.length > 0 && deficitCandidates.length > 0) {
      budgetRecommendations.push(
        `Consider reallocating funds from surplus projects (${surplusCandidates.map(s => s.projectName).join(', ')}) to deficit projects (${deficitCandidates.map(d => d.projectName).join(', ')}).`,
      );
    }
    if (deficitCandidates.length > 0) {
      budgetRecommendations.push(`${deficitCandidates.length} project(s) may need supplementary funding.`);
    }
    if (budgetRecommendations.length === 0) {
      budgetRecommendations.push('Budget allocation across the portfolio appears balanced.');
    }

    // 4. Similar projects — no DB-backed historical query in generic version, return empty
    const similarProjectInsights: AICrossProjectInsight['similarProjectInsights'] = [];

    const deterministicInsight: AICrossProjectInsight = {
      resourceConflicts,
      portfolioRiskHeatMap,
      budgetReallocation: {
        surplusCandidates,
        deficitCandidates,
        recommendations: budgetRecommendations,
      },
      similarProjectInsights,
      summary: `Portfolio has ${portfolio.totalProjects} projects. ${resourceConflicts.filter(r => r.severity === 'high' || r.severity === 'critical').length} resource conflict(s) and ${deficitCandidates.length} budget deficit(s) detected.`,
    };

    if (!claudeService.isAvailable()) {
      return { insight: deterministicInsight, aiPowered: false };
    }

    // Claude enhancement
    try {
      const portfolioPrompt = this.contextBuilder.portfolioToPromptString(portfolio);

      const systemPrompt = crossProjectPrompt.render({
        portfolioContext: portfolioPrompt,
        resourceConflicts: 'No per-user resource tracking available in this deployment.',
        budgetData: JSON.stringify({ surplusCandidates, deficitCandidates }, null, 2),
        similarProjects: 'N/A for portfolio-wide analysis',
      });

      const result = await claudeService.complete({
      feature: 'cross_project_intelligence',
      tier: 'light', // routine job: the cheaper model
        systemPrompt,
        userMessage: 'Analyze the cross-project data and return the enhanced JSON.',
        responseFormat: 'json',
        temperature: 0.3,
      });

      logAIUsage({
        userId,
        feature: 'cross_project_intelligence',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
        requestContext: {},
      });

      const parsed = JSON.parse(result.content);
      return {
        insight: {
          ...deterministicInsight,
          summary: parsed.summary || deterministicInsight.summary,
          budgetReallocation: {
            ...deterministicInsight.budgetReallocation,
            recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : budgetRecommendations,
          },
        },
        aiPowered: true,
      };
    } catch (err) {
      this.fastify.log.warn({ err }, 'AI cross-project analysis failed, using deterministic results');
      return { insight: deterministicInsight, aiPowered: false };
    }
  }

  // -----------------------------------------------------------------------
  // Find similar completed projects
  // -----------------------------------------------------------------------

  async findSimilarProjects(
    projectId: string,
    _userId?: string,
  ): Promise<{ similar: AICrossProjectInsight['similarProjectInsights']; aiPowered: boolean }> {
    const db = (this.fastify as any).mysql || (this.fastify as any).db;
    if (!db) return { similar: [], aiPowered: false };

    try {
      const context = await this.contextBuilder.buildProjectContext(projectId);
      const { project } = context;

      // Find completed projects with same type and similar budget (within 50%)
      const budgetAllocated = project.budgetAllocated || 0;
      const budgetLow = budgetAllocated * 0.5;
      const budgetHigh = budgetAllocated * 1.5;

      const [rows]: any = await db.query(
        `SELECT p.id, p.name, p.project_type, p.budget_allocated, p.budget_spent, p.status,
                p.start_date, p.end_date
         FROM projects p
         WHERE p.id != ?
           AND p.status = 'completed'
           AND (p.project_type = ? OR (p.budget_allocated BETWEEN ? AND ?))
         ORDER BY p.end_date DESC
         LIMIT 5`,
        [projectId, project.projectType || '', budgetLow, budgetHigh],
      );

      const similar = rows.map((r: any) => {
        const startDate = new Date(r.start_date);
        const endDate = new Date(r.end_date);
        const durationDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / MS_PER_DAY));

        return {
          projectId: r.id,
          projectName: r.name,
          category: r.project_type || 'Uncategorized',
          budgetAllocated: parseFloat(r.budget_allocated) || 0,
          finalBudget: parseFloat(r.budget_spent) || 0,
          durationDays,
          status: r.status,
          lessonsLearned: parseFloat(r.budget_spent) > parseFloat(r.budget_allocated)
            ? `This project went ${((parseFloat(r.budget_spent) / parseFloat(r.budget_allocated) - 1) * 100).toFixed(0)}% over budget. Plan for contingencies.`
            : `Completed within budget. Duration was ${durationDays} days.`,
        };
      });

      return { similar, aiPowered: false };
    } catch (err) {
      this.fastify.log.warn({ err }, 'Failed to find similar projects (non-critical)');
      return { similar: [], aiPowered: false };
    }
  }
}
