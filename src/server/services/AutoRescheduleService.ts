import { ScheduleService, Task } from './ScheduleService';
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

const DAY_MS = 24 * 60 * 60 * 1000;

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

  async detectDelays(scheduleId: string): Promise<DelayedTask[]> {
    const tasks = await this.scheduleService.findTasksByScheduleId(scheduleId);
    const criticalPathResult = await this.criticalPathService.calculateCriticalPath(scheduleId);
    const criticalIds = new Set(criticalPathResult.criticalPathTaskIds);

    const now = new Date();
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
          // No progress at all — estimate double the remaining duration from now
          const remainingMs = endDate.getTime() - now.getTime();
          estimatedEndDate = new Date(now.getTime() + remainingMs * 2);
        } else {
          // Project completion based on current velocity
          const msPerPercent = elapsed / actualProgress;
          const remainingPercent = 100 - actualProgress;
          const estimatedRemainingMs = remainingPercent * msPerPercent;
          estimatedEndDate = new Date(now.getTime() + estimatedRemainingMs);
        }

        const delayDays = Math.ceil(
          (estimatedEndDate.getTime() - endDate.getTime()) / DAY_MS,
        );

        if (delayDays <= 0) continue;

        const isOnCriticalPath = criticalIds.has(task.id);

        // Determine severity
        let severity: 'low' | 'medium' | 'high' | 'critical';
        if (isOnCriticalPath && delayDays > 14) {
          severity = 'critical';
        } else if (isOnCriticalPath || delayDays > 21) {
          severity = 'high';
        } else if (delayDays > 7) {
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
- Be realistic with proposed dates — account for the delays already detected.
- proposedEndDate in estimatedImpact should be the latest proposedEndDate among all tasks, or the original end date if it's later.
- daysChange should be positive if the project is extended, negative if shortened, 0 if unchanged.`;

      const userMessage = `Here is the current schedule state:

Schedule: ${schedule.name} (${scheduleId})
Original End Date: ${originalEndDate}

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

      // Map AI proposed changes to full ProposedChange objects with current dates
      proposedChanges = aiResponse.proposedChanges.map((pc) => {
        const task = allTasks.find((t) => t.id === pc.taskId);
        return {
          taskId: pc.taskId,
          taskName: pc.taskName,
          currentStartDate: task?.startDate ? toDateStr(new Date(task.startDate)) : '',
          currentEndDate: task?.endDate ? toDateStr(new Date(task.endDate)) : '',
          proposedStartDate: pc.proposedStartDate,
          proposedEndDate: pc.proposedEndDate,
          reason: pc.reason,
        };
      });

      rationale = aiResponse.rationale;
      estimatedImpact = {
        originalEndDate,
        proposedEndDate: aiResponse.estimatedImpact.proposedEndDate,
        daysChange: aiResponse.estimatedImpact.daysChange,
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
        const newEndDate = new Date(new Date(task.endDate).getTime() + delayed.delayDays * DAY_MS);

        proposedChanges.push({
          taskId: task.id,
          taskName: task.name,
          currentStartDate: currentStart,
          currentEndDate: currentEnd,
          proposedStartDate: currentStart,
          proposedEndDate: toDateStr(newEndDate),
          reason: `Task is ${delayed.delayDays} days behind schedule (${delayed.currentProgress}% complete vs expected progress). Extending end date to accommodate current velocity.`,
        });

        // Also shift dependent tasks
        const dependents = allTasks.filter((t) => t.dependencies.some(d => d.dependencyId === task.id));
        for (const dep of dependents) {
          if (!dep.startDate || !dep.endDate) continue;
          if (dep.status === 'completed' || dep.status === 'cancelled') continue;

          const depCurrentStart = new Date(dep.startDate);
          const depCurrentEnd = new Date(dep.endDate);
          const depDuration = depCurrentEnd.getTime() - depCurrentStart.getTime();

          // New start is after the delayed task's new end
          const depNewStart = new Date(newEndDate.getTime() + DAY_MS);
          const depNewEnd = new Date(depNewStart.getTime() + depDuration);

          // Only add if not already in proposedChanges
          if (!proposedChanges.find((pc) => pc.taskId === dep.id)) {
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
        const d = new Date(pc.proposedEndDate);
        return d > latest ? d : latest;
      }, new Date(originalEndDate));

      const daysChange = Math.round(
        (latestProposedEnd.getTime() - new Date(originalEndDate).getTime()) / DAY_MS,
      );

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

    try {
      await rescheduleProposalRepository.updateStatus(proposalId, 'accepted');
    } catch {
      logger.warn('[AutoReschedule] Could not update proposal status in DB');
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
