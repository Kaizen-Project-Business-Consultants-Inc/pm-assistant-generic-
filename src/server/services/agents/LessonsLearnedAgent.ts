import { reasoningEngine, LessonsExtractionResult } from './ReasoningEngine';
import { actionProposalService, CreateProposalInput } from './ActionProposalService';
import { confidenceCalculator } from './ConfidenceCalculator';
import { agentCostTracker } from './AgentCostTracker';
import { killSwitchService } from './KillSwitchService';
import { proposalRateLimiter } from './ProposalRateLimiter';
import { degradationHandler } from './DegradationHandler';
import { notificationService } from '../NotificationService';
import { projectService } from '../ProjectService';
import { scheduleService, Task } from '../ScheduleService';
import { lessonsLearnedService } from '../LessonsLearnedService';
import { databaseService } from '../../database/connection';
import { MS_PER_DAY } from '../../utils/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LessonsLearnedInput {
  projectId: string;
  userId: string;
  scanId?: string;
}

export interface LessonsLearnedOutput {
  analysis: LessonsExtractionResult | null;
  proposal: { id: string } | null;
  lessonsExtracted: number;
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class LessonsLearnedAgentClass {
  static readonly AGENT_ID = 'lessons-learned-v1';
  static readonly AGENT_VERSION = '1.0.0';

  async run(input: LessonsLearnedInput): Promise<LessonsLearnedOutput> {
    const skip = (reason: string): LessonsLearnedOutput => ({
      analysis: null, proposal: null, lessonsExtracted: 0, skipped: true, skipReason: reason,
    });

    // 1. Check cost budget
    const budget = await agentCostTracker.checkBudget(LessonsLearnedAgentClass.AGENT_ID, input.projectId);
    if (!budget.allowed) return skip(budget.reason!);

    // 2. Check kill switch
    const ks = killSwitchService.canRun(LessonsLearnedAgentClass.AGENT_ID, input.projectId);
    if (!ks.allowed) return skip(ks.reason!);

    // 3. Check rate limit
    const rl = await proposalRateLimiter.check(LessonsLearnedAgentClass.AGENT_ID, input.projectId);
    if (!rl.allowed) return skip(rl.reason!);

    // 4. Check circuit breaker
    const cb = degradationHandler.canAgentRun(LessonsLearnedAgentClass.AGENT_ID);
    if (!cb.allowed) return skip(cb.reason!);

    // 5. Check project eligibility: completion >= 90% or status = 'completed'
    const project = await projectService.findById(input.projectId);
    if (!project) return skip('Project not found');

    const schedules = await scheduleService.findByProjectId(input.projectId);
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));

    const completedTasks = allTasks.filter(t => t.status === 'completed').length;
    const totalTasks = allTasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    if (project.status !== 'completed' && completionRate < 90) {
      return skip(`Project not near completion (${completionRate}% complete, status: ${project.status})`);
    }

    // 6. Count existing lessons to avoid duplicates
    let existingLessonsCount = 0;
    try {
      const rows = await databaseService.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM lessons_learned WHERE project_id = ?`,
        [input.projectId],
      );
      existingLessonsCount = Number(rows[0]?.cnt ?? 0);
    } catch {
      // Table may not exist
    }

    // Skip if we've already extracted many lessons for this project
    if (existingLessonsCount >= 10) {
      return skip(`Already have ${existingLessonsCount} lessons for this project — skipping to avoid duplicates`);
    }

    // 7. Compute project data for reasoning
    const overdueTasks = allTasks.filter(t =>
      t.endDate && new Date(t.endDate) < new Date() && t.status !== 'completed' && t.status !== 'cancelled'
    ).length;

    const now = new Date();
    const startDate = project.startDate ? new Date(project.startDate) : now;
    const durationDays = Math.max(1, Math.round((now.getTime() - startDate.getTime()) / MS_PER_DAY));

    let budgetVariance: number | null = null;
    if (project.budgetAllocated && project.budgetSpent !== undefined) {
      budgetVariance = project.budgetAllocated - (project.budgetSpent || 0);
    }

    // 8. Run reasoning engine
    let analysis: LessonsExtractionResult | null;
    try {
      analysis = await reasoningEngine.generateLessonsExtraction({
        projectId: input.projectId,
        projectData: {
          projectName: project.name,
          status: project.status,
          completionRate,
          totalTasks,
          completedTasks,
          overdueTasks,
          budgetVariance,
          durationDays,
          existingLessonsCount,
        },
        scanId: input.scanId,
      });
    } catch (err) {
      degradationHandler.recordFailure(LessonsLearnedAgentClass.AGENT_ID);
      return skip(`Reasoning engine failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!analysis) {
      return { analysis: null, proposal: null, lessonsExtracted: 0, skipped: true, skipReason: 'Reasoning engine returned no analysis (Claude unavailable or parse failure)' };
    }

    // 9. Log confidence
    await confidenceCalculator.log(
      LessonsLearnedAgentClass.AGENT_ID,
      input.projectId,
      analysis.confidence,
    );

    if (!analysis.hasLessons || analysis.lessons.length === 0) {
      degradationHandler.recordSuccess(LessonsLearnedAgentClass.AGENT_ID);
      return { analysis, proposal: null, lessonsExtracted: 0, skipped: true, skipReason: 'No lessons extracted from project data' };
    }

    // 10. Store lessons via lessonsLearnedService
    const validCategories = ['schedule', 'budget', 'resource', 'risk', 'technical', 'communication', 'stakeholder', 'quality'] as const;
    const validImpacts = ['positive', 'negative', 'neutral'] as const;
    let stored = 0;
    for (const lesson of analysis.lessons) {
      try {
        const category = validCategories.includes(lesson.category as any)
          ? lesson.category as typeof validCategories[number]
          : 'quality';
        const impact = lesson.impact === 'high' ? 'negative' : lesson.impact === 'low' ? 'positive' : 'neutral';
        await lessonsLearnedService.addLesson({
          projectId: input.projectId,
          projectName: project.name,
          projectType: project.projectType,
          category,
          title: lesson.title,
          description: lesson.description,
          impact,
          recommendation: lesson.recommendation,
          sourceType: 'agent',
          createdBy: input.userId ? parseInt(input.userId, 10) : undefined,
          status: 'draft',
        });
        stored++;
      } catch {
        // Individual lesson storage failure is non-critical
      }
    }

    // 11. Create proposal with lessons summary
    const snapshotVersion = `${completionRate}:${totalTasks}:${existingLessonsCount}`;

    const proposalInput: CreateProposalInput = {
      projectId: input.projectId,
      agentId: LessonsLearnedAgentClass.AGENT_ID,
      agentVersion: LessonsLearnedAgentClass.AGENT_VERSION,
      title: `Lessons Learned: ${analysis.lessons.length} lesson(s) extracted`,
      reasoning: analysis.reasoning,
      summary: analysis.lessons.map(l => `**${l.title}** (${l.category}, ${l.impact} impact): ${l.description}`).join('\n\n'),
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
          lessonsCount: analysis.lessons.length,
          lessons: analysis.lessons,
        },
        reasoning: 'Auto-extracted lessons learned for project manager review',
      }],
    };

    const proposal = await actionProposalService.create(proposalInput);

    // 12. Update confidence log with proposal ID
    await confidenceCalculator.log(
      LessonsLearnedAgentClass.AGENT_ID,
      input.projectId,
      analysis.confidence,
      proposal.id,
    );

    // 13. Notify project manager
    await notificationService.create({
      userId: input.userId,
      type: 'agent_proposal',
      severity: 'low',
      title: `Lessons learned extracted: ${project.name}`,
      message: `Agent extracted ${analysis.lessons.length} lesson(s) from project data (${stored} stored). Review the lessons for accuracy and completeness.`,
      projectId: input.projectId,
      linkType: 'proposal',
      linkId: proposal.id,
    });

    degradationHandler.recordSuccess(LessonsLearnedAgentClass.AGENT_ID);

    return { analysis, proposal: { id: proposal.id }, lessonsExtracted: stored, skipped: false };
  }
}

export const lessonsLearnedAgent = new LessonsLearnedAgentClass();
