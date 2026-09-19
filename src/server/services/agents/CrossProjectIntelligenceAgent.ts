import { reasoningEngine, PortfolioAnalysisResult } from './ReasoningEngine';
import { actionProposalService, CreateProposalInput } from './ActionProposalService';
import { confidenceCalculator } from './ConfidenceCalculator';
import { agentCostTracker } from './AgentCostTracker';
import { killSwitchService } from './KillSwitchService';
import { proposalRateLimiter } from './ProposalRateLimiter';
import { degradationHandler } from './DegradationHandler';
import { notificationService } from '../NotificationService';
import { projectService, Project } from '../ProjectService';
import { scheduleService } from '../ScheduleService';
import { resourceService } from '../ResourceService';
import { computeEVMMetrics } from '../predictiveIntelligence';
import { MS_PER_DAY } from '../../utils/constants';
// Lateness compares calendar days: a date is not late until the following day.
// `new Date(dateColumn) < now` was true from midnight UTC — the previous evening
// for anyone west of UTC.
import { isOverdue } from '../../utils/calendarDate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossProjectInput {
  userId: string;
  scanId?: string;
}

export interface ProjectHealthSnapshot {
  projectId: string;
  projectName: string;
  status: string;
  priority: string;
  healthScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  completionRate: number;
  budgetUtilization: number;
  CPI: number | null;
  SPI: number | null;
  daysRemaining: number;
  taskCount: number;
  overdueTasks: number;
  resourceCount: number;
  overAllocatedResources: number;
}

export interface PortfolioIndicators {
  totalProjects: number;
  activeProjects: number;
  projectSnapshots: ProjectHealthSnapshot[];
  atRiskProjects: ProjectHealthSnapshot[];
  budgetDeficitProjects: ProjectHealthSnapshot[];
  resourceBottlenecks: Array<{ projectId: string; projectName: string; overAllocatedCount: number }>;
  commonRisks: string[];
}

export interface CrossProjectOutput {
  analysis: PortfolioAnalysisResult | null;
  proposal: { id: string } | null;
  indicators: PortfolioIndicators | null;
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class CrossProjectIntelligenceAgent {
  static readonly AGENT_ID = 'cross-project-intelligence-v1';
  static readonly AGENT_VERSION = '1.0.0';

  async run(input: CrossProjectInput): Promise<CrossProjectOutput> {
    const skip = (reason: string): CrossProjectOutput => ({
      analysis: null, proposal: null, indicators: null, skipped: true, skipReason: reason,
    });

    // 1. Check cost budget
    const budget = await agentCostTracker.checkBudget(CrossProjectIntelligenceAgent.AGENT_ID, 'portfolio');
    if (!budget.allowed) return skip(budget.reason!);

    // 2. Check kill switch (portfolio-level — no specific project)
    const ks = killSwitchService.canRun(CrossProjectIntelligenceAgent.AGENT_ID, 'portfolio');
    if (!ks.allowed) return skip(ks.reason!);

    // 3. Check rate limit
    const rl = await proposalRateLimiter.check(CrossProjectIntelligenceAgent.AGENT_ID, 'portfolio');
    if (!rl.allowed) return skip(rl.reason!);

    // 4. Check circuit breaker
    const cb = degradationHandler.canAgentRun(CrossProjectIntelligenceAgent.AGENT_ID);
    if (!cb.allowed) return skip(cb.reason!);

    // 5. Gather portfolio indicators
    let indicators: PortfolioIndicators;
    try {
      indicators = await this.gatherIndicators();
    } catch (err) {
      degradationHandler.recordFailure(CrossProjectIntelligenceAgent.AGENT_ID);
      return skip(`Failed to gather portfolio indicators: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6. Check if indicators are significant enough to warrant analysis
    if (indicators.activeProjects < 2) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'Less than 2 active projects — cross-project analysis not meaningful' };
    }

    const isSignificant =
      indicators.atRiskProjects.length >= 2 ||
      indicators.budgetDeficitProjects.length >= 2 ||
      indicators.resourceBottlenecks.length >= 1 ||
      indicators.commonRisks.length >= 1;

    if (!isSignificant) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'No significant cross-project patterns detected' };
    }

    // 7. Run reasoning engine
    let analysis: PortfolioAnalysisResult | null;
    try {
      analysis = await reasoningEngine.generatePortfolioAnalysis({
        userId: input.userId,
        indicators,
        scanId: input.scanId,
      });
    } catch (err) {
      degradationHandler.recordFailure(CrossProjectIntelligenceAgent.AGENT_ID);
      return skip(`Reasoning engine failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!analysis) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'Reasoning engine returned no analysis (Claude unavailable or parse failure)' };
    }

    // 8. Log confidence
    await confidenceCalculator.log(
      CrossProjectIntelligenceAgent.AGENT_ID,
      'portfolio',
      analysis.confidence,
    );

    // 9. Check if confidence allows proposals
    if (!analysis.confidence.canPropose) {
      degradationHandler.recordSuccess(CrossProjectIntelligenceAgent.AGENT_ID);

      await notificationService.create({
        userId: input.userId,
        type: 'agent_low_confidence',
        severity: 'low',
        title: 'Portfolio patterns detected (low confidence)',
        message: `Cross-project analysis identified ${indicators.atRiskProjects.length} at-risk project(s) but agent confidence is too low (${analysis.confidence.score}%) to propose actions.`,
      });

      return { analysis, proposal: null, indicators, skipped: true, skipReason: `Confidence too low: ${analysis.confidence.score}%` };
    }

    // 10. Create proposal if actionable
    if (!analysis.hasPortfolioIssue || analysis.suggestedActions.length === 0) {
      degradationHandler.recordSuccess(CrossProjectIntelligenceAgent.AGENT_ID);
      return { analysis, proposal: null, indicators, skipped: true, skipReason: 'Analysis found no actionable portfolio issues' };
    }

    const snapshotVersion = this.computeSnapshotVersion(indicators);

    const proposalInput: CreateProposalInput = {
      projectId: 'portfolio',
      agentId: CrossProjectIntelligenceAgent.AGENT_ID,
      agentVersion: CrossProjectIntelligenceAgent.AGENT_VERSION,
      title: `Portfolio Intelligence: ${analysis.severity} — ${indicators.atRiskProjects.length} at-risk, ${indicators.budgetDeficitProjects.length} budget deficit`,
      reasoning: analysis.reasoning,
      summary: `**Insights:** ${analysis.insights.join('; ')}\\n\\n**Warnings:** ${analysis.warnings.join('; ')}\\n\\n**Recommendations:** ${analysis.recommendations.join('; ')}`,
      confidenceScore: analysis.confidence.score,
      confidenceFactors: analysis.confidence.factors as unknown as Record<string, unknown>,
      riskLevel: 'low',
      dataSnapshotVersion: snapshotVersion,
      createdBy: input.userId,
      actions: analysis.suggestedActions.map((a, idx) => ({
        executionOrder: idx + 1,
        actionType: a.actionType,
        targetEntityType: a.targetEntityType,
        targetEntityId: a.targetEntityId,
        oldValue: a.oldValue,
        newValue: a.newValue,
        reasoning: a.reasoning,
      })),
    };

    const proposal = await actionProposalService.create(proposalInput);

    // 11. Update confidence log with proposal ID
    await confidenceCalculator.log(
      CrossProjectIntelligenceAgent.AGENT_ID,
      'portfolio',
      analysis.confidence,
      proposal.id,
    );

    // 12. Notify user
    await notificationService.create({
      userId: input.userId,
      type: 'agent_proposal',
      severity: analysis.severity === 'critical' ? 'critical' : 'medium',
      title: `Portfolio intelligence report (${analysis.severity})`,
      message: `Cross-project analysis: ${indicators.atRiskProjects.length} at-risk projects, ${indicators.budgetDeficitProjects.length} budget deficits, ${analysis.suggestedActions.length} action(s) proposed.`,
      linkType: 'proposal',
      linkId: proposal.id,
    });

    degradationHandler.recordSuccess(CrossProjectIntelligenceAgent.AGENT_ID);

    return { analysis, proposal: { id: proposal.id }, indicators, skipped: false };
  }

  /**
   * Gather health snapshots across all active projects.
   */
  async gatherIndicators(): Promise<PortfolioIndicators> {
    const allProjects = await projectService.findAll();
    const activeProjects = allProjects.filter(p => p.status === 'active' || p.status === 'planning');

    const snapshots: ProjectHealthSnapshot[] = [];
    const resourceBottlenecks: PortfolioIndicators['resourceBottlenecks'] = [];

    for (const project of activeProjects) {
      const snapshot = await this.buildProjectSnapshot(project);
      snapshots.push(snapshot);

      if (snapshot.overAllocatedResources > 0) {
        resourceBottlenecks.push({
          projectId: project.id,
          projectName: project.name,
          overAllocatedCount: snapshot.overAllocatedResources,
        });
      }
    }

    const atRiskProjects = snapshots.filter(s => s.riskLevel === 'high' || s.riskLevel === 'critical');
    const budgetDeficitProjects = snapshots.filter(s => s.CPI !== null && s.CPI < 0.9);

    // Identify common risks across projects
    const commonRisks: string[] = [];
    if (atRiskProjects.length >= 2) {
      commonRisks.push(`${atRiskProjects.length} projects at high/critical risk`);
    }
    if (budgetDeficitProjects.length >= 2) {
      commonRisks.push(`${budgetDeficitProjects.length} projects with CPI below 0.9`);
    }
    if (resourceBottlenecks.length >= 2) {
      commonRisks.push(`${resourceBottlenecks.length} projects with over-allocated resources`);
    }
    const overdueProjects = snapshots.filter(s => s.overdueTasks > 0);
    if (overdueProjects.length >= 2) {
      commonRisks.push(`${overdueProjects.length} projects with overdue tasks`);
    }

    return {
      totalProjects: allProjects.length,
      activeProjects: activeProjects.length,
      projectSnapshots: snapshots,
      atRiskProjects,
      budgetDeficitProjects,
      resourceBottlenecks,
      commonRisks,
    };
  }

  private async buildProjectSnapshot(project: Project): Promise<ProjectHealthSnapshot> {
    const now = new Date();
    const startDate = project.startDate ? new Date(project.startDate) : now;
    const endDate = project.endDate ? new Date(project.endDate) : new Date(now.getTime() + 365 * MS_PER_DAY);

    const daysElapsed = Math.max(0, Math.round((now.getTime() - startDate.getTime()) / MS_PER_DAY));
    const daysRemaining = Math.max(0, Math.round((endDate.getTime() - now.getTime()) / MS_PER_DAY));
    const totalDays = daysElapsed + daysRemaining;

    // Get tasks (batch query)
    const schedules = await scheduleService.findByProjectId(project.id);
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
    const taskCount = allTasks.length;
    const overdueTasks = allTasks.filter(t =>
      t.endDate && isOverdue(t.endDate) && t.status !== 'completed' && t.status !== 'cancelled'
    ).length;
    const completed = allTasks.filter(t => t.status === 'completed').length;
    const completionRate = taskCount > 0 ? Math.round((completed / taskCount) * 100) : 0;

    // EVM metrics
    let CPI: number | null = null;
    let SPI: number | null = null;
    const budgetAllocated = project.budgetAllocated || 0;
    const budgetSpent = project.budgetSpent || 0;

    if (budgetAllocated > 0 && totalDays > 0) {
      try {
        const evm = computeEVMMetrics(budgetAllocated, budgetSpent, completionRate, daysElapsed, totalDays);
        CPI = evm.cpi;
        SPI = evm.spi;
      } catch {
        // EVM not available
      }
    }

    const budgetUtilization = budgetAllocated > 0 ? Math.round((budgetSpent / budgetAllocated) * 100) : 0;

    // Resources
    let resourceCount = 0;
    let overAllocatedResources = 0;
    try {
      const workloads = await resourceService.computeWorkload(project.id);
      resourceCount = workloads.length;
      overAllocatedResources = workloads.filter(w => w.isOverAllocated || w.averageUtilization > 100).length;
    } catch {
      // Resource data optional
    }

    // Health score (same algorithm as crossProjectIntelligenceService)
    const scheduleHealth = Math.min(completionRate, 100);
    const budgetHealth = budgetUtilization <= 100
      ? 100 - budgetUtilization * 0.5
      : Math.max(0, 100 - budgetUtilization);
    const generalHealth = project.status === 'active' || project.status === 'completed'
      ? 85
      : project.status === 'on_hold' ? 55 : 70;

    const healthScore = Math.round(scheduleHealth * 0.4 + budgetHealth * 0.3 + generalHealth * 0.3);

    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (healthScore >= 75) riskLevel = 'low';
    else if (healthScore >= 50) riskLevel = 'medium';
    else if (healthScore >= 25) riskLevel = 'high';
    else riskLevel = 'critical';

    return {
      projectId: project.id,
      projectName: project.name,
      status: project.status,
      priority: project.priority,
      healthScore,
      riskLevel,
      completionRate,
      budgetUtilization,
      CPI,
      SPI,
      daysRemaining,
      taskCount,
      overdueTasks,
      resourceCount,
      overAllocatedResources,
    };
  }

  private computeSnapshotVersion(indicators: PortfolioIndicators): string {
    const data = `${indicators.totalProjects}:${indicators.activeProjects}:${indicators.atRiskProjects.length}:${indicators.budgetDeficitProjects.length}:${indicators.commonRisks.join(',')}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

export const crossProjectIntelligenceAgent = new CrossProjectIntelligenceAgent();
