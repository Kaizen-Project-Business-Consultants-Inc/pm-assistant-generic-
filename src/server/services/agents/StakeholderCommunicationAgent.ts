import { reasoningEngine, StakeholderReportResult } from './ReasoningEngine';
import { actionProposalService, CreateProposalInput } from './ActionProposalService';
import { confidenceCalculator } from './ConfidenceCalculator';
import { agentCostTracker } from './AgentCostTracker';
import { killSwitchService } from './KillSwitchService';
import { proposalRateLimiter } from './ProposalRateLimiter';
import { degradationHandler } from './DegradationHandler';
import { notificationService } from '../NotificationService';
import { projectService, Project } from '../ProjectService';
import { scheduleService, Task } from '../ScheduleService';
import { computeEVMMetrics } from '../predictiveIntelligence';
import { MS_PER_DAY } from '../../utils/constants';
// Lateness compares calendar days: a date is not late until the following day.
// `new Date(dateColumn) < now` was true from midnight UTC — the previous evening
// for anyone west of UTC.
import { isOverdue } from '../../utils/calendarDate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StakeholderCommunicationInput {
  projectId: string;
  userId: string;
  scanId?: string;
}

export interface ProjectStatusSnapshot {
  projectName: string;
  status: string;
  completionRate: number;
  budgetUtilization: number;
  CPI: number | null;
  SPI: number | null;
  daysRemaining: number;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  upcomingMilestones: Array<{ name: string; endDate: string; daysUntil: number }>;
  recentlyCompleted: Array<{ name: string; completedDate: string }>;
  riskIndicators: string[];
}

export interface StakeholderCommunicationOutput {
  analysis: StakeholderReportResult | null;
  proposal: { id: string } | null;
  snapshot: ProjectStatusSnapshot | null;
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class StakeholderCommunicationAgent {
  static readonly AGENT_ID = 'stakeholder-communication-v1';
  static readonly AGENT_VERSION = '1.0.0';

  async run(input: StakeholderCommunicationInput): Promise<StakeholderCommunicationOutput> {
    const skip = (reason: string): StakeholderCommunicationOutput => ({
      analysis: null, proposal: null, snapshot: null, skipped: true, skipReason: reason,
    });

    // 1. Check cost budget
    const budget = await agentCostTracker.checkBudget(StakeholderCommunicationAgent.AGENT_ID, input.projectId);
    if (!budget.allowed) return skip(budget.reason!);

    // 2. Check kill switch
    const ks = killSwitchService.canRun(StakeholderCommunicationAgent.AGENT_ID, input.projectId);
    if (!ks.allowed) return skip(ks.reason!);

    // 3. Check rate limit
    const rl = await proposalRateLimiter.check(StakeholderCommunicationAgent.AGENT_ID, input.projectId);
    if (!rl.allowed) return skip(rl.reason!);

    // 4. Check circuit breaker
    const cb = degradationHandler.canAgentRun(StakeholderCommunicationAgent.AGENT_ID);
    if (!cb.allowed) return skip(cb.reason!);

    // 5. Gather project status snapshot
    let snapshot: ProjectStatusSnapshot;
    try {
      snapshot = await this.gatherSnapshot(input.projectId);
    } catch (err) {
      degradationHandler.recordFailure(StakeholderCommunicationAgent.AGENT_ID);
      return skip(`Failed to gather project snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6. Check if project has enough data to warrant a report
    if (snapshot.totalTasks === 0) {
      return { analysis: null, proposal: null, snapshot, skipped: true, skipReason: 'No tasks in project — nothing to report' };
    }

    // 7. Run reasoning engine to generate stakeholder report
    let analysis: StakeholderReportResult | null;
    try {
      analysis = await reasoningEngine.generateStakeholderReport({
        projectId: input.projectId,
        snapshot,
        scanId: input.scanId,
      });
    } catch (err) {
      degradationHandler.recordFailure(StakeholderCommunicationAgent.AGENT_ID);
      return skip(`Reasoning engine failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!analysis) {
      return { analysis: null, proposal: null, snapshot, skipped: true, skipReason: 'Reasoning engine returned no report (Claude unavailable or parse failure)' };
    }

    // 8. Log confidence
    await confidenceCalculator.log(
      StakeholderCommunicationAgent.AGENT_ID,
      input.projectId,
      analysis.confidence,
    );

    // 9. Create proposal to send the stakeholder report
    const snapshotVersion = this.computeSnapshotVersion(snapshot);

    const proposalInput: CreateProposalInput = {
      projectId: input.projectId,
      agentId: StakeholderCommunicationAgent.AGENT_ID,
      agentVersion: StakeholderCommunicationAgent.AGENT_VERSION,
      title: `Status Report: ${snapshot.projectName} — ${analysis.overallStatus}`,
      reasoning: analysis.reasoning,
      summary: analysis.executiveSummary,
      confidenceScore: analysis.confidence.score,
      confidenceFactors: analysis.confidence.factors as unknown as Record<string, unknown>,
      riskLevel: 'low',
      dataSnapshotVersion: snapshotVersion,
      createdBy: input.userId,
      actions: [{
        executionOrder: 1,
        actionType: 'send_notification',
        targetEntityType: 'project',
        targetEntityId: input.projectId,
        oldValue: {},
        newValue: {
          reportType: 'stakeholder_status',
          executiveSummary: analysis.executiveSummary,
          keyHighlights: analysis.keyHighlights,
          risksAndConcerns: analysis.risksAndConcerns,
          upcomingMilestones: analysis.upcomingMilestones,
          recommendedActions: analysis.recommendedActions,
        },
        reasoning: 'Auto-generated stakeholder status report for project manager review before distribution',
      }],
    };

    const proposal = await actionProposalService.create(proposalInput);

    // 10. Update confidence log with proposal ID
    await confidenceCalculator.log(
      StakeholderCommunicationAgent.AGENT_ID,
      input.projectId,
      analysis.confidence,
      proposal.id,
    );

    // 11. Notify project manager
    await notificationService.create({
      userId: input.userId,
      type: 'agent_proposal',
      severity: 'low',
      title: `Status report ready: ${snapshot.projectName}`,
      message: `Auto-generated stakeholder status report. Overall status: ${analysis.overallStatus}. ${analysis.keyHighlights.length} highlight(s), ${analysis.risksAndConcerns.length} risk(s). Review and approve to distribute.`,
      projectId: input.projectId,
      linkType: 'proposal',
      linkId: proposal.id,
    });

    degradationHandler.recordSuccess(StakeholderCommunicationAgent.AGENT_ID);

    return { analysis, proposal: { id: proposal.id }, snapshot, skipped: false };
  }

  /**
   * Gather a comprehensive project status snapshot for report generation.
   */
  async gatherSnapshot(projectId: string): Promise<ProjectStatusSnapshot> {
    const project = await projectService.findById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const now = new Date();
    const startDate = project.startDate ? new Date(project.startDate) : now;
    const endDate = project.endDate ? new Date(project.endDate) : new Date(now.getTime() + 365 * MS_PER_DAY);
    const daysElapsed = Math.max(0, Math.round((now.getTime() - startDate.getTime()) / MS_PER_DAY));
    const daysRemaining = Math.max(0, Math.round((endDate.getTime() - now.getTime()) / MS_PER_DAY));
    const totalDays = daysElapsed + daysRemaining;

    // Get all tasks
    const schedules = await scheduleService.findByProjectId(projectId);
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));

    const completedTasks = allTasks.filter(t => t.status === 'completed');
    const inProgressTasks = allTasks.filter(t => t.status === 'in_progress');
    const overdueTasks = allTasks.filter(t =>
      t.endDate && isOverdue(t.endDate) && t.status !== 'completed' && t.status !== 'cancelled'
    );

    const completionRate = allTasks.length > 0
      ? Math.round((completedTasks.length / allTasks.length) * 100)
      : 0;

    // EVM metrics
    let CPI: number | null = null;
    let SPI: number | null = null;
    const budgetAllocated = project.budgetAllocated || 0;
    const budgetSpent = project.budgetSpent || 0;
    const budgetUtilization = budgetAllocated > 0 ? Math.round((budgetSpent / budgetAllocated) * 100) : 0;

    if (budgetAllocated > 0 && totalDays > 0) {
      try {
        const evm = computeEVMMetrics(budgetAllocated, budgetSpent, completionRate, daysElapsed, totalDays);
        CPI = Math.round(evm.cpi * 100) / 100;
        SPI = Math.round(evm.spi * 100) / 100;
      } catch {
        // EVM not available
      }
    }

    // Upcoming milestones (tasks ending in next 14 days)
    const fourteenDaysOut = new Date(now.getTime() + 14 * MS_PER_DAY);
    const upcomingMilestones = allTasks
      .filter(t => t.endDate && new Date(t.endDate) >= now && new Date(t.endDate) <= fourteenDaysOut && t.status !== 'completed' && t.status !== 'cancelled')
      .sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime())
      .slice(0, 5)
      .map(t => ({
        name: t.name,
        endDate: t.endDate!,
        daysUntil: Math.ceil((new Date(t.endDate!).getTime() - now.getTime()) / MS_PER_DAY),
      }));

    // Recently completed (last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
    const recentlyCompleted = completedTasks
      .filter(t => t.updatedAt && new Date(t.updatedAt) >= sevenDaysAgo)
      .sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime())
      .slice(0, 5)
      .map(t => ({
        name: t.name,
        completedDate: t.updatedAt!,
      }));

    // Risk indicators
    const riskIndicators: string[] = [];
    if (overdueTasks.length > 0) riskIndicators.push(`${overdueTasks.length} overdue task(s)`);
    if (CPI !== null && CPI < 0.9) riskIndicators.push(`CPI ${CPI} (over budget)`);
    if (SPI !== null && SPI < 0.9) riskIndicators.push(`SPI ${SPI} (behind schedule)`);
    if (budgetUtilization > 90 && completionRate < 70) riskIndicators.push('High budget burn with low completion');
    if (daysRemaining < 14 && completionRate < 80) riskIndicators.push(`Only ${daysRemaining} days remaining at ${completionRate}% complete`);

    return {
      projectName: project.name,
      status: project.status,
      completionRate,
      budgetUtilization,
      CPI,
      SPI,
      daysRemaining,
      totalTasks: allTasks.length,
      completedTasks: completedTasks.length,
      inProgressTasks: inProgressTasks.length,
      overdueTasks: overdueTasks.length,
      upcomingMilestones,
      recentlyCompleted,
      riskIndicators,
    };
  }

  private computeSnapshotVersion(snapshot: ProjectStatusSnapshot): string {
    const data = `${snapshot.totalTasks}:${snapshot.completedTasks}:${snapshot.overdueTasks}:${snapshot.completionRate}:${snapshot.budgetUtilization}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

export const stakeholderCommunicationAgent = new StakeholderCommunicationAgent();
