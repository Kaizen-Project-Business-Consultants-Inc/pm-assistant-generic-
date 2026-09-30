import { reasoningEngine, PredictiveAlertResult } from './ReasoningEngine';
import { actionProposalService, CreateProposalInput } from './ActionProposalService';
import { confidenceCalculator } from './ConfidenceCalculator';
import { agentCostTracker } from './AgentCostTracker';
import { killSwitchService } from './KillSwitchService';
import { proposalRateLimiter } from './ProposalRateLimiter';
import { degradationHandler } from './DegradationHandler';
import { notificationService } from '../NotificationService';
import { projectService } from '../ProjectService';
import { scheduleService, Task } from '../ScheduleService';
import { databaseService } from '../../database/connection';
import { MS_PER_DAY } from '../../utils/constants';
import { utcDay } from '../../utils/workingDays';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PredictiveAlertingInput {
  projectId: string;
  userId: string;
  scanId?: string;
}

export interface PredictiveIndicators {
  velocityTrend: { current: number; historical: number; declinePercent: number } | null;
  progressTrajectory: { completionRate: number; timeElapsedPercent: number; behindPercent: number };
  riskAccumulation: number;
  similarProjectComparison: { avgCompletionRate: number; avgBudgetVariance: number; sampleSize: number } | null;
}

export interface PredictiveAlertingOutput {
  analysis: PredictiveAlertResult | null;
  proposal: { id: string } | null;
  indicators: PredictiveIndicators | null;
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class PredictiveAlertingAgent {
  static readonly AGENT_ID = 'predictive-alerting-v1';
  static readonly AGENT_VERSION = '1.0.0';

  async run(input: PredictiveAlertingInput): Promise<PredictiveAlertingOutput> {
    const skip = (reason: string): PredictiveAlertingOutput => ({
      analysis: null, proposal: null, indicators: null, skipped: true, skipReason: reason,
    });

    // 1. Check cost budget
    const budget = await agentCostTracker.checkBudget(PredictiveAlertingAgent.AGENT_ID, input.projectId);
    if (!budget.allowed) return skip(budget.reason!);

    // 2. Check kill switch
    const ks = killSwitchService.canRun(PredictiveAlertingAgent.AGENT_ID, input.projectId);
    if (!ks.allowed) return skip(ks.reason!);

    // 3. Check rate limit
    const rl = await proposalRateLimiter.check(PredictiveAlertingAgent.AGENT_ID, input.projectId);
    if (!rl.allowed) return skip(rl.reason!);

    // 4. Check circuit breaker
    const cb = degradationHandler.canAgentRun(PredictiveAlertingAgent.AGENT_ID);
    if (!cb.allowed) return skip(cb.reason!);

    // 5. Gather indicators
    let indicators: PredictiveIndicators;
    try {
      indicators = await this.gatherIndicators(input.projectId);
    } catch (err) {
      degradationHandler.recordFailure(PredictiveAlertingAgent.AGENT_ID);
      return skip(`Failed to gather predictive indicators: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6. Check significance
    const velocityDecline = indicators.velocityTrend?.declinePercent ?? 0;
    const behindSchedule = indicators.progressTrajectory.behindPercent;
    const isSignificant =
      velocityDecline > 20 ||
      behindSchedule > 15 ||
      indicators.riskAccumulation >= 3;

    if (!isSignificant) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'No significant predictive indicators' };
    }

    // 7. Run reasoning engine
    let analysis: PredictiveAlertResult | null;
    try {
      analysis = await reasoningEngine.generatePredictiveAlert({
        projectId: input.projectId,
        indicators,
        scanId: input.scanId,
      });
    } catch (err) {
      degradationHandler.recordFailure(PredictiveAlertingAgent.AGENT_ID);
      return skip(`Reasoning engine failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!analysis) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'Reasoning engine returned no analysis (Claude unavailable or parse failure)' };
    }

    // 8. Log confidence
    await confidenceCalculator.log(
      PredictiveAlertingAgent.AGENT_ID,
      input.projectId,
      analysis.confidence,
    );

    // 9. Check if confidence allows proposals
    if (!analysis.confidence.canPropose) {
      degradationHandler.recordSuccess(PredictiveAlertingAgent.AGENT_ID);

      await notificationService.create({
        userId: input.userId,
        type: 'agent_low_confidence',
        severity: 'low',
        title: 'Predictive warning detected (low confidence)',
        message: `Early warning indicators detected but agent confidence is too low (${analysis.confidence.score}%) to propose actions. Monitor project trends manually.`,
        projectId: input.projectId,
      });

      return { analysis, proposal: null, indicators, skipped: true, skipReason: `Confidence too low: ${analysis.confidence.score}%` };
    }

    // 10. Create proposal
    if (!analysis.hasWarning || analysis.suggestedActions.length === 0) {
      degradationHandler.recordSuccess(PredictiveAlertingAgent.AGENT_ID);
      return { analysis, proposal: null, indicators, skipped: true, skipReason: 'Analysis found no actionable warnings' };
    }

    const snapshotVersion = this.computeSnapshotVersion(indicators);

    const proposalInput: CreateProposalInput = {
      projectId: input.projectId,
      agentId: PredictiveAlertingAgent.AGENT_ID,
      agentVersion: PredictiveAlertingAgent.AGENT_VERSION,
      title: `Predictive Alert: ${analysis.severity} severity`,
      reasoning: analysis.reasoning,
      summary: `**Warnings:** ${analysis.warnings.join(', ')}\n\n**Predictions:** ${analysis.predictions.join('; ')}\n\n**Recommendations:** ${analysis.recommendations.join('; ')}`,
      confidenceScore: analysis.confidence.score,
      confidenceFactors: analysis.confidence.factors as unknown as Record<string, unknown>,
      riskLevel: analysis.severity === 'critical' ? 'critical' : analysis.severity === 'high' ? 'high' : 'medium',
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
      PredictiveAlertingAgent.AGENT_ID,
      input.projectId,
      analysis.confidence,
      proposal.id,
    );

    // 12. Notify project owner
    await notificationService.create({
      userId: input.userId,
      type: 'agent_proposal',
      severity: analysis.severity === 'critical' ? 'critical' : analysis.severity === 'high' ? 'high' : 'medium',
      title: `Predictive warning: ${analysis.severity} severity`,
      message: `Agent detected early warning signals: velocity decline ${velocityDecline.toFixed(0)}%, behind schedule ${behindSchedule.toFixed(0)}%, ${indicators.riskAccumulation} agent flags in last 30 days. ${analysis.suggestedActions.length} action(s) proposed.`,
      projectId: input.projectId,
      linkType: 'proposal',
      linkId: proposal.id,
    });

    degradationHandler.recordSuccess(PredictiveAlertingAgent.AGENT_ID);

    return { analysis, proposal: { id: proposal.id }, indicators, skipped: false };
  }

  async gatherIndicators(projectId: string): Promise<PredictiveIndicators> {
    const project = await projectService.findById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const now = utcDay(new Date());
    const startDate = project.startDate ? new Date(project.startDate) : now;
    const endDate = project.endDate ? new Date(project.endDate) : new Date(now.getTime() + 365 * MS_PER_DAY);
    const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY));
    const daysElapsed = Math.max(0, Math.round((now.getTime() - startDate.getTime()) / MS_PER_DAY));
    const timeElapsedPercent = Math.min(100, Math.round((daysElapsed / totalDays) * 100));

    // Get all tasks for completion rate
    const schedules = await scheduleService.findByProjectId(projectId);
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));

    const completedTasks = allTasks.filter(t => t.status === 'completed').length;
    const totalTasks = allTasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const behindPercent = Math.max(0, timeElapsedPercent - completionRate);

    // Velocity trend from sprint data
    let velocityTrend: PredictiveIndicators['velocityTrend'] = null;
    try {
      const sprintRows = await databaseService.query<{ story_points_completed: number; status: string; end_date: string }>(
        `SELECT story_points_completed, status, end_date FROM sprints
         WHERE project_id = ? AND status = 'completed'
         ORDER BY end_date DESC LIMIT 10`,
        [projectId],
      );
      if (sprintRows.length >= 3) {
        const recentVelocity = sprintRows.slice(0, 3).reduce((s, r) => s + Number(r.story_points_completed || 0), 0) / 3;
        const historicalVelocity = sprintRows.reduce((s, r) => s + Number(r.story_points_completed || 0), 0) / sprintRows.length;
        const declinePercent = historicalVelocity > 0
          ? Math.max(0, Math.round(((historicalVelocity - recentVelocity) / historicalVelocity) * 100))
          : 0;
        velocityTrend = { current: recentVelocity, historical: historicalVelocity, declinePercent };
      }
    } catch {
      // Sprint data optional
    }

    // Risk accumulation: count agent proposals in last 30 days
    let riskAccumulation = 0;
    try {
      const rows = await databaseService.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM agent_proposals
         WHERE project_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [projectId],
      );
      riskAccumulation = Number(rows[0]?.cnt ?? 0);
    } catch {
      // Table may not exist
    }

    // Similar project comparison
    let similarProjectComparison: PredictiveIndicators['similarProjectComparison'] = null;
    try {
      const similarRows = await databaseService.query<{ completion_rate: number; budget_variance: number }>(
        `SELECT
           ROUND(
             (SELECT COUNT(*) FROM tasks t
              JOIN schedules s ON t.schedule_id = s.id
              WHERE s.project_id = p.id AND t.status = 'completed')
             * 100.0 /
             NULLIF((SELECT COUNT(*) FROM tasks t
              JOIN schedules s ON t.schedule_id = s.id
              WHERE s.project_id = p.id), 0)
           ) AS completion_rate,
           COALESCE(p.budget_allocated - p.budget_spent, 0) AS budget_variance
         FROM projects p
         WHERE p.status = 'completed'
           AND p.id != ?
         LIMIT 10`,
        [projectId],
      );
      if (similarRows.length >= 2) {
        const avgCompletionRate = similarRows.reduce((s, r) => s + Number(r.completion_rate || 0), 0) / similarRows.length;
        const avgBudgetVariance = similarRows.reduce((s, r) => s + Number(r.budget_variance || 0), 0) / similarRows.length;
        similarProjectComparison = { avgCompletionRate, avgBudgetVariance, sampleSize: similarRows.length };
      }
    } catch {
      // Comparison is optional
    }

    return {
      velocityTrend,
      progressTrajectory: { completionRate, timeElapsedPercent, behindPercent },
      riskAccumulation,
      similarProjectComparison,
    };
  }

  private computeSnapshotVersion(indicators: PredictiveIndicators): string {
    const data = `${indicators.progressTrajectory.completionRate}:${indicators.progressTrajectory.timeElapsedPercent}:${indicators.riskAccumulation}:${indicators.velocityTrend?.declinePercent ?? 0}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

export const predictiveAlertingAgent = new PredictiveAlertingAgent();
