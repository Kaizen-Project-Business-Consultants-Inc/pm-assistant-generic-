import { reasoningEngine, DependencyAnalysisResult } from './ReasoningEngine';
import { actionProposalService, CreateProposalInput } from './ActionProposalService';
import { confidenceCalculator } from './ConfidenceCalculator';
import { agentCostTracker } from './AgentCostTracker';
import { killSwitchService } from './KillSwitchService';
import { proposalRateLimiter } from './ProposalRateLimiter';
import { degradationHandler } from './DegradationHandler';
import { notificationService } from '../NotificationService';
import { scheduleService, Task } from '../ScheduleService';
import { MS_PER_DAY } from '../../utils/constants';
// Lateness compares calendar days: a date is not late until the following day.
// `new Date(dateColumn) < now` was true from midnight UTC — the previous evening
// for anyone west of UTC.
import { isOverdue } from '../../utils/calendarDate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyRiskInput {
  projectId: string;
  userId: string;
  scanId?: string;
}

export interface DependencyIndicators {
  blockedChains: Array<{ chainTaskIds: string[]; chainTaskNames: string[]; blockedByTaskId: string; blockedByTaskName: string; reason: string }>;
  bottleneckTasks: Array<{ taskId: string; taskName: string; dependentCount: number }>;
  longChains: Array<{ depth: number; taskIds: string[]; taskNames: string[] }>;
  totalTasks: number;
  totalDependencies: number;
}

export interface DependencyRiskOutput {
  analysis: DependencyAnalysisResult | null;
  proposal: { id: string } | null;
  indicators: DependencyIndicators | null;
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class DependencyRiskAgent {
  static readonly AGENT_ID = 'dependency-risk-v1';
  static readonly AGENT_VERSION = '1.0.0';

  async run(input: DependencyRiskInput): Promise<DependencyRiskOutput> {
    const skip = (reason: string): DependencyRiskOutput => ({
      analysis: null, proposal: null, indicators: null, skipped: true, skipReason: reason,
    });

    // 1. Check cost budget
    const budget = await agentCostTracker.checkBudget(DependencyRiskAgent.AGENT_ID, input.projectId);
    if (!budget.allowed) return skip(budget.reason!);

    // 2. Check kill switch
    const ks = killSwitchService.canRun(DependencyRiskAgent.AGENT_ID, input.projectId);
    if (!ks.allowed) return skip(ks.reason!);

    // 3. Check rate limit
    const rl = await proposalRateLimiter.check(DependencyRiskAgent.AGENT_ID, input.projectId);
    if (!rl.allowed) return skip(rl.reason!);

    // 4. Check circuit breaker
    const cb = degradationHandler.canAgentRun(DependencyRiskAgent.AGENT_ID);
    if (!cb.allowed) return skip(cb.reason!);

    // 5. Gather indicators
    let indicators: DependencyIndicators;
    try {
      indicators = await this.gatherIndicators(input.projectId);
    } catch (err) {
      degradationHandler.recordFailure(DependencyRiskAgent.AGENT_ID);
      return skip(`Failed to gather dependency indicators: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6. Check significance
    const isSignificant =
      indicators.blockedChains.length >= 1 ||
      indicators.bottleneckTasks.length >= 1 ||
      indicators.longChains.length >= 1;

    if (!isSignificant) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'No significant dependency risks detected' };
    }

    // 7. Run reasoning engine
    let analysis: DependencyAnalysisResult | null;
    try {
      analysis = await reasoningEngine.generateDependencyAnalysis({
        projectId: input.projectId,
        indicators,
        scanId: input.scanId,
      });
    } catch (err) {
      degradationHandler.recordFailure(DependencyRiskAgent.AGENT_ID);
      return skip(`Reasoning engine failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!analysis) {
      return { analysis: null, proposal: null, indicators, skipped: true, skipReason: 'Reasoning engine returned no analysis (Claude unavailable or parse failure)' };
    }

    // 8. Log confidence
    await confidenceCalculator.log(
      DependencyRiskAgent.AGENT_ID,
      input.projectId,
      analysis.confidence,
    );

    // 9. Check if confidence allows proposals
    if (!analysis.confidence.canPropose) {
      degradationHandler.recordSuccess(DependencyRiskAgent.AGENT_ID);

      await notificationService.create({
        userId: input.userId,
        type: 'agent_low_confidence',
        severity: 'low',
        title: 'Dependency risks detected (low confidence)',
        message: `Dependency risks detected but agent confidence is too low (${analysis.confidence.score}%) to propose actions. Review dependency graph manually.`,
        projectId: input.projectId,
      });

      return { analysis, proposal: null, indicators, skipped: true, skipReason: `Confidence too low: ${analysis.confidence.score}%` };
    }

    // 10. Create proposal
    if (!analysis.hasDependencyRisk || analysis.suggestedActions.length === 0) {
      degradationHandler.recordSuccess(DependencyRiskAgent.AGENT_ID);
      return { analysis, proposal: null, indicators, skipped: true, skipReason: 'Analysis found no actionable dependency risks' };
    }

    const snapshotVersion = this.computeSnapshotVersion(indicators);

    const proposalInput: CreateProposalInput = {
      projectId: input.projectId,
      agentId: DependencyRiskAgent.AGENT_ID,
      agentVersion: DependencyRiskAgent.AGENT_VERSION,
      title: `Dependency Risk Alert: ${analysis.severity} severity`,
      reasoning: analysis.reasoning,
      summary: `**Risks:** ${analysis.risks.join(', ')}\n\n**Recommendations:** ${analysis.recommendations.join('; ')}`,
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
      DependencyRiskAgent.AGENT_ID,
      input.projectId,
      analysis.confidence,
      proposal.id,
    );

    // 12. Notify project owner
    await notificationService.create({
      userId: input.userId,
      type: 'agent_proposal',
      severity: analysis.severity === 'critical' ? 'critical' : analysis.severity === 'high' ? 'high' : 'medium',
      title: `Dependency risks detected (${analysis.severity})`,
      message: `Agent found ${indicators.blockedChains.length} blocked chain(s), ${indicators.bottleneckTasks.length} bottleneck task(s), ${indicators.longChains.length} long chain(s). ${analysis.suggestedActions.length} action(s) proposed.`,
      projectId: input.projectId,
      linkType: 'proposal',
      linkId: proposal.id,
    });

    degradationHandler.recordSuccess(DependencyRiskAgent.AGENT_ID);

    return { analysis, proposal: { id: proposal.id }, indicators, skipped: false };
  }

  async gatherIndicators(projectId: string): Promise<DependencyIndicators> {
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) {
      return { blockedChains: [], bottleneckTasks: [], longChains: [], totalTasks: 0, totalDependencies: 0 };
    }

    // Gather all tasks across schedules (batch query)
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));

    if (allTasks.length === 0) {
      return { blockedChains: [], bottleneckTasks: [], longChains: [], totalTasks: 0, totalDependencies: 0 };
    }

    // Build dependency graph
    const taskMap = new Map<string, Task>();
    const dependents = new Map<string, string[]>(); // taskId -> tasks that depend on it
    let totalDependencies = 0;

    for (const task of allTasks) {
      taskMap.set(task.id, task);
    }

    for (const task of allTasks) {
      for (const dep of task.dependencies) {
        if (taskMap.has(dep.dependencyId)) {
          totalDependencies++;
          const deps = dependents.get(dep.dependencyId) || [];
          deps.push(task.id);
          dependents.set(dep.dependencyId, deps);
        }
      }
    }

    const now = new Date();

    // Detect blocked chains: tasks depending on overdue or stalled tasks
    const blockedChains: DependencyIndicators['blockedChains'] = [];
    for (const task of allTasks) {
      if (task.dependencies.length === 0) continue;
      for (const dep of task.dependencies) {
      const blocker = taskMap.get(dep.dependencyId);
      if (!blocker) continue;

      const isBlockerOverdue = blocker.endDate && isOverdue(blocker.endDate) &&
        blocker.status !== 'completed' && blocker.status !== 'cancelled';
      const isBlockerStalled = blocker.status === 'in_progress' &&
        (!blocker.progressPercentage || blocker.progressPercentage === 0) &&
        blocker.updatedAt && (now.getTime() - new Date(blocker.updatedAt).getTime()) > 7 * MS_PER_DAY;

      if (isBlockerOverdue || isBlockerStalled) {
        // Walk the chain downstream
        const chain = this.walkChain(task.id, dependents, taskMap, 5);
        blockedChains.push({
          chainTaskIds: [task.id, ...chain.map(t => t.id)],
          chainTaskNames: [task.name, ...chain.map(t => t.name)],
          blockedByTaskId: blocker.id,
          blockedByTaskName: blocker.name,
          reason: isBlockerOverdue ? 'overdue' : 'stalled',
        });
      }
      } // end for dep
    }

    // Detect bottleneck tasks: tasks with 3+ dependents
    const bottleneckTasks: DependencyIndicators['bottleneckTasks'] = [];
    for (const [taskId, deps] of dependents) {
      if (deps.length >= 3) {
        const task = taskMap.get(taskId);
        if (task && task.status !== 'completed' && task.status !== 'cancelled') {
          bottleneckTasks.push({ taskId, taskName: task.name, dependentCount: deps.length });
        }
      }
    }
    bottleneckTasks.sort((a, b) => b.dependentCount - a.dependentCount);

    // Detect long chains: dependency depth > 5
    const longChains: DependencyIndicators['longChains'] = [];
    for (const task of allTasks) {
      if (task.dependencies.length > 0) continue; // Start from root tasks (no dependencies)
      const chain = this.measureDepth(task.id, dependents, taskMap, 10);
      if (chain.length > 5) {
        longChains.push({
          depth: chain.length,
          taskIds: chain.map(t => t.id),
          taskNames: chain.map(t => t.name),
        });
      }
    }

    return {
      blockedChains: blockedChains.slice(0, 10),
      bottleneckTasks: bottleneckTasks.slice(0, 10),
      longChains: longChains.slice(0, 5),
      totalTasks: allTasks.length,
      totalDependencies,
    };
  }

  private walkChain(
    startId: string,
    dependents: Map<string, string[]>,
    taskMap: Map<string, Task>,
    maxDepth: number,
  ): Array<{ id: string; name: string }> {
    const result: Array<{ id: string; name: string }> = [];
    const deps = dependents.get(startId) || [];
    for (const depId of deps) {
      if (result.length >= maxDepth) break;
      const task = taskMap.get(depId);
      if (task) {
        result.push({ id: task.id, name: task.name });
        if (result.length < maxDepth) {
          result.push(...this.walkChain(depId, dependents, taskMap, maxDepth - result.length));
        }
      }
    }
    return result;
  }

  private measureDepth(
    rootId: string,
    dependents: Map<string, string[]>,
    taskMap: Map<string, Task>,
    maxDepth: number,
  ): Array<{ id: string; name: string }> {
    const task = taskMap.get(rootId);
    if (!task) return [];

    const chain: Array<{ id: string; name: string }> = [{ id: task.id, name: task.name }];
    const deps = dependents.get(rootId) || [];

    // Find the longest chain from this root
    let longestSub: Array<{ id: string; name: string }> = [];
    for (const depId of deps) {
      if (chain.length >= maxDepth) break;
      const sub = this.measureDepth(depId, dependents, taskMap, maxDepth - 1);
      if (sub.length > longestSub.length) {
        longestSub = sub;
      }
    }

    return [...chain, ...longestSub];
  }

  private computeSnapshotVersion(indicators: DependencyIndicators): string {
    const data = `${indicators.blockedChains.length}:${indicators.bottleneckTasks.length}:${indicators.longChains.length}:${indicators.totalDependencies}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

export const dependencyRiskAgent = new DependencyRiskAgent();
