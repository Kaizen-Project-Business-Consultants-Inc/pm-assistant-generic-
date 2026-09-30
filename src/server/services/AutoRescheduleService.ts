import { ScheduleService, Task } from './ScheduleService';
import { changeHistoryService } from './ChangeHistoryService';
import { CriticalPathService } from './CriticalPathService';
import { claudeService } from './claudeService';
import { config } from '../config';
import { rescheduleProposalRepository, RescheduleProposalRow } from '../database/RescheduleProposalRepository';
import { v4 as uuidv4 } from 'uuid';
import { auditLedgerService } from './AuditLedgerService';
import { deadLetterService } from './DeadLetterService';
import logger from '../utils/logger';
import {
  DelayedTask,
  ProposedChange,
  RescheduleProposal,
  RescheduleAIResponseSchema,
  RescheduleAIResponse,
} from '../schemas/autoRescheduleSchemas';
import { sanitizeForPrompt } from '../utils/promptSanitizer';
import { calendarService } from './CalendarService';
import { scheduleRecomputeService } from './ScheduleRecomputeService';
import {
  type IsWorking, weekdaysOnly, onOrAfterWorking, shiftWorking, workingDaysAfter, utcDay, ymdOf, finishFor,
} from '../utils/workingDays';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Put dates the AI proposed onto the project calendar: a start on a day off moves to
 * the next working day and the task keeps its working-day length (start day counted).
 * Dates that don't parse are returned unchanged.
 */
export function snapToWorking(startStr: string, endStr: string, isWorking: IsWorking): { start: string; end: string } {
  const s = utcDay(startStr);
  const e = utcDay(endStr);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return { start: startStr, end: endStr };
  const start = onOrAfterWorking(s, isWorking);
  if (e < s) return { start: ymdOf(start), end: ymdOf(onOrAfterWorking(e, isWorking)) };
  const length = workingDaysAfter(s, e, isWorking) + (isWorking(s) ? 1 : 0);
  return { start: ymdOf(start), end: ymdOf(finishFor(start, length, isWorking)) };
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function rowToProposal(row: RescheduleProposalRow): RescheduleProposal {
  let data: any;
  try {
    data = JSON.parse(row.proposal_data);
  } catch {
    data = { delayedTasks: [], proposedChanges: [], rationale: 'Parse error', estimatedImpact: {} };
  }
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    status: row.status as RescheduleProposal['status'],
    delayedTasks: data.delayedTasks ?? [],
    proposedChanges: data.proposedChanges ?? [],
    rationale: data.rationale ?? '',
    estimatedImpact: data.estimatedImpact ?? {
      originalEndDate: '',
      proposedEndDate: '',
      daysChange: 0,
      criticalPathImpact: '',
    },
    createdAt: row.created_at,
    feedback: row.feedback ?? undefined,
  };
}

export class AutoRescheduleService {
  private scheduleService = new ScheduleService();
  private criticalPathService = new CriticalPathService();

  // ---------------------------------------------------------------------------
  // Detect Delays
  // ---------------------------------------------------------------------------

  /** The schedule's project calendar; Mon–Fri if it can't be read */
  private async calendarFor(scheduleId: string): Promise<IsWorking> {
    try {
      const f = await this.scheduleService.workingDayTest(scheduleId);
      if (typeof f === 'function') return f;
    } catch { /* fall through to Mon–Fri */ }
    return weekdaysOnly;
  }

  /**
   * Plain-language description of the project's days off between two dates, for the
   * AI prompt: which weekdays are off, the holidays in range, and extra working days.
   */
  private async describeDaysOff(projectId: string | undefined, from: string, to: string): Promise<string> {
    const fallback = 'Working weekdays: Monday to Friday. Saturdays and Sundays are days off.';
    if (!projectId) return fallback;
    try {
      const spec = await calendarService.calendarSpec(projectId);
      const offDates = await calendarService.getNonWorkingDates(projectId, from, to);
      const workDays = [...spec.workingDays].sort((a, b) => a - b);
      const offWeekdays = [0, 1, 2, 3, 4, 5, 6].filter(d => !workDays.includes(d));
      const holidays = offDates.filter(d => !offWeekdays.includes(utcDay(d).getUTCDay()));
      const extraWorking = [...spec.working].filter(d => d >= from && d <= to).sort();
      const lines = [
        `Working weekdays: ${workDays.map(d => WEEKDAY_NAMES[d]).join(', ') || 'none'}.`,
        `Weekdays that are always off: ${offWeekdays.map(d => WEEKDAY_NAMES[d]).join(', ') || 'none'}.`,
        `Holidays (days off) between ${from} and ${to}: ${holidays.length ? holidays.join(', ') : 'none'}.`,
      ];
      if (extraWorking.length) lines.push(`Extra working days (worked although the weekday is normally off): ${extraWorking.join(', ')}.`);
      return lines.join('\n');
    } catch (err: any) {
      logger.warn('[AutoReschedule] could not read the project calendar for the prompt', { projectId, error: err?.message });
      return fallback;
    }
  }

  async detectDelays(scheduleId: string): Promise<DelayedTask[]> {
    const tasks = await this.scheduleService.findTasksByScheduleId(scheduleId);
    const isWorking = await this.calendarFor(scheduleId);
    const criticalPathResult = await this.criticalPathService.calculateCriticalPath(scheduleId);
    const criticalIds = new Set(criticalPathResult.criticalPathTaskIds);

    // Today as a DAY, not a moment: task dates are calendar days, so measuring from "now"
    // made the same task's projected finish later in the evening than in the morning
    // (found 2026-09-30 when a test started failing after 19:00 UTC).
    const now = utcDay(new Date());
    const delayed: DelayedTask[] = [];

    for (const task of tasks) {
      // Only check in-progress or pending tasks that have dates
      if (task.status === 'completed' || task.status === 'cancelled') continue;
      if (!task.startDate || !task.endDate) continue;

      const startDate = new Date(task.startDate);
      const endDate = new Date(task.endDate);

      // Skip tasks that haven't started yet (start date in the future)
      if (startDate.getTime() > now.getTime()) continue;

      const totalDuration = endDate.getTime() - startDate.getTime();
      if (totalDuration <= 0) continue;

      const elapsed = now.getTime() - startDate.getTime();
      const expectedProgress = Math.min(100, (elapsed / totalDuration) * 100);
      const actualProgress = task.progressPercentage ?? 0;

      // Flag as delayed if actual progress is more than 10% behind expected
      if (actualProgress < expectedProgress - 10) {
        // Estimate completion based on current velocity
        let estimatedEndDate: Date;
        if (actualProgress <= 0) {
          // No progress at all — estimate double the remaining duration from now. If the end
          // date has already passed there is no "remaining" (it's negative, which used to put
          // the estimate in the past and silently drop the most overdue tasks) — assume the
          // whole task still has to be done, starting today.
          const remainingMs = endDate.getTime() - now.getTime();
          estimatedEndDate = remainingMs > 0
            ? new Date(now.getTime() + remainingMs * 2)
            : new Date(now.getTime() + totalDuration);
        } else {
          // Project completion based on current velocity
          const msPerPercent = elapsed / actualProgress;
          const remainingPercent = 100 - actualProgress;
          const estimatedRemainingMs = remainingPercent * msPerPercent;
          estimatedEndDate = new Date(now.getTime() + estimatedRemainingMs);
        }

        // The estimate lands on a working day; the delay is counted in working days
        estimatedEndDate = onOrAfterWorking(utcDay(estimatedEndDate), isWorking);
        const delayDays = workingDaysAfter(utcDay(endDate), estimatedEndDate, isWorking);

        if (delayDays <= 0) continue;

        const isOnCriticalPath = criticalIds.has(task.id);

        // Determine severity (working days: 10 ≈ two weeks, 15 ≈ three, 5 ≈ one)
        let severity: 'low' | 'medium' | 'high' | 'critical';
        if (isOnCriticalPath && delayDays > 10) {
          severity = 'critical';
        } else if (isOnCriticalPath || delayDays > 15) {
          severity = 'high';
        } else if (delayDays > 5) {
          severity = 'medium';
        } else {
          severity = 'low';
        }

        delayed.push({
          taskId: task.id,
          taskName: task.name,
          expectedEndDate: toDateStr(endDate),
          currentProgress: actualProgress,
          estimatedEndDate: toDateStr(estimatedEndDate),
          delayDays,
          isOnCriticalPath,
          severity,
        });
      }
    }

    // Sort by severity (critical first)
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    delayed.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return delayed;
  }

  // ---------------------------------------------------------------------------
  // Generate Proposal
  // ---------------------------------------------------------------------------

  async generateProposal(scheduleId: string, userId?: string, source: 'manual' | 'agent' = 'manual'): Promise<RescheduleProposal> {
    const delayedTasks = await this.detectDelays(scheduleId);
    const criticalPathResult = await this.criticalPathService.calculateCriticalPath(scheduleId);
    const allTasks = await this.scheduleService.findTasksByScheduleId(scheduleId);
    const schedule = await this.scheduleService.findById(scheduleId);

    if (!schedule) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    const originalEndDate = toDateStr(new Date(schedule.endDate));
    const isWorking = await this.calendarFor(scheduleId);

    // Build task summary for AI context
    const taskSummary = allTasks.map((t) => ({
      id: t.id,
      name: sanitizeForPrompt(t.name),
      status: t.status,
      priority: t.priority,
      startDate: t.startDate ? toDateStr(new Date(t.startDate)) : null,
      endDate: t.endDate ? toDateStr(new Date(t.endDate)) : null,
      progressPercentage: t.progressPercentage ?? 0,
      dependencies: t.dependencies.map(d => ({ dependencyId: d.dependencyId, type: d.dependencyType, lag: d.lagDays })),
      dependency: t.dependency ?? null,
      estimatedDays: t.estimatedDays ?? null,
    }));

    let proposedChanges: ProposedChange[];
    let rationale: string;
    let estimatedImpact: RescheduleProposal['estimatedImpact'];

    if (config.AI_ENABLED && claudeService.isAvailable() && delayedTasks.length > 0) {
      // Use AI to generate intelligent rescheduling proposal
      const systemPrompt = `You are an expert project scheduling AI. Your role is to analyze delayed tasks in a project schedule and propose minimal-disruption date changes to get the project back on track.

Rules:
- Only propose changes for tasks that NEED to be moved (delayed tasks and their dependents).
- Respect dependency chains: if task B depends on task A, B cannot start before A finishes.
- Minimize the overall project end date impact.
- Prefer compressing non-critical-path tasks over extending the critical path.
- Dates must be in YYYY-MM-DD format.
- Durations, delays and lag count WORKING days from the project calendar given below; a task of N days includes its start day.
- Every proposedStartDate and proposedEndDate MUST be a working day — never a weekday that is off, and never a listed holiday.
- Be realistic with proposed dates — account for the delays already detected.
- proposedEndDate in estimatedImpact should be the latest proposedEndDate among all tasks, or the original end date if it's later.
- daysChange (in working days) should be positive if the project is extended, negative if shortened, 0 if unchanged.`;

      // The project's days off across the plan, with about six months' room for it to grow
      const planDates = [originalEndDate];
      for (const t of taskSummary) { if (t.startDate) planDates.push(t.startDate); if (t.endDate) planDates.push(t.endDate); }
      const sortedDates = planDates.filter(d => !isNaN(utcDay(d).getTime())).sort();
      const rangeFrom = sortedDates[0] ?? originalEndDate;
      const rangeTo = ymdOf(shiftWorking(utcDay(sortedDates[sortedDates.length - 1] ?? originalEndDate), 130, weekdaysOnly));
      const daysOff = await this.describeDaysOff(schedule.projectId, rangeFrom, rangeTo);

      const userMessage = `Here is the current schedule state:

Schedule: ${schedule.name} (${scheduleId})
Original End Date: ${originalEndDate}

Project calendar (proposed dates must be working days):
${daysOff}

All Tasks:
${JSON.stringify(taskSummary, null, 2)}

Critical Path Task IDs: ${JSON.stringify(criticalPathResult.criticalPathTaskIds)}
Project Duration (days): ${criticalPathResult.projectDuration}

Detected Delays:
${JSON.stringify(delayedTasks, null, 2)}

Please propose date changes to reschedule affected tasks with minimal disruption. Only include tasks whose dates actually need to change.`;

      const aiResult = await claudeService.completeWithJsonSchema<RescheduleAIResponse>({
        systemPrompt,
        userMessage,
        schema: RescheduleAIResponseSchema,
        maxTokens: 4096,
      });

      const aiResponse = aiResult.data;

      // Map AI proposed changes to full ProposedChange objects with current dates. A
      // proposed date on a day off is put back on the calendar (start → next working
      // day, the task keeps its working-day length).
      proposedChanges = aiResponse.proposedChanges.map((pc) => {
        const task = allTasks.find((t) => t.id === pc.taskId);
        const snapped = snapToWorking(pc.proposedStartDate, pc.proposedEndDate, isWorking);
        return {
          taskId: pc.taskId,
          taskName: pc.taskName,
          currentStartDate: task?.startDate ? toDateStr(new Date(task.startDate)) : '',
          currentEndDate: task?.endDate ? toDateStr(new Date(task.endDate)) : '',
          proposedStartDate: snapped.start,
          proposedEndDate: snapped.end,
          reason: pc.reason,
        };
      });

      // The new finish and its change in working days, from the (snapped) proposed dates
      const latestAiEnd = proposedChanges.reduce((latest, pc) => {
        const d = utcDay(pc.proposedEndDate);
        return !isNaN(d.getTime()) && d > latest ? d : latest;
      }, utcDay(originalEndDate));

      rationale = aiResponse.rationale;
      estimatedImpact = {
        originalEndDate,
        proposedEndDate: ymdOf(latestAiEnd),
        daysChange: workingDaysAfter(utcDay(originalEndDate), latestAiEnd, isWorking),
        criticalPathImpact: aiResponse.estimatedImpact.criticalPathImpact,
      };
    } else {
      // Fallback: generate a simple heuristic-based proposal without AI
      proposedChanges = [];

      for (const delayed of delayedTasks) {
        const task = allTasks.find((t) => t.id === delayed.taskId);
        if (!task || !task.startDate || !task.endDate) continue;

        const currentStart = toDateStr(new Date(task.startDate));
        const currentEnd = toDateStr(new Date(task.endDate));
        // The finish moves out by the delay, in working days
        const newEndDate = shiftWorking(utcDay(task.endDate), delayed.delayDays, isWorking);

        proposedChanges.push({
          taskId: task.id,
          taskName: task.name,
          currentStartDate: currentStart,
          currentEndDate: currentEnd,
          proposedStartDate: currentStart,
          proposedEndDate: toDateStr(newEndDate),
          reason: `Task is ${delayed.delayDays} working days behind schedule (${delayed.currentProgress}% complete vs expected progress). Extending end date to accommodate current velocity.`,
        });

        // Also shift dependent tasks
        const dependents = allTasks.filter((t) => t.dependencies.some(d => d.dependencyId === task.id));
        for (const dep of dependents) {
          if (!dep.startDate || !dep.endDate) continue;
          if (dep.status === 'completed' || dep.status === 'cancelled') continue;

          const depCurrentStart = utcDay(dep.startDate);
          const depCurrentEnd = utcDay(dep.endDate);
          // Keep the dependent's length in working days
          const depDuration = Math.max(0, workingDaysAfter(depCurrentStart, depCurrentEnd, isWorking));
          const lag = dep.dependencies.find(d => d.dependencyId === task.id)?.lagDays ?? 0;

          // New start: the working day after the delayed task's new finish (plus lag)
          const depNewStart = onOrAfterWorking(shiftWorking(newEndDate, lag + 1, isWorking), isWorking);
          const depNewEnd = shiftWorking(depNewStart, depDuration, isWorking);

          // Only push later, and only once
          if (depNewStart > depCurrentStart && !proposedChanges.find((pc) => pc.taskId === dep.id)) {
            proposedChanges.push({
              taskId: dep.id,
              taskName: dep.name,
              currentStartDate: toDateStr(depCurrentStart),
              currentEndDate: toDateStr(depCurrentEnd),
              proposedStartDate: toDateStr(depNewStart),
              proposedEndDate: toDateStr(depNewEnd),
              reason: `Shifted due to delay in dependency "${task.name}".`,
            });
          }
        }
      }

      // Calculate impact
      const latestProposedEnd = proposedChanges.reduce((latest, pc) => {
        const d = utcDay(pc.proposedEndDate);
        return d > latest ? d : latest;
      }, utcDay(originalEndDate));

      // In working days from the project calendar
      const daysChange = workingDaysAfter(utcDay(originalEndDate), latestProposedEnd, isWorking);

      rationale = delayedTasks.length > 0
        ? `Detected ${delayedTasks.length} delayed task(s). Proposed date adjustments extend delayed tasks to match current velocity and shift dependent tasks accordingly.`
        : 'No delays detected. Schedule is on track.';

      estimatedImpact = {
        originalEndDate,
        proposedEndDate: toDateStr(latestProposedEnd),
        daysChange,
        criticalPathImpact: delayedTasks.some((d) => d.isOnCriticalPath)
          ? 'Critical path is affected. Project end date will likely be extended.'
          : 'Critical path is not directly affected. Impact may be limited to non-critical tasks.',
      };
    }

    const proposalId = uuidv4();
    const now = new Date().toISOString();

    const proposal: RescheduleProposal = {
      id: proposalId,
      scheduleId,
      status: 'pending',
      delayedTasks,
      proposedChanges,
      rationale,
      estimatedImpact,
      createdAt: now,
    };

    // Persist to DB
    const proposalData = JSON.stringify({ delayedTasks, proposedChanges, rationale, estimatedImpact });
    try {
      await rescheduleProposalRepository.insert(proposalId, scheduleId, proposalData, source, now.replace('T', ' ').substring(0, 19));
    } catch {
      // Table may not exist yet — log and continue with in-memory behavior
      logger.warn('[AutoReschedule] Could not persist proposal to DB');
    }

    // Log activity on the first proposed task (logActivity requires a valid taskId)
    if (userId && proposedChanges.length > 0) {
      await this.scheduleService.logActivity(
        proposedChanges[0].taskId,
        userId,
        'System',
        'auto-reschedule-proposed',
        'proposal',
        undefined,
        `Proposal ${proposal.id}: ${delayedTasks.length} delayed task(s), ${proposedChanges.length} proposed change(s)`,
      );
    }

    return proposal;
  }

  // ---------------------------------------------------------------------------
  // Accept Proposal
  // ---------------------------------------------------------------------------

  async acceptProposal(proposalId: string): Promise<boolean> {
    const proposal = await this.getProposalById(proposalId);
    if (!proposal || proposal.status !== 'pending') return false;

    // The dates as they are now (the proposal's "current" dates may be stale) — for History's Undo
    const before: Array<{ taskId: string; startDate: string | null; endDate: string | null }> = [];
    try {
      for (const change of proposal.proposedChanges) {
        const t = await this.scheduleService.findTaskById(change.taskId);
        if (t) before.push({ taskId: t.id, startDate: t.startDate ? String(t.startDate).slice(0, 10) : null, endDate: t.endDate ? String(t.endDate).slice(0, 10) : null });
      }
    } catch (err: any) {
      logger.warn('[AutoReschedule] could not read dates for History; this change will not be undoable', { proposalId, error: err?.message });
      before.length = 0;
    }

    // Apply all proposed changes
    for (const change of proposal.proposedChanges) {
      await this.scheduleService.updateTask(change.taskId, {
        startDate: change.proposedStartDate,
        endDate: change.proposedEndDate,
      });

      await this.scheduleService.logActivity(
        change.taskId,
        '1',
        'System',
        'auto-rescheduled',
        'dates',
        `${change.currentStartDate} - ${change.currentEndDate}`,
        `${change.proposedStartDate} - ${change.proposedEndDate}`,
      );

      auditLedgerService.append({
        actorId: 'system',
        actorType: 'system',
        action: 'schedule.auto_reschedule',
        entityType: 'task',
        entityId: change.taskId,
        projectId: null,
        payload: {
          proposalId,
          before: { startDate: change.currentStartDate, endDate: change.currentEndDate },
          after: { startDate: change.proposedStartDate, endDate: change.proposedEndDate },
          reason: change.reason,
        },
        source: 'system',
      }).catch(err => deadLetterService.capture('audit.reschedule', { proposalId, taskId: change.taskId }, err));
    }

    // Successors follow the new dates: anything now starting before its predecessor
    // allows is pushed later, in working days (never pulled earlier; audited).
    const movedIds = proposal.proposedChanges.map(c => c.taskId);
    if (movedIds.length) {
      try {
        const { deltas } = await scheduleRecomputeService.recompute(proposal.scheduleId, { onlyFrom: movedIds, reason: 'ai_reschedule' });
        // Tasks the re-flow moved are part of this change, so Undo restores them too
        const known = new Set(before.map(b => b.taskId));
        if (before.length) {
          for (const d of deltas) {
            if (!known.has(d.taskId)) before.push({ taskId: d.taskId, startDate: d.oldStart, endDate: d.oldEnd });
          }
        }
      } catch (err: any) {
        logger.warn('[AutoReschedule] successors could not be re-flowed after accepting', { proposalId, error: err?.message });
      }
    }

    try {
      await rescheduleProposalRepository.updateStatus(proposalId, 'accepted');
    } catch {
      logger.warn('[AutoReschedule] Could not update proposal status in DB');
    }

    const schedule = before.length ? await Promise.resolve().then(() => this.scheduleService.findById(proposal.scheduleId)).catch(() => null) : null;
    if (schedule && before.length) {
      await changeHistoryService.record({
        projectId: schedule.projectId,
        scheduleId: proposal.scheduleId,
        kind: 'ai_reschedule',
        ref: proposalId,
        summary: `Accepted AI Reschedule: ${before.length} task${before.length === 1 ? '' : 's'} re-dated`,
        taskIds: before.map(b => b.taskId),
        undo: { moved: before },
      });
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Reject Proposal
  // ---------------------------------------------------------------------------

  async rejectProposal(proposalId: string, feedback?: string): Promise<boolean> {
    const proposal = await this.getProposalById(proposalId);
    if (!proposal || proposal.status !== 'pending') return false;

    try {
      await rescheduleProposalRepository.updateStatus(proposalId, 'rejected', feedback);
    } catch {
      logger.warn('[AutoReschedule] Could not update proposal status in DB');
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Modify Proposal
  // ---------------------------------------------------------------------------

  async modifyProposal(proposalId: string, modifications: ProposedChange[]): Promise<boolean> {
    const proposal = await this.getProposalById(proposalId);
    if (!proposal || proposal.status !== 'pending') return false;

    proposal.proposedChanges = modifications;
    const proposalData = JSON.stringify({
      delayedTasks: proposal.delayedTasks,
      proposedChanges: modifications,
      rationale: proposal.rationale,
      estimatedImpact: proposal.estimatedImpact,
    });

    try {
      await rescheduleProposalRepository.updateProposalData(proposalId, 'modified', proposalData);
    } catch {
      logger.warn('[AutoReschedule] Could not update proposal in DB');
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Get Proposals
  // ---------------------------------------------------------------------------

  async getProposals(scheduleId: string): Promise<RescheduleProposal[]> {
    try {
      const rows = await rescheduleProposalRepository.findBySchedule(scheduleId);
      return rows.map(rowToProposal);
    } catch {
      logger.warn('[AutoReschedule] Could not read proposals from DB');
      return [];
    }
  }

  /** For access checks: which schedule a proposal belongs to */
  async findProposalScheduleId(proposalId: string): Promise<string | null> {
    return (await this.getProposalById(proposalId))?.scheduleId ?? null;
  }

  private async getProposalById(proposalId: string): Promise<RescheduleProposal | null> {
    try {
      const row = await rescheduleProposalRepository.findById(proposalId);
      if (!row) return null;
      return rowToProposal(row);
    } catch {
      logger.warn('[AutoReschedule] Could not read proposal from DB');
      return null;
    }
  }
}

export const autoRescheduleService = new AutoRescheduleService();
