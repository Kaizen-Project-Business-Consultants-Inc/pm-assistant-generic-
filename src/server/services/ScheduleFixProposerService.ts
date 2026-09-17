import { randomUUID } from 'crypto';
import { z } from 'zod';
import { scheduleService } from './ScheduleService';
import { baselineService } from './BaselineService';
import { scheduleReviewService } from './ScheduleReviewService';
import { claudeService } from './claudeService';
import { config } from '../config';
import { AILearningServiceV2 } from './aiLearningService';
import { auditLedgerService } from './AuditLedgerService';
import logger from '../utils/logger';
import {
  proposeFixesDeterministic,
  DEFAULT_CHECK_THRESHOLD,
  type ProposedFix,
  type FixType,
} from './scheduleReview/fixProposer';
import { RULES_VERSION, type Finding, type ReviewTask } from './scheduleReview/rules';
import {
  scheduleFixProposalRepository,
  type ScheduleFixProposal,
  type AppliedAction,
} from '../database/ScheduleFixProposalRepository';

const aiLearning = new AILearningServiceV2();

/** Shape the AI returns; server normalises ids/defaultChecked and validates targets. */
const AiFixSchema = z.object({
  type: z.enum(['add_dependency', 'set_milestone', 'set_parent']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(300),
  taskId: z.string().optional(),
  dependsOnTaskId: z.string().optional(),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
  lagDays: z.number().optional(),
  newParentName: z.string().max(80).optional(),
});
const AiFixProposalSchema = z.object({
  fixes: z.array(AiFixSchema).max(100),
  summary: z.string().max(400).optional(),
});

export interface ApplyResult {
  beforeScore: number | null;
  afterScore: number;
  appliedCount: number;
  skipped: Array<{ fixId: string; reason: string }>;
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

    // Deterministic is instant and is the default, so the button never blocks on
    // the model. AI is opt-in (a "Draft with AI" action) and only for schedules
    // small enough to fit one response.
    let fixes: ProposedFix[];
    let source: 'ai' | 'rules';
    const aiUsable = useAi && config.AI_ENABLED && claudeService.isAvailable() && leafCount <= 60;
    if (aiUsable) {
      try {
        fixes = await this.aiPropose(review.findings, tasks, schedule, userId);
        source = 'ai';
      } catch (err: any) {
        logger.warn('[ScheduleFix] AI proposer failed, using deterministic rules', { scheduleId, error: err?.message });
        fixes = proposeFixesDeterministic(review.findings, tasks);
        source = 'rules';
      }
    } else {
      fixes = proposeFixesDeterministic(review.findings, tasks);
      source = 'rules';
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

  /** One Claude call; validated + normalised against the real task graph. Falls back to rules. */
  private async aiPropose(findings: Finding[], tasks: ReviewTask[], schedule: any, userId: string | null): Promise<ProposedFix[]> {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const taskLines = tasks.map(t =>
      `- id=${t.id} | "${t.name}" | order=${t.sortOrder ?? 0} | parent=${t.parentTaskId ?? 'none'} | milestone=${t.isMilestone ? 'yes' : 'no'} | deps=${(t.dependencies || []).length}`,
    ).join('\n');
    const findingLines = findings.map(f => `- ${f.ruleId} (${f.severity}): ${f.message}`).join('\n');

    const systemPrompt = `You are a scheduling expert helping a project manager fix an imported schedule. ` +
      `Propose only STRUCTURAL fixes of these types: add_dependency (finish-to-start link between two existing tasks), ` +
      `set_milestone (flag an existing zero-work task as a milestone), set_parent (group tasks under a new phase, via newParentName). ` +
      `Never invent tasks or dates. Only reference task ids that exist. Give each fix a confidence 0..1 and a SHORT reason (max 12 words). ` +
      `Return JSON: { "fixes": [ { "type", "confidence", "reason", "taskId?", "dependsOnTaskId?", "dependencyType?", "lagDays?", "newParentName?" } ], "summary"? }.`;

    const userMessage = `Project window: ${schedule.startDate ?? '?'} to ${schedule.endDate ?? '?'}.\n\n` +
      `Review findings:\n${findingLines || '(none)'}\n\nTasks:\n${taskLines}`;

    const { data } = await claudeService.completeWithJsonSchema({
      systemPrompt,
      userMessage,
      schema: AiFixProposalSchema,
      maxTokens: 4000,
      temperature: 0.2,
      userId: userId ?? undefined,
    });

    // Post-validate against the real graph; drop anything that references unknown
    // tasks or is internally inconsistent, and compute ids + defaultChecked here.
    const out: ProposedFix[] = [];
    for (const f of data.fixes) {
      if (!f.taskId || !byId.has(f.taskId)) continue;
      const t = byId.get(f.taskId)!;
      const confidence = Math.max(0, Math.min(1, f.confidence));
      const base = { confidence, reason: f.reason, defaultChecked: confidence >= DEFAULT_CHECK_THRESHOLD };
      if (f.type === 'add_dependency') {
        if (!f.dependsOnTaskId || !byId.has(f.dependsOnTaskId) || f.dependsOnTaskId === f.taskId) continue;
        out.push({ ...base, id: `add_dependency:${f.taskId}:${f.dependsOnTaskId}`, type: 'add_dependency',
          taskId: f.taskId, taskName: t.name, dependsOnTaskId: f.dependsOnTaskId, dependsOnTaskName: byId.get(f.dependsOnTaskId)!.name,
          dependencyType: (f.dependencyType ?? 'FS'), lagDays: f.lagDays ?? 0 });
      } else if (f.type === 'set_milestone') {
        if (t.isMilestone) continue;
        out.push({ ...base, id: `set_milestone:${f.taskId}`, type: 'set_milestone', taskId: f.taskId, taskName: t.name });
      } else if (f.type === 'set_parent') {
        if (!f.newParentName) continue;
        out.push({ ...base, id: `set_parent:${f.taskId}:${f.newParentName}`, type: 'set_parent', taskId: f.taskId, taskName: t.name, newParentName: f.newParentName });
      }
    }
    // If the model returned nothing usable, fall back to deterministic rules.
    return out.length > 0 ? out : proposeFixesDeterministic(findings, tasks);
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

    const after = await scheduleReviewService.run(scheduleId, 'post_proposal', userId, proposalId);
    await scheduleFixProposalRepository.markApplied(proposalId, applied, baselineId);

    auditLedgerService.append({
      actorId: userId ?? 'system',
      actorType: userId ? 'user' : 'system',
      action: 'schedule.fix.apply',
      entityType: 'schedule',
      entityId: scheduleId,
      projectId: proposal.projectId,
      payload: { proposalId, appliedCount, beforeScore: before?.score ?? null, afterScore: after.score, actions: applied, skipped, baselineId },
      source: 'web',
    }).catch(err => logger.warn('[ScheduleFix] audit append (apply) failed', { proposalId, error: err?.message }));

    return { beforeScore: before?.score ?? null, afterScore: after.score, appliedCount, skipped };
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

    // Remove the Pre-review baseline this apply created, so undo restores the
    // exact prior state (otherwise the schedule keeps a baseline it did not have).
    if (proposal.baselineId) {
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
