import { randomUUID } from 'crypto';
import { scheduleService, type Task } from './ScheduleService';
import { projectService } from './ProjectService';
import { baselineService } from './BaselineService';
import { criticalPathService } from './CriticalPathService';
import { resourceLevelingService } from './ResourceLevelingService';
import { resourceService } from './ResourceService';
import { sprintService } from './SprintService';
import { scheduleReviewRepository, type ReviewTrigger, type ScheduleReviewRecord, type ScheduleReviewSummary } from '../database/ScheduleReviewRepository';
import { reviewSchedule, PRE_REVIEW_BASELINE_NAME, type ReviewInput, type ReviewTask } from './scheduleReview/rules';
import logger from '../utils/logger';
import { type IsWorking, weekdaysOnly, ymdOf } from '../utils/workingDays';
import { calendarService } from './CalendarService';
import { statusDateFor } from './StatusDateService';
import { periodLimit, REPORTING_PERIOD_LABEL, type PeriodLimit, type ReportingPeriod } from './scheduleReview/reportingPeriod';
import { taskSplitExceptionRepository, type TaskSplitException } from '../database/TaskSplitExceptionRepository';

/**
 * Runs the deterministic Schedule Review over a schedule, stores the result and
 * returns it. Gathers everything the rules need with the same lookups the rest of
 * the scheduling stack uses; each optional input degrades gracefully so a failure
 * in, say, resource leveling never blocks the review.
 */
export class ScheduleReviewService {
  async run(scheduleId: string, trigger: ReviewTrigger, userId?: string | null, proposalId?: string | null): Promise<ScheduleReviewRecord> {
    const { input, projectId } = await this.gatherInput(scheduleId);
    const result = reviewSchedule(input);

    const record = await scheduleReviewRepository.insert({
      id: randomUUID(),
      scheduleId,
      projectId,
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

  /**
   * Everything the rules read, plus the saved tasks it was built from. Propose fixes' preview
   * scores an in-memory copy of the plan with the same input (float and over-allocation as the
   * plan stands now), and saves nothing.
   */
  async gatherInput(scheduleId: string): Promise<{ input: ReviewInput; tasks: Task[]; projectId: string }> {
    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) throw new ScheduleReviewNotFoundError(scheduleId);

    // Only the PM's own baselines count: Propose fixes' safety copy is not one (R18/R19). Only the
    // newest is read with its tasks (each Apply adds a safety copy, so reading all of them grows).
    const [tasks, project, baselines, resources, sprints] = await Promise.all([
      scheduleService.findTasksByScheduleId(scheduleId),
      projectService.findById(schedule.projectId).catch(() => null),
      baselineService.findLatestExcept(scheduleId, PRE_REVIEW_BASELINE_NAME).catch(() => ({ latest: null, count: 0 })),
      resourceService.findAllResources().catch(() => []),
      sprintService.getByProject(schedule.projectId).catch(() => []),
    ]);

    const hasLogic = tasks.some(t => (t.dependencies || []).length > 0);
    const [floatByTask, overAllocations, isWorking, periodRule] = await Promise.all([
      hasLogic ? this.safeFloat(scheduleId) : Promise.resolve(null),
      this.safeOverAllocations(scheduleId),
      this.safeCalendar(scheduleId),
      project?.periodRuleEnabled ? this.safePeriodRule(project.id, project.reportingPeriod ?? 'week', scheduleId) : Promise.resolve(null),
    ]);

    const latest = baselines.latest;
    const input: ReviewInput = {
      schedule: { id: schedule.id, startDate: schedule.startDate, endDate: schedule.endDate },
      project: project
        ? { startDate: project.startDate, endDate: project.endDate, projectType: project.projectType, methodology: project.methodology ?? null }
        : null,
      sprintCount: sprints.length,
      sprints: sprints.map(sp => ({ id: sp.id, name: sp.name, endDate: sp.endDate, status: sp.status })),
      tasks: tasks.map(toReviewTask),
      resources: resources.map(r => ({ id: r.id, name: r.name, email: r.email, userId: r.userId, isGeneric: !!r.isGeneric })),
      baselineCount: baselines.count,
      latestBaselineTasks: latest ? latest.tasks.map(t => ({ taskId: t.taskId, startDate: t.startDate, endDate: t.endDate })) : null,
      floatByTask,
      overAllocations,
      today: new Date(),
      isWorking,
      periodRule,
    };
    return { input, tasks, projectId: schedule.projectId };
  }

  /**
   * What one reporting period holds on this project's calendar (holidays inside it shorten it), measured at
   * the project's status date. Shown read-only in Edit project, and used by R42.
   */
  async periodLimitFor(projectId: string, period: ReportingPeriod): Promise<PeriodLimit> {
    // one after the other: a project with no calendar row yet gets its default made once, not twice
    const calendar = await calendarService.getOrCreateDefault(projectId);
    const [asOf, check] = await Promise.all([statusDateFor(projectId), calendarService.workingDayChecker(projectId)]);
    return periodLimit(period, asOf, d => check(ymdOf(d)), calendar.hoursPerDay);
  }

  /** The PM's "Cannot be split" tasks on a schedule, with the reason, who and when */
  async splitExceptions(scheduleId: string): Promise<TaskSplitException[]> {
    return taskSplitExceptionRepository.findBySchedule(scheduleId);
  }

  /** Takes a task back into the count. False when it had no exception on this schedule. */
  async removeSplitException(scheduleId: string, taskId: string): Promise<boolean> {
    return taskSplitExceptionRepository.remove(scheduleId, taskId);
  }

  /** The task must be on this schedule (the route's gate checked the schedule, not the task) */
  async markCannotBeSplit(scheduleId: string, taskId: string, reason: string, user: { userId: string; username: string }): Promise<boolean> {
    const task = await scheduleService.findTaskById(taskId);
    if (!task || task.scheduleId !== scheduleId) return false;
    await taskSplitExceptionRepository.upsert(taskId, reason, user.userId, user.username);
    return true;
  }

  private async safePeriodRule(projectId: string, period: ReportingPeriod, scheduleId: string): Promise<ReviewInput['periodRule']> {
    try {
      const [limit, exceptions] = await Promise.all([this.periodLimitFor(projectId, period), taskSplitExceptionRepository.findBySchedule(scheduleId)]);
      return { limitDays: limit.workingDays, limitHours: limit.hours, periodLabel: REPORTING_PERIOD_LABEL[period], exceptionTaskIds: exceptions.map(e => e.taskId) };
    } catch (err: any) {
      logger.warn('[ScheduleReview] reporting period limit unavailable, rule skipped', { scheduleId, error: err?.message });
      return null;
    }
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

  /** The project calendar, read once per review so the rules stay pure; Mon–Fri on failure */
  private async safeCalendar(scheduleId: string): Promise<IsWorking> {
    try {
      return (await scheduleService.workingDayTest(scheduleId)) || weekdaysOnly;
    } catch (err: any) {
      logger.warn('[ScheduleReview] project calendar unavailable, using Mon–Fri', { scheduleId, error: err?.message });
      return weekdaysOnly;
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

/** A saved task as the rules read it */
export function toReviewTask(t: Task): ReviewTask {
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
    assignments: t.assignments?.map(a => ({ resourceId: a.resourceId, allocationPct: a.allocationPct, hoursPlanned: a.hoursPlanned })),
    workHours: t.workHours,
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    parentTaskId: t.parentTaskId,
    constraintType: t.constraintType,
    constraintDate: t.constraintDate,
    actualStartDate: t.actualStartDate,
    actualEndDate: t.actualEndDate,
    sortOrder: t.sortOrder,
    updatedAt: t.updatedAt,
    recurrenceParentId: t.recurrenceParentId,
    isRecurrenceTemplate: t.isRecurrenceTemplate,
    dependencies: (t.dependencies || []).map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays })),
  };
}

export const scheduleReviewService = new ScheduleReviewService();
