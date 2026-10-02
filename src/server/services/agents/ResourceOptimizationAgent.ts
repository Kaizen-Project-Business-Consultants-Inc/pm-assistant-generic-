import { reasoningEngine, ResourceAnalysisResult } from './ReasoningEngine';
import { actionProposalService, CreateProposalInput } from './ActionProposalService';
import { confidenceCalculator } from './ConfidenceCalculator';
import { agentCostTracker } from './AgentCostTracker';
import { killSwitchService } from './KillSwitchService';
import { proposalRateLimiter } from './ProposalRateLimiter';
import { degradationHandler } from './DegradationHandler';
import { notificationService } from '../NotificationService';
import { resourceService, ResourceWorkload } from '../ResourceService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResourceOptimizationInput {
  projectId: string;
  userId: string;
  scanId?: string;
}

export interface ResourceIndicators {
  totalResources: number;
  overAllocatedResources: Array<{ resourceId: string; resourceName: string; role: string; averageUtilization: number; peakUtilization: number }>;
  underUtilizedResources: Array<{ resourceId: string; resourceName: string; role: string; averageUtilization: number }>;
  bottleneckRoles: string[];
}

export interface ResourceOptimizationOutput {
  analysis: ResourceAnalysisResult | null;
  proposal: { id: string } | null;
  indicators: ResourceIndicators | null;
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ResourceOptimizationAgent {
  static readonly AGENT_ID = 'resource-optimization-v1';
  static readonly AGENT_VERSION = '1.0.0';

  async run(input: ResourceOptimizationInput): Promise<ResourceOptimizationOutput> {
    const skip = (reason: string): ResourceOptimizationOutput => ({
      analysis: null, proposal: null, indicators: null, skipped: true, skipReason: reason,
    });

    // 1. Check cost budget
    const budget = await agentCostTracker.checkBudget(ResourceOptimizationAgent.AGENT_ID, input.projectId);
    if (!budget.allowed) return skip(budget.reason!);

    // 2. Check kill switch
    const ks = killSwitchService.canRun(ResourceOptimizationAgent.AGENT_ID, input.projectId);
    if (!ks.allowed) return skip(ks.reason!);

    // 3. Check rate limit
    const rl = await proposalRateLimiter.check(ResourceOptimizationAgent.AGENT_ID, input.projectId);
    if (!rl.allowed) return skip(rl.reason!);

    // 4. Check circuit breaker
    const cb = degradationHandler.canAgentRun(ResourceOptimizationAgent.AGENT_ID);
    if (!cb.allowed) return skip(cb.reason!);

    // 5. Gather resource indicators
    let indicators: ResourceIndicators;
    try {
      indicators = await this.gatherIndicators(input.projectId);
    } catch (err) {
      degradationHandler.recordFailure(ResourceOptimizationAgent.AGENT_ID);
      return skip(`Failed to gather resource indicators: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6. Check if indicators are significant
    const isSignificant =
      indicators.overAllocatedResources.length >= 1 ||
      (indicators.underUtilizedResources.length >= 2 && indicators.overAllocatedResources.length >= 0) ||
      indicators.bottleneckRoles.length >= 1;

    if (!isSignificant) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'No significant resource imbalances detected' };
    }

    // 7. Run reasoning engine
    let analysis: ResourceAnalysisResult | null;
    try {
      analysis = await reasoningEngine.generateResourceAnalysis({
        projectId: input.projectId,
        indicators,
        scanId: input.scanId,
      });
    } catch (err) {
      degradationHandler.recordFailure(ResourceOptimizationAgent.AGENT_ID);
      return skip(`Reasoning engine failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!analysis) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'Reasoning engine returned no analysis (Claude unavailable or parse failure)' };
    }

    // 8. Log confidence
    await confidenceCalculator.log(
      ResourceOptimizationAgent.AGENT_ID,
      input.projectId,
      analysis.confidence,
    );

    // 9. Check if confidence allows proposals
    if (!analysis.confidence.canPropose) {
      degradationHandler.recordSuccess(ResourceOptimizationAgent.AGENT_ID);

      await notificationService.create({
        userId: input.userId,
        type: 'agent_low_confidence',
        severity: 'low',
        title: 'Resource imbalance detected (low confidence)',
        message: `Resource issues detected (${indicators.overAllocatedResources.length} over-allocated) but agent confidence is too low (${analysis.confidence.score}%) to propose actions. Review resource allocation manually.`,
        projectId: input.projectId,
      });

      return { analysis, proposal: null, indicators, skipped: true, skipReason: `Confidence too low: ${analysis.confidence.score}%` };
    }

    // 10. Create proposal if actionable
    if (!analysis.hasResourceIssue || analysis.suggestedActions.length === 0) {
      degradationHandler.recordSuccess(ResourceOptimizationAgent.AGENT_ID);
      return { analysis, proposal: null, indicators, skipped: true, skipReason: 'Analysis found no actionable resource issues' };
    }

    const snapshotVersion = this.computeSnapshotVersion(indicators);

    const proposalInput: CreateProposalInput = {
      projectId: input.projectId,
      agentId: ResourceOptimizationAgent.AGENT_ID,
      agentVersion: ResourceOptimizationAgent.AGENT_VERSION,
      title: `Resource Optimization: ${analysis.severity} severity — ${indicators.overAllocatedResources.length} over-allocated`,
      reasoning: analysis.reasoning,
      summary: `**Root Causes:** ${analysis.rootCauses.join(', ')}\n\n**Over-allocated:** ${indicators.overAllocatedResources.map(r => `${r.resourceName} (${r.averageUtilization}%)`).join(', ')}\n\n**Recommendations:** ${analysis.recommendations.join('; ')}`,
      confidenceScore: analysis.confidence.score,
      confidenceFactors: analysis.confidence.factors as unknown as Record<string, unknown>,
      riskLevel: analysis.suggestedActions.length > 5 ? 'critical' : 'high',
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
      ResourceOptimizationAgent.AGENT_ID,
      input.projectId,
      analysis.confidence,
      proposal.id,
    );

    // 12. Notify project owner
    await notificationService.create({
      userId: input.userId,
      type: 'agent_proposal',
      severity: analysis.severity === 'critical' ? 'critical' : 'high',
      title: `Resource optimization proposed (${analysis.severity})`,
      message: `Agent detected resource imbalances: ${indicators.overAllocatedResources.length} over-allocated, ${indicators.underUtilizedResources.length} under-utilized. ${analysis.suggestedActions.length} action(s) proposed.`,
      projectId: input.projectId,
      linkType: 'proposal',
      linkId: proposal.id,
    });

    degradationHandler.recordSuccess(ResourceOptimizationAgent.AGENT_ID);

    return { analysis, proposal: { id: proposal.id }, indicators, skipped: false };
  }

  /**
   * Gather resource workload data and identify imbalances.
   */
  async gatherIndicators(projectId: string): Promise<ResourceIndicators> {
    const workloads = await resourceService.computeWorkload(projectId);

    if (workloads.length === 0) {
      return { totalResources: 0, overAllocatedResources: [], underUtilizedResources: [], bottleneckRoles: [] };
    }

    const overAllocated = workloads
      // Over 100% (all projects counted) in a week they work on this project
      .filter(w => w.isOverAllocated)
      .map(w => ({
        resourceId: w.resourceId,
        resourceName: w.resourceName,
        role: w.role,
        averageUtilization: Math.round(w.averageUtilization),
        peakUtilization: Math.max(...w.weeks.map(wk => wk.utilization)),
      }));

    const underUtilized = workloads
      .filter(w => w.averageUtilization < 40 && !w.isOverAllocated)
      .map(w => ({
        resourceId: w.resourceId,
        resourceName: w.resourceName,
        role: w.role,
        averageUtilization: Math.round(w.averageUtilization),
      }));

    // Identify bottleneck roles: roles where all resources are >80% utilized
    const roleGroups = new Map<string, ResourceWorkload[]>();
    for (const w of workloads) {
      const existing = roleGroups.get(w.role) || [];
      existing.push(w);
      roleGroups.set(w.role, existing);
    }

    const bottleneckRoles: string[] = [];
    for (const [role, members] of roleGroups) {
      if (members.length > 0 && members.every(m => m.averageUtilization > 80)) {
        bottleneckRoles.push(role);
      }
    }

    return {
      totalResources: workloads.length,
      overAllocatedResources: overAllocated,
      underUtilizedResources: underUtilized,
      bottleneckRoles,
    };
  }

  private computeSnapshotVersion(indicators: ResourceIndicators): string {
    const data = `${indicators.totalResources}:${indicators.overAllocatedResources.length}:${indicators.underUtilizedResources.length}:${indicators.bottleneckRoles.join(',')}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

export const resourceOptimizationAgent = new ResourceOptimizationAgent();
