import { randomUUID } from 'crypto';
import { z } from 'zod';
import { scheduleService } from './ScheduleService';
import { taskRepository } from '../database/TaskRepository';
import { baselineService } from './BaselineService';
import { scheduleRecomputeService, type DateDelta } from './ScheduleRecomputeService';
import { scheduleReviewService } from './ScheduleReviewService';
import { claudeService } from './claudeService';
import { config } from '../config';
import { AILearningServiceV2 } from './aiLearningService';
import { auditLedgerService } from './AuditLedgerService';
import logger from '../utils/logger';
import {
  proposeFixesDeterministic,
  buildGroupingFixes,
  type ProposedFix,
} from './scheduleReview/fixProposer';
import { RULES_VERSION, type ReviewTask } from './scheduleReview/rules';
import {
  scheduleFixProposalRepository,
  type ScheduleFixProposal,
  type AppliedAction,
} from '../database/ScheduleFixProposalRepository';

const aiLearning = new AILearningServiceV2();

/**
 * The AI is asked ONLY to group tasks into phases — a small, fast reply that does
 * not truncate on large schedules. The deterministic engine still produces the
 * dependency chain and milestone flags (instant and reliable); the model does the
 * one thing rules cannot: read the meaning of task names to infer sequential phases.
 */
const AiGroupingSchema = z.object({
  groups: z.array(z.object({
    phaseName: z.string().min(1).max(80),
    taskIds: z.array(z.string()).min(1).max(200),
  })).max(20),
});

export interface ApplyResult {
  beforeScore: number | null;
  afterScore: number;
  appliedCount: number;
  skipped: Array<{ fixId: string; reason: string }>;
  // Date recompute summary (SR1)
  datesMoved: number;
  projectEndBefore: string | null;
  projectEndAfter: string | null;
  projectEndShiftDays: number;
  warning: string | null;
  dateDeltas: DateDelta[];
}

/** Minimal ReviewTask projection the proposer needs. */
function toReviewTask(t: Awaited<ReturnType<typeof scheduleService.findTasksByScheduleId>>[number]): ReviewTask {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    startDate: t.startDate,
    endDate: t.endDate,
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    parentTaskId: t.parentTaskId,
    sortOrder: t.sortOrder,
    dependencies: (t.dependencies || []).map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays })),
  };
}

export class ScheduleFixProposerService {
  /**
   * Generate a fix proposal for a schedule: AI when available (with plain-English
   * reasons + confidence), deterministic rules otherwise. Supersedes any older
   * pending proposal so there is at most one live proposal per schedule.
   */
  async propose(scheduleId: string, userId: string | null, useAi = false): Promise<ScheduleFixProposal> {
    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) throw new ScheduleFixNotFoundError(scheduleId);

    // Use the latest review, or run one so we always propose against fresh findings.
    let review = await scheduleReviewService.latest(scheduleId);
    if (!review) review = await scheduleReviewService.run(scheduleId, 'manual', userId);

    const tasks = (await scheduleService.findTasksByScheduleId(scheduleId)).map(toReviewTask);
    const leafCount = tasks.filter(t => !t.isSummary).length;

    // Deterministic fixes (dependency chain + milestone flags) are instant and are
    // always the base. When the PM opts into AI, we ask it ONLY for phase groupings
    // and merge them in (replacing any prefix-based grouping guesses). This keeps
    // the AI reply small so it returns fast and never truncates on big schedules.
    let fixes: ProposedFix[] = proposeFixesDeterministic(review.findings, tasks);
    let source: 'ai' | 'rules' = 'rules';
    if (useAi && config.AI_ENABLED && claudeService.isAvailable() && leafCount <= 80) {
      try {
        const groupings = await this.aiGroupings(tasks, userId);
        if (groupings.length > 0) {
          fixes = [...fixes.filter(f => f.type !== 'set_parent'), ...groupings];
          source = 'ai';
        }
      } catch (err: any) {
        logger.warn('[ScheduleFix] AI grouping failed, keeping deterministic fixes', { scheduleId, error: err?.message });
      }
    }

    await scheduleFixProposalRepository.supersedePending(scheduleId);

    return scheduleFixProposalRepository.insert({
      id: randomUUID(),
      scheduleId,
      projectId: schedule.projectId,
      status: 'pending',
      source,
      reviewId: review.id,
      proposalData: { fixes },
      rulesVersion: RULES_VERSION,
      createdBy: userId,
    });
  }

  /**
   * Ask the model to group ungrouped leaf tasks into sequential phases. Small,
   * focused reply (a few groups), so it returns fast and does not truncate on
   * large schedules. Returns set_parent fixes; empty when there is nothing to group.
   */
  private async aiGroupings(tasks: ReviewTask[], userId: string | null): Promise<ProposedFix[]> {
    const candidates = tasks.filter(t => !t.isSummary && !t.parentTaskId);
    if (candidates.length < 6) return []; // too small to benefit from phases

    const taskLines = candidates.map(t => `- id=${t.id} | "${t.name}"`).join('\n');
    const systemPrompt = `You are a scheduling expert. Group these project tasks into 3-8 sequential PHASES ` +
      `(for example: Initiation, Analysis & Design, Build/Configuration, Testing, Migration, Go-Live) based on what each task does. ` +
      `Only group tasks that clearly belong together; omit any you are unsure about. Do not invent tasks. ` +
      `Return JSON: { "groups": [ { "phaseName": string, "taskIds": string[] } ] } using only ids from the list.`;
    const userMessage = `Tasks:\n${taskLines}`;

    const { data } = await claudeService.completeWithJsonSchema({
      systemPrompt,
      userMessage,
      schema: AiGroupingSchema,
      maxTokens: 1500,
      temperature: 0.2,
      userId: userId ?? undefined,
    });

    return buildGroupingFixes(data.groups, candidates);
  }

  /** Apply the selected fixes, recording a reversal log, then re-score. */
  async apply(scheduleId: string, proposalId: string, fixIds: string[], userId: string | null): Promise<ApplyResult> {
    const proposal = await scheduleFixProposalRepository.findById(proposalId);
    if (!proposal || proposal.scheduleId !== scheduleId) throw new ScheduleFixNotFoundError(proposalId);
    if (proposal.status !== 'pending') throw new ScheduleFixStateError(`Proposal is ${proposal.status}, not pending`);

    const selected = new Set(fixIds);
    const fixes = proposal.proposalData.fixes.filter(f => selected.has(f.id));
    const skipped: Array<{ fixId: string; reason: string }> = [];

    const before = await scheduleReviewService.latest(scheduleId);
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const taskById = new Map(tasks.map(t => [t.id, t]));

    // Snapshot before touching anything, so the PM can fall back to it.
    let baselineId: string | null = null;
    try {
      const baseline = await baselineService.create(scheduleId, 'Pre-review baseline', userId ?? 'system');
      baselineId = baseline.id;
    } catch (err: any) {
      logger.warn('[ScheduleFix] pre-review baseline failed', { scheduleId, error: err?.message });
    }

    const applied: AppliedAction[] = [];
    let appliedCount = 0;

    // 1) dependencies
    for (const f of fixes.filter(f => f.type === 'add_dependency')) {
      try {
        await scheduleService.addDependency(f.taskId!, f.dependsOnTaskId!, f.dependencyType ?? 'FS', f.lagDays ?? 0);
        applied.push({ op: 'remove_dependency', taskId: f.taskId!, dependencyId: f.dependsOnTaskId! });
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'dependency rejected (cycle or duplicate)' });
      }
    }

    // 2) milestones — a milestone is a point in time: also zero its duration and
    // collapse its end date to its start, else it trips R04 (milestone with duration).
    for (const f of fixes.filter(f => f.type === 'set_milestone')) {
      const t = taskById.get(f.taskId!);
      const oldValue = {
        isMilestone: t?.isMilestone ?? false,
        estimatedDays: t?.estimatedDays ?? null,
        endDate: t?.endDate ?? null,
      };
      const update: Record<string, unknown> = { isMilestone: true, estimatedDays: 0 };
      if (t?.startDate) update.endDate = t.startDate.slice(0, 10);
      try {
        await scheduleService.updateTask(f.taskId!, update as any);
        applied.push({ op: 'restore_milestone', taskId: f.taskId!, oldValue });
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not flag milestone' });
      }
    }

    // 3) parents — create one phase parent per distinct newParentName, then reparent.
    const parentIdByName = new Map<string, string>();
    for (const f of fixes.filter(f => f.type === 'set_parent')) {
      try {
        let parentId = f.parentTaskId;
        if (!parentId && f.newParentName) {
          parentId = parentIdByName.get(f.newParentName);
          if (!parentId) {
            const created = await scheduleService.createTask({ scheduleId, name: f.newParentName, createdBy: userId ?? 'system' });
            parentId = created.id;
            parentIdByName.set(f.newParentName, parentId);
            // Delete the created parent LAST on undo (recorded before its children's restore_parent).
            applied.push({ op: 'delete_task', taskId: parentId });
          }
        }
        if (!parentId) { skipped.push({ fixId: f.id, reason: 'no parent target' }); continue; }
        const old = taskById.get(f.taskId!)?.parentTaskId ?? null;
        await scheduleService.updateTask(f.taskId!, { parentTaskId: parentId });
        applied.push({ op: 'restore_parent', taskId: f.taskId!, oldValue: old });
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not reparent' });
      }
    }

    // Re-flow dates so the schedule respects the new logic (SR1). Pinned tasks
    // (completed / actual-dated) stay put. Never fails the apply.
    let recompute = { deltas: [] as DateDelta[], tasksMoved: 0, leafCount: 0, projectEndBefore: null as string | null, projectEndAfter: null as string | null, projectEndShiftDays: 0 };
    try {
      recompute = await scheduleRecomputeService.recompute(scheduleId);
    } catch (err: any) {
      logger.warn('[ScheduleFix] date recompute failed', { scheduleId, error: err?.message });
    }
    const movedFar = recompute.deltas.filter(d => Math.abs(d.movedDays) > 10).length;
    const warning = recompute.leafCount > 0 && movedFar / recompute.leafCount > 0.30
      ? `${movedFar} of ${recompute.leafCount} tasks moved more than 10 days. Review before keeping, or undo.`
      : null;

    const after = await scheduleReviewService.run(scheduleId, 'post_proposal', userId, proposalId);
    await scheduleFixProposalRepository.markApplied(proposalId, applied, baselineId);

    auditLedgerService.append({
      actorId: userId ?? 'system',
      actorType: userId ? 'user' : 'system',
      action: 'schedule.fix.apply',
      entityType: 'schedule',
      entityId: scheduleId,
      projectId: proposal.projectId,
      payload: { proposalId, appliedCount, beforeScore: before?.score ?? null, afterScore: after.score, actions: applied, skipped, baselineId, datesMoved: recompute.tasksMoved, projectEndShiftDays: recompute.projectEndShiftDays },
      source: 'web',
    }).catch(err => logger.warn('[ScheduleFix] audit append (apply) failed', { proposalId, error: err?.message }));

    return {
      beforeScore: before?.score ?? null,
      afterScore: after.score,
      appliedCount,
      skipped,
      datesMoved: recompute.tasksMoved,
      projectEndBefore: recompute.projectEndBefore,
      projectEndAfter: recompute.projectEndAfter,
      projectEndShiftDays: recompute.projectEndShiftDays,
      warning,
      dateDeltas: recompute.deltas.slice(0, 50),
    };
  }

  /** Reverse an applied proposal, then re-score. */
  async undo(scheduleId: string, proposalId: string, userId: string | null): Promise<{ score: number }> {
    const proposal = await scheduleFixProposalRepository.findById(proposalId);
    if (!proposal || proposal.scheduleId !== scheduleId) throw new ScheduleFixNotFoundError(proposalId);
    if (proposal.status !== 'applied') throw new ScheduleFixStateError(`Proposal is ${proposal.status}, not applied`);

    const log = proposal.appliedData ?? [];
    for (const action of [...log].reverse()) {
      try {
        switch (action.op) {
          case 'remove_dependency':
            await scheduleService.removeDependency(action.taskId!, action.dependencyId!);
            break;
          case 'restore_milestone': {
            // oldValue may be a plain boolean (older applied logs) or the richer
            // { isMilestone, estimatedDays, endDate } snapshot — handle both.
            const ov = action.oldValue;
            if (ov && typeof ov === 'object') {
              const o = ov as { isMilestone?: boolean; estimatedDays?: number | null; endDate?: string | null };
              await scheduleService.updateTask(action.taskId!, {
                isMilestone: Boolean(o.isMilestone),
                estimatedDays: o.estimatedDays ?? undefined,
                endDate: o.endDate ?? undefined,
              } as any);
            } else {
              await scheduleService.updateTask(action.taskId!, { isMilestone: Boolean(ov) });
            }
            break;
          }
          case 'restore_parent':
            // null clears parent_task_id at the DB level (updateTask writes val ?? null);
            // the Task type models parentTaskId as string|undefined, so cast to allow null.
            await scheduleService.updateTask(action.taskId!, { parentTaskId: (action.oldValue as string | null) ?? null } as any);
            break;
          case 'delete_task':
            await scheduleService.deleteTask(action.taskId!);
            break;
        }
      } catch (err: any) {
        logger.warn('[ScheduleFix] undo step failed', { proposalId, op: action.op, error: err?.message });
      }
    }

    // Restore every task's dates from the Pre-review baseline (the recompute on
    // apply moved them), then remove that baseline so undo returns the exact prior
    // state. Read the baseline BEFORE deleting it.
    if (proposal.baselineId) {
      try {
        const baseline = await baselineService.findById(proposal.baselineId);
        for (const bt of baseline?.tasks ?? []) {
          const start = bt.startDate ? new Date(bt.startDate).toISOString().slice(0, 10) : null;
          const end = bt.endDate ? new Date(bt.endDate).toISOString().slice(0, 10) : null;
          await taskRepository.updateDates(bt.taskId, start, end).catch(() => { /* task may have been removed */ });
        }
      } catch (err: any) {
        logger.warn('[ScheduleFix] undo date restore failed', { proposalId, error: err?.message });
      }
      await baselineService.delete(proposal.baselineId).catch((err: any) =>
        logger.warn('[ScheduleFix] undo baseline delete failed', { proposalId, error: err?.message }));
    }

    const review = await scheduleReviewService.run(scheduleId, 'post_proposal', userId);
    await scheduleFixProposalRepository.setStatus(proposalId, 'undone');

    auditLedgerService.append({
      actorId: userId ?? 'system',
      actorType: userId ? 'user' : 'system',
      action: 'schedule.fix.undo',
      entityType: 'schedule',
      entityId: scheduleId,
      projectId: proposal.projectId,
      payload: { proposalId, restored: log, score: review.score },
      source: 'web',
    }).catch(err => logger.warn('[ScheduleFix] audit append (undo) failed', { proposalId, error: err?.message }));

    return { score: review.score };
  }

  /** Reject a proposal and remember it as a negative example for future prompts. */
  async reject(scheduleId: string, proposalId: string, feedback: string | undefined, userId: string | null): Promise<void> {
    const proposal = await scheduleFixProposalRepository.findById(proposalId);
    if (!proposal || proposal.scheduleId !== scheduleId) throw new ScheduleFixNotFoundError(proposalId);
    if (proposal.status !== 'pending') throw new ScheduleFixStateError(`Proposal is ${proposal.status}, not pending`);

    if (userId) {
      aiLearning.recordFeedback({
        feature: 'schedule_fix',
        projectId: proposal.projectId,
        userAction: 'rejected',
        suggestionData: { fixes: proposal.proposalData.fixes } as Record<string, unknown>,
        feedbackText: feedback,
      }, userId);
    }
    await scheduleFixProposalRepository.setStatus(proposalId, 'rejected');

    auditLedgerService.append({
      actorId: userId ?? 'system',
      actorType: userId ? 'user' : 'system',
      action: 'schedule.fix.reject',
      entityType: 'schedule',
      entityId: scheduleId,
      projectId: proposal.projectId,
      payload: { proposalId, feedback: feedback ?? null },
      source: 'web',
    }).catch(err => logger.warn('[ScheduleFix] audit append (reject) failed', { proposalId, error: err?.message }));
  }

  async getLatest(scheduleId: string): Promise<ScheduleFixProposal | null> {
    return scheduleFixProposalRepository.findLatest(scheduleId);
  }
}

export class ScheduleFixNotFoundError extends Error {
  constructor(id: string) { super(`Schedule fix proposal not found: ${id}`); this.name = 'ScheduleFixNotFoundError'; }
}
export class ScheduleFixStateError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ScheduleFixStateError'; }
}

export const scheduleFixProposerService = new ScheduleFixProposerService();
