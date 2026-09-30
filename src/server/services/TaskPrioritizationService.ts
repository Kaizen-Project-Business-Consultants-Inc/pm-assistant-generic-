import { scheduleService, Task } from './ScheduleService';
import { criticalPathService, CPMTaskResult } from './CriticalPathService';
import { autoRescheduleService } from './AutoRescheduleService';
import { claudeService } from './claudeService';
import { config } from '../config';
import logger from '../utils/logger';
import { utcDay } from '../utils/workingDays';
import {
  PrioritizedTask,
  PrioritizationResult,
  PrioritizationAIResponseSchema,
  PrioritizationAIResponse,
  PriorityFactor,
} from '../schemas/taskPrioritizationSchemas';

const DAY_MS = 24 * 60 * 60 * 1000;

type Priority = 'low' | 'medium' | 'high' | 'urgent';

function scoreToPriority(score: number): Priority {
  if (score >= 76) return 'urgent';
  if (score >= 51) return 'high';
  if (score >= 26) return 'medium';
  return 'low';
}

export class TaskPrioritizationService {
  // ---------------------------------------------------------------------------
  // Prioritize Tasks
  // ---------------------------------------------------------------------------

  async prioritizeTasks(projectId: string, scheduleId: string): Promise<PrioritizationResult> {
    // Gather data from existing services
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const criticalPathResult = await criticalPathService.calculateCriticalPath(scheduleId);
    const delayedTasks = await autoRescheduleService.detectDelays(scheduleId);

    // Build lookup maps
    const criticalIds = new Set(criticalPathResult.criticalPathTaskIds);
    const cpmMap = new Map<string, CPMTaskResult>();
    for (const cpm of criticalPathResult.tasks) {
      cpmMap.set(cpm.taskId, cpm);
    }
    const delayMap = new Map<string, string>();
    for (const dt of delayedTasks) {
      delayMap.set(dt.taskId, dt.severity);
    }

    // Filter to active tasks only (pending or in_progress with dates)
    const activeTasks = tasks.filter(
      (t) => (t.status === 'pending' || t.status === 'in_progress') && t.startDate && t.endDate,
    );

    if (activeTasks.length === 0) {
      return {
        tasks: [],
        summary: {
          totalTasks: tasks.length,
          tasksAnalyzed: 0,
          priorityChanges: 0,
          criticalPathTasks: 0,
          delayedTasks: delayedTasks.length,
          averageScore: 0,
        },
        aiPowered: false,
      };
    }

    // Count downstream tasks for each task (for downstream impact factor)
    const downstreamCounts = new Map<string, number>();
    for (const task of activeTasks) {
      const downstream = await scheduleService.findAllDownstreamTasks(task.id);
      downstreamCounts.set(task.id, downstream.length);
    }

    // Calculate algorithmic scores
    const now = utcDay(new Date());
    const scored: Array<{
      task: Task;
      score: number;
      factors: PriorityFactor[];
    }> = [];

    for (const task of activeTasks) {
      const cpm = cpmMap.get(task.id);
      const isOnCriticalPath = criticalIds.has(task.id);
      const delaySeverity = delayMap.get(task.id) || 'none';
      const downstreamCount = downstreamCounts.get(task.id) || 0;

      const factors: PriorityFactor[] = [];

      // Factor 1: Critical Path (25%)
      const criticalPathScore = isOnCriticalPath ? 100 : 0;
      if (isOnCriticalPath) {
        factors.push({
          factor: 'Critical Path',
          impact: 'high',
          description: 'Task is on the critical path — any delay directly extends the project.',
        });
      }

      // Factor 2: Float / Inverse (15%)
      const totalFloat = cpm?.totalFloat ?? 999;
      const floatScore = Math.max(0, 100 - totalFloat * 5);
      if (floatScore >= 60) {
        factors.push({
          factor: 'Low Float',
          impact: floatScore >= 80 ? 'high' : 'medium',
          description: `Only ${totalFloat} day(s) of float available before impacting the schedule.`,
        });
      }

      // Factor 3: Delay Severity (20%)
      const delaySeverityScores: Record<string, number> = {
        critical: 100,
        high: 75,
        medium: 50,
        low: 25,
        none: 0,
      };
      const delayScore = delaySeverityScores[delaySeverity] ?? 0;
      if (delayScore > 0) {
        factors.push({
          factor: 'Schedule Delay',
          impact: delayScore >= 75 ? 'high' : delayScore >= 50 ? 'medium' : 'low',
          description: `Task has a ${delaySeverity} delay severity based on current progress vs. expected progress.`,
        });
      }

      // Factor 4: Downstream Impact (15%)
      const downstreamScore = Math.min(100, downstreamCount * 20);
      if (downstreamCount > 0) {
        factors.push({
          factor: 'Downstream Impact',
          impact: downstreamCount >= 4 ? 'high' : downstreamCount >= 2 ? 'medium' : 'low',
          description: `${downstreamCount} task(s) depend on this task's completion.`,
        });
      }

      // Factor 5: Due Date Proximity (15%)
      const endDate = new Date(task.endDate!);
      const daysUntilDue = Math.max(0, (endDate.getTime() - now.getTime()) / DAY_MS);
      const dueDateScore = Math.max(0, 100 - daysUntilDue * 2);
      if (dueDateScore >= 40) {
        factors.push({
          factor: 'Due Date Proximity',
          impact: dueDateScore >= 80 ? 'high' : dueDateScore >= 60 ? 'medium' : 'low',
          description: `Due in ${Math.round(daysUntilDue)} day(s).`,
        });
      }

      // Factor 6: Progress Gap (10%)
      const startDate = new Date(task.startDate!);
      const totalDuration = endDate.getTime() - startDate.getTime();
      const elapsed = now.getTime() - startDate.getTime();
      const expectedProgress = totalDuration > 0 ? Math.min(100, Math.max(0, (elapsed / totalDuration) * 100)) : 0;
      const actualProgress = task.progressPercentage ?? 0;
      const progressGap = Math.max(0, expectedProgress - actualProgress);
      if (progressGap >= 20) {
        factors.push({
          factor: 'Progress Gap',
          impact: progressGap >= 40 ? 'high' : 'medium',
          description: `${Math.round(progressGap)}% behind expected progress (${Math.round(actualProgress)}% actual vs ${Math.round(expectedProgress)}% expected).`,
        });
      }

      // Weighted composite score
      const compositeScore = Math.round(
        criticalPathScore * 0.25 +
        floatScore * 0.15 +
        delayScore * 0.20 +
        downstreamScore * 0.15 +
        dueDateScore * 0.15 +
        progressGap * 0.10,
      );

      scored.push({ task, score: Math.min(100, compositeScore), factors });
    }

    // Sort by score descending and assign ranks
    scored.sort((a, b) => b.score - a.score);

    let prioritizedTasks: PrioritizedTask[] = scored.map((s, index) => ({
      taskId: s.task.id,
      taskName: s.task.name,
      currentPriority: s.task.priority as Priority,
      suggestedPriority: scoreToPriority(s.score),
      priorityScore: s.score,
      rank: index + 1,
      factors: s.factors,
      explanation: this.buildTemplatedExplanation(s.task, s.score, s.factors),
    }));

    // Try AI enhancement
    let aiPowered = false;

    if (config.AI_ENABLED && claudeService.isAvailable()) {
      try {
        const aiResult = await this.enhanceWithAI(activeTasks, prioritizedTasks, criticalPathResult.criticalPathTaskIds);
        if (aiResult) {
          prioritizedTasks = this.mergeAIResults(prioritizedTasks, aiResult);
          aiPowered = true;
        }
      } catch (error) {
        logger.error('AI prioritization enhancement failed, using algorithmic fallback:', error);
      }
    }

    // Build summary
    const priorityChanges = prioritizedTasks.filter(
      (t) => t.currentPriority !== t.suggestedPriority,
    ).length;

    const totalScore = prioritizedTasks.reduce((sum, t) => sum + t.priorityScore, 0);

    return {
      tasks: prioritizedTasks,
      summary: {
        totalTasks: tasks.length,
        tasksAnalyzed: prioritizedTasks.length,
        priorityChanges,
        criticalPathTasks: criticalPathResult.criticalPathTaskIds.length,
        delayedTasks: delayedTasks.length,
        averageScore: prioritizedTasks.length > 0 ? Math.round(totalScore / prioritizedTasks.length) : 0,
      },
      aiPowered,
    };
  }

  // ---------------------------------------------------------------------------
  // Apply Priority Change (single)
  // ---------------------------------------------------------------------------

  async applyPriorityChange(taskId: string, priority: Priority): Promise<boolean> {
    const updated = await scheduleService.updateTask(taskId, { priority });
    return updated !== null;
  }

  // ---------------------------------------------------------------------------
  // Apply All Priority Changes (batch)
  // ---------------------------------------------------------------------------

  async applyAllPriorityChanges(changes: Array<{ taskId: string; priority: Priority }>): Promise<number> {
    let applied = 0;
    for (const change of changes) {
      const updated = await scheduleService.updateTask(change.taskId, {
        priority: change.priority,
      });
      if (updated) applied++;
    }
    return applied;
  }

  // ---------------------------------------------------------------------------
  // AI Enhancement (private)
  // ---------------------------------------------------------------------------

  private async enhanceWithAI(
    tasks: Task[],
    algorithmicResults: PrioritizedTask[],
    criticalPathIds: string[],
  ): Promise<PrioritizationAIResponse | null> {
    const taskSummary = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      priority: t.priority,
      startDate: t.startDate ? new Date(t.startDate).toISOString().split('T')[0] : null,
      endDate: t.endDate ? new Date(t.endDate).toISOString().split('T')[0] : null,
      progressPercentage: t.progressPercentage ?? 0,
      dependency: t.dependency ?? null,
      dependencies: t.dependencies.map(d => ({ id: d.dependencyId, type: d.dependencyType, lag: d.lagDays })),
      estimatedDays: t.estimatedDays ?? null,
    }));

    const preComputedScores = algorithmicResults.map((r) => ({
      taskId: r.taskId,
      taskName: r.taskName,
      algorithmicScore: r.priorityScore,
      algorithmicRank: r.rank,
      factors: r.factors,
    }));

    const systemPrompt = `You are an expert project management AI specializing in task prioritization. You are given pre-computed algorithmic priority scores for project tasks along with their details. Your job is to refine the ranking, adjust scores where appropriate based on holistic project understanding, and provide clear natural-language explanations for each task's priority.

Rules:
- Each task must have a unique rank (1 = highest priority).
- priorityScore must be 0–100.
- suggestedPriority: 0-25=low, 26-50=medium, 51-75=high, 76-100=urgent.
- Provide 1–4 factors per task with impact level and description.
- explanation should be 1–2 sentences summarizing why this task has its priority level.
- You may adjust scores ±15 from the algorithmic baseline if you have good reason, but preserve the general ordering unless project context strongly justifies a change.`;

    const userMessage = `Here are the tasks and their pre-computed priority data:

Tasks:
${JSON.stringify(taskSummary, null, 2)}

Critical Path Task IDs: ${JSON.stringify(criticalPathIds)}

Algorithmic Priority Scores:
${JSON.stringify(preComputedScores, null, 2)}

Please refine the prioritization ranking with explanations.`;

    const aiResult = await claudeService.completeWithJsonSchema<PrioritizationAIResponse>({
      systemPrompt,
      userMessage,
      schema: PrioritizationAIResponseSchema,
      maxTokens: 4096,
      temperature: 0.3,
    });

    return aiResult.data;
  }

  // ---------------------------------------------------------------------------
  // Merge AI Results (private)
  // ---------------------------------------------------------------------------

  private mergeAIResults(
    algorithmic: PrioritizedTask[],
    aiResponse: PrioritizationAIResponse,
  ): PrioritizedTask[] {
    const aiMap = new Map(aiResponse.tasks.map((t) => [t.taskId, t]));

    return algorithmic.map((task) => {
      const aiTask = aiMap.get(task.taskId);
      if (!aiTask) return task;

      return {
        ...task,
        rank: aiTask.rank,
        priorityScore: Math.max(0, Math.min(100, aiTask.priorityScore)),
        suggestedPriority: aiTask.suggestedPriority,
        factors: aiTask.factors,
        explanation: aiTask.explanation,
      };
    }).sort((a, b) => a.rank - b.rank);
  }

  // ---------------------------------------------------------------------------
  // Templated Explanation (private fallback)
  // ---------------------------------------------------------------------------

  private buildTemplatedExplanation(task: Task, score: number, factors: PriorityFactor[]): string {
    const priority = scoreToPriority(score);
    const highFactors = factors.filter((f) => f.impact === 'high');

    if (highFactors.length === 0) {
      return `${task.name} has a ${priority} priority (score: ${score}/100) with no critical factors identified.`;
    }

    const factorNames = highFactors.map((f) => f.factor.toLowerCase()).join(' and ');
    return `${task.name} requires ${priority} priority (score: ${score}/100) due to ${factorNames}.`;
  }
}

export const taskPrioritizationService = new TaskPrioritizationService();
