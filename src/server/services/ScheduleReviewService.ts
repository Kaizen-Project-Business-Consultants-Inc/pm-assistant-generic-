import { randomUUID } from 'crypto';
import { scheduleService } from './ScheduleService';
import { projectService } from './ProjectService';
import { baselineService } from './BaselineService';
import { criticalPathService } from './CriticalPathService';
import { resourceLevelingService } from './ResourceLevelingService';
import { resourceService } from './ResourceService';
import { sprintService } from './SprintService';
import { scheduleReviewRepository, type ReviewTrigger, type ScheduleReviewRecord, type ScheduleReviewSummary } from '../database/ScheduleReviewRepository';
import { reviewSchedule, type ReviewInput, type ReviewTask } from './scheduleReview/rules';
import logger from '../utils/logger';

/**
 * Runs the deterministic Schedule Review over a schedule, stores the result and
 * returns it. Gathers everything the rules need with the same lookups the rest of
 * the scheduling stack uses; each optional input degrades gracefully so a failure
 * in, say, resource leveling never blocks the review.
 */
export class ScheduleReviewService {
  async run(scheduleId: string, trigger: ReviewTrigger, userId?: string | null, proposalId?: string | null): Promise<ScheduleReviewRecord> {
    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) throw new ScheduleReviewNotFoundError(scheduleId);

    const [tasks, project, baselines, resources, sprints] = await Promise.all([
      scheduleService.findTasksByScheduleId(scheduleId),
      projectService.findById(schedule.projectId).catch(() => null),
      baselineService.findByScheduleId(scheduleId).catch(() => []),
      resourceService.findAllResources().catch(() => []),
      sprintService.getByProject(schedule.projectId).catch(() => []),
    ]);

    const hasLogic = tasks.some(t => (t.dependencies || []).length > 0);
    const [floatByTask, overAllocations] = await Promise.all([
      hasLogic ? this.safeFloat(scheduleId) : Promise.resolve(null),
      this.safeOverAllocations(scheduleId),
    ]);

    const latest = baselines[0];
    const input: ReviewInput = {
      schedule: { id: schedule.id, startDate: schedule.startDate, endDate: schedule.endDate },
      project: project
        ? { startDate: project.startDate, endDate: project.endDate, projectType: project.projectType, methodology: project.methodology ?? null }
        : null,
      sprintCount: sprints.length,
      tasks: tasks.map(toReviewTask),
      resources: resources.map(r => ({ id: r.id, name: r.name, email: r.email, userId: r.userId })),
      baselineCount: baselines.length,
      latestBaselineTasks: latest ? latest.tasks.map(t => ({ taskId: t.taskId, startDate: t.startDate, endDate: t.endDate })) : null,
      floatByTask,
      overAllocations,
      today: new Date(),
    };

    const result = reviewSchedule(input);

    const record = await scheduleReviewRepository.insert({
      id: randomUUID(),
      scheduleId,
      projectId: schedule.projectId,
      score: result.score,
      band: result.band,
      counts: result.counts,
      leafTaskCount: result.leafTaskCount,
      findings: result.findings,
      skippedRules: result.skippedRules,
      trigger,
      proposalId: proposalId ?? null,
      rulesVersion: result.rulesVersion,
      createdBy: userId ?? null,
    });

    scheduleReviewRepository.prune(scheduleId).catch(err =>
      logger.warn('[ScheduleReview] prune failed', { scheduleId, error: err?.message }),
    );

    return record;
  }

  async latest(scheduleId: string): Promise<ScheduleReviewRecord | null> {
    return scheduleReviewRepository.findLatest(scheduleId);
  }

  async history(scheduleId: string, limit = 8): Promise<ScheduleReviewSummary[]> {
    return scheduleReviewRepository.findHistory(scheduleId, limit);
  }

  private async safeFloat(scheduleId: string): Promise<Map<string, number> | null> {
    try {
      const cpm = await criticalPathService.calculateCriticalPath(scheduleId);
      return new Map(cpm.tasks.map(t => [t.taskId, t.totalFloat]));
    } catch (err: any) {
      logger.warn('[ScheduleReview] critical path unavailable', { scheduleId, error: err?.message });
      return null;
    }
  }

  private async safeOverAllocations(scheduleId: string) {
    try {
      const histogram = await resourceLevelingService.getResourceHistogram(scheduleId);
      return histogram.overAllocations;
    } catch (err: any) {
      logger.warn('[ScheduleReview] resource histogram unavailable', { scheduleId, error: err?.message });
      return null;
    }
  }
}

export class ScheduleReviewNotFoundError extends Error {
  constructor(scheduleId: string) {
    super(`Schedule not found: ${scheduleId}`);
    this.name = 'ScheduleReviewNotFoundError';
  }
}

function toReviewTask(t: Awaited<ReturnType<typeof scheduleService.findTasksByScheduleId>>[number]): ReviewTask {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    status: t.status,
    startDate: t.startDate,
    endDate: t.endDate,
    estimatedDays: t.estimatedDays,
    estimatedDurationHours: t.estimatedDurationHours,
    progressPercentage: t.progressPercentage,
    assignedTo: t.assignedTo,
    assignments: t.assignments?.map(a => ({ resourceId: a.resourceId })),
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    parentTaskId: t.parentTaskId,
    constraintType: t.constraintType,
    sortOrder: t.sortOrder,
    updatedAt: t.updatedAt,
    recurrenceParentId: t.recurrenceParentId,
    isRecurrenceTemplate: t.isRecurrenceTemplate,
    dependencies: (t.dependencies || []).map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays })),
  };
}

export const scheduleReviewService = new ScheduleReviewService();
