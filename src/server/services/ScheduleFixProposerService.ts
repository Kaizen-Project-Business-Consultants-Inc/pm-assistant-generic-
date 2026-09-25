import { getActorSource } from '../middleware/requestContext';
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
  buildSplitFixes,
  buildPhaseFixes,
  splitCandidates,
  planSplitDates,
  type ProposedFix,
} from './scheduleReview/fixProposer';
import { RULES_VERSION, findMissingPhases, type ReviewTask } from './scheduleReview/rules';
import { profileFor } from './scheduleReview/domainProfiles';
import { projectService } from './ProjectService';
import { sprintService } from './SprintService';
import {
  scheduleFixProposalRepository,
  type ScheduleFixProposal,
  type AppliedAction,
} from '../database/ScheduleFixProposalRepository';

const aiLearning = new AILearningServiceV2();

/**
 * One AI call per "Propose fixes" click, for the things rules cannot do — reading what
 * task names mean: group loose tasks into phases, split tasks that bundle independent
 * steps, and place a task for each missing standard phase. The deterministic engine still
 * produces the dependency chain, milestone flags, durations and buffers. The score never
 * uses AI. Small reply (a few items), so it returns fast and doesn't truncate.
 */
const AiSuggestionSchema = z.object({
  groups: z.array(z.object({
    phaseName: z.string().min(1).max(80),
    taskIds: z.array(z.string()).min(1).max(200),
  })).max(20).default([]),
  splits: z.array(z.object({
    taskId: z.string(),
    parts: z.array(z.object({
      name: z.string().min(1).max(200),
      isMilestone: z.boolean().optional(),
      days: z.number().optional(),
    })).min(2).max(5),
    reason: z.string().max(400).optional(),
  })).max(15).default([]),
  phases: z.array(z.object({
    phase: z.string(),
    name: z.string().min(1).max(200),
    days: z.number().optional(),
    afterTaskId: z.string().nullable().optional(),
    beforeTaskId: z.string().nullable().optional(),
    reason: z.string().max(400).optional(),
  })).max(10).default([]),
});

/** The user's rule for splitting (agreed 2026-09-25), with their own examples. */
const SPLIT_RULES = `SPLITTING RULE. Several action verbs in one task is a prompt to think, not an automatic split.
- SPLIT when the verbs are independent actions: each can be done, finished and checked on its own, often by different people, and one waits for the other (a hand-off, or an approval by someone else).
- DO NOT split when the verbs describe one activity: the same people working through it in one go, where the second verb just completes or polishes the first; or when two phrases name the same thing.
- Approvals, sign-offs, signatures and hand-over events are one-day MILESTONES (isMilestone true, days 0), not work.
Examples:
  "Circulate and obtain approval for BRD" -> SPLIT: "Circulate BRD" (work) then "BRD approved" (milestone).
  "Update and final review BRD" -> KEEP (one activity).
  "Develop and unit test login module" -> KEEP (developers test as they build).
  "Build API and deploy to staging" -> SPLIT: "Build API" then "Deploy API to staging".
  "Draft, review and sign contract" -> SPLIT: "Draft contract", "Review contract", "Contract signed" (milestone).
  "Configure and test firewall rules" -> KEEP (same engineer, one sitting).
  "Go-Live Execution / Production Cutover" -> KEEP (two names for the same activity).
Only return tasks that should be split. Keep the original wording and subject in each part's name. days = rough share of the task for work parts.`;

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
    estimatedDays: t.estimatedDays,
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
        const ai = await this.aiSuggestions(schedule.projectId, tasks, userId);
        if (ai.groupings.length > 0) fixes = [...fixes.filter(f => f.type !== 'set_parent'), ...ai.groupings];
        fixes = [...fixes, ...ai.splits, ...ai.phases];
        if (ai.groupings.length + ai.splits.length + ai.phases.length > 0) source = 'ai';
      } catch (err: any) {
        // Includes the plan having no AI allowance (Basic/Trial): rules-only fixes stand.
        logger.warn('[ScheduleFix] AI suggestions failed, keeping deterministic fixes', { scheduleId, error: err?.message });
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
   * One model call for everything that needs the meaning of task names. Each part is
   * asked for only when it applies: phase grouping for a flat plan (6+ loose tasks),
   * splits for tasks whose names might bundle steps, a placed task for each standard
   * phase the review found missing. Nothing to ask → no call, no tokens.
   */
  private async aiSuggestions(projectId: string, tasks: ReviewTask[], userId: string | null): Promise<{ groupings: ProposedFix[]; splits: ProposedFix[]; phases: ProposedFix[] }> {
    const groupCandidates = tasks.filter(t => !t.isSummary && !t.parentTaskId);
    const wantGroups = groupCandidates.length >= 6 && !tasks.some(t => t.isSummary);
    const splitCands = splitCandidates(tasks);

    const [project, sprints] = await Promise.all([
      projectService.findById(projectId).catch(() => null),
      sprintService.getByProject(projectId).catch(() => []),
    ]);
    const profile = profileFor(project?.projectType, project?.methodology);
    const missing = profile ? findMissingPhases(tasks, profile, sprints.length) : [];

    if (!wantGroups && splitCands.length === 0 && missing.length === 0) return { groupings: [], splits: [], phases: [] };

    const line = (t: ReviewTask) => `- id=${t.id} | "${t.name}" | ${String(t.startDate ?? '').slice(0, 10)} to ${String(t.endDate ?? '').slice(0, 10)}${t.isMilestone ? ' | milestone' : ''}`;
    const sections: string[] = [];
    const asks: string[] = [];
    if (wantGroups) {
      asks.push(`"groups": group the loose tasks into 3-8 sequential PHASES (e.g. Initiation, Analysis & Design, Build, Testing, Migration, Go-Live). Only group tasks that clearly belong together; omit any you are unsure about.`);
      sections.push(`Loose tasks (for groups):\n${groupCandidates.map(line).join('\n')}`);
    }
    if (splitCands.length > 0) {
      asks.push(`"splits": apply the SPLITTING RULE to these tasks.`);
      sections.push(`Tasks that might bundle steps (for splits):\n${splitCands.map(line).join('\n')}`);
    }
    if (missing.length > 0) {
      asks.push(`"phases": the plan is missing these standard phases for ${profile!.description}: ${missing.join(', ')}. For each, give one task: "phase" (exactly one of those labels), a specific "name", "days", and where it goes — "afterTaskId" (the task it follows) and "beforeTaskId" (the task that should wait for it), both ids from the full list, or null.`);
      sections.push(`Full plan (for phases):\n${tasks.filter(t => !t.isSummary).map(line).join('\n')}`);
    }

    const systemPrompt = `You are a project scheduling expert reviewing a plan. Do not invent tasks except where asked for a missing phase. Use only ids from the lists.\n\n` +
      (splitCands.length > 0 ? `${SPLIT_RULES}\n\n` : '') +
      `Return JSON with these keys (empty arrays for anything not asked):\n` +
      `{ "groups": [ { "phaseName": string, "taskIds": string[] } ], "splits": [ { "taskId": string, "parts": [ { "name": string, "isMilestone": boolean, "days": number } ], "reason": string } ], "phases": [ { "phase": string, "name": string, "days": number, "afterTaskId": string|null, "beforeTaskId": string|null, "reason": string } ] }\n\n` +
      `Asked for:\n${asks.map(a => `- ${a}`).join('\n')}`;

    const { data } = await claudeService.completeWithJsonSchema({
      systemPrompt,
      userMessage: sections.join('\n\n'),
      schema: AiSuggestionSchema,
      maxTokens: 2500,
      temperature: 0.2,
      userId: userId ?? undefined,
    });

    return {
      groupings: wantGroups ? buildGroupingFixes(data.groups, groupCandidates) : [],
      splits: splitCands.length > 0 ? buildSplitFixes(data.splits, splitCands) : [],
      phases: missing.length > 0 ? buildPhaseFixes(data.phases, tasks, missing) : [],
    };
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

    // 4) durations — correct estimatedDays to match the task's dates
    for (const f of fixes.filter(f => f.type === 'set_duration')) {
      const old = taskById.get(f.taskId!)?.estimatedDays ?? null;
      try {
        await scheduleService.updateTask(f.taskId!, { estimatedDays: f.newDuration });
        applied.push({ op: 'restore_duration', taskId: f.taskId!, oldValue: old });
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not set duration' });
      }
    }

    // 5) buffers — insert a protective task between a gate and its predecessors.
    // Rewire: preds → buffer → gate. Record readd_dependency so undo restores the
    // gate's original links, plus delete_task for the created buffer.
    for (const f of fixes.filter(f => f.type === 'insert_buffer')) {
      try {
        const gate = taskById.get(f.gateTaskId!);
        if (!gate) { skipped.push({ fixId: f.id, reason: 'gate not found' }); continue; }
        const preds = (gate.dependencies || []).map(d => ({ id: d.dependencyId, type: (d.dependencyType || 'FS') as 'FS' | 'SS' | 'FF' | 'SF', lag: d.lagDays ?? 0 }));
        if (preds.length === 0) { skipped.push({ fixId: f.id, reason: 'gate has no predecessor to buffer' }); continue; }

        const buffer = await scheduleService.createTask({
          scheduleId,
          name: `Buffer before ${f.gateName ?? gate.name}`,
          estimatedDays: f.bufferDays ?? 1,
          createdBy: userId ?? 'system',
        });
        applied.push({ op: 'delete_task', taskId: buffer.id });

        // Move the gate's incoming links onto the buffer.
        for (const p of preds) {
          await scheduleService.addDependency(buffer.id, p.id, p.type, p.lag);
          await scheduleService.removeDependency(f.gateTaskId!, p.id);
          applied.push({ op: 'readd_dependency', taskId: f.gateTaskId!, dependencyId: p.id, dependencyType: p.type, lagDays: p.lag });
        }
        // Gate now depends on the buffer.
        await scheduleService.addDependency(f.gateTaskId!, buffer.id, 'FS', 0);
        applied.push({ op: 'remove_dependency', taskId: f.gateTaskId!, dependencyId: buffer.id });
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not insert buffer' });
      }
    }

    // 6) splits — the bundled task becomes a summary over its parts, linked in order, with
    // the task's own dates shared across them. Its links move onto the parts (a summary
    // shouldn't carry links — R29): predecessors to the first part, successors off the last.
    for (const f of fixes.filter(f => f.type === 'split_task')) {
      try {
        const t = taskById.get(f.taskId!);
        if (!t || !t.startDate || !t.endDate || !f.parts?.length) { skipped.push({ fixId: f.id, reason: 'task not found or has no dates' }); continue; }
        if (tasks.some(x => x.parentTaskId === t.id)) { skipped.push({ fixId: f.id, reason: 'task already has tasks under it' }); continue; }
        const planned = planSplitDates(String(t.startDate), String(t.endDate), f.parts);
        const created: string[] = [];
        let after = t.id;
        for (const part of planned) {
          const child = await scheduleService.createTask({
            scheduleId,
            name: part.name,
            parentTaskId: t.id,
            afterTaskId: after,
            startDate: part.startDate,
            endDate: part.endDate,
            isMilestone: part.isMilestone,
            estimatedDays: part.isMilestone ? 0 : undefined,
            assignedTo: t.assignedTo || undefined,
            status: t.status,
            priority: t.priority,
            createdBy: userId ?? 'system',
          } as any);
          applied.push({ op: 'delete_task', taskId: child.id }); // undo removes parts (and their links)
          created.push(child.id);
          after = child.id;
        }
        // A milestone part (approval, sign-off) happens the day the work before it finishes,
        // so that link is finish-to-finish; finish-to-start would push it a day later and
        // stretch the summary past the task's own end.
        for (let i = 1; i < created.length; i++) {
          await scheduleService.addDependency(created[i], created[i - 1], planned[i].isMilestone ? 'FF' : 'FS', 0);
        }
        const first = created[0];
        const last = created[created.length - 1];
        for (const d of t.dependencies || []) {
          await scheduleService.addDependency(first, d.dependencyId, (d.dependencyType || 'FS') as any, d.lagDays ?? 0);
          await scheduleService.removeDependency(t.id, d.dependencyId);
          applied.push({ op: 'readd_dependency', taskId: t.id, dependencyId: d.dependencyId, dependencyType: (d.dependencyType || 'FS') as any, lagDays: d.lagDays ?? 0 });
        }
        for (const succ of tasks.filter(x => (x.dependencies || []).some(d => d.dependencyId === t.id))) {
          const d = succ.dependencies.find(dd => dd.dependencyId === t.id)!;
          await scheduleService.addDependency(succ.id, last, (d.dependencyType || 'FS') as any, d.lagDays ?? 0);
          await scheduleService.removeDependency(succ.id, t.id);
          applied.push({ op: 'readd_dependency', taskId: succ.id, dependencyId: t.id, dependencyType: (d.dependencyType || 'FS') as any, lagDays: d.lagDays ?? 0 });
          applied.push({ op: 'remove_dependency', taskId: succ.id, dependencyId: last });
        }
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not split task' });
      }
    }

    // 7) missing phases — one task, placed after its anchor and linked; the task that should
    // wait for it gets a link too, and the re-flow below pushes it later if needed.
    for (const f of fixes.filter(f => f.type === 'add_task')) {
      try {
        const anchor = f.afterTaskId ? taskById.get(f.afterTaskId) : undefined;
        const start = anchor?.endDate ? new Date(Date.parse(String(anchor.endDate).slice(0, 10) + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10) : undefined;
        const end = start ? new Date(Date.parse(start + 'T00:00:00Z') + ((f.newTaskDays ?? 5) - 1) * 86_400_000).toISOString().slice(0, 10) : undefined;
        const created = await scheduleService.createTask({
          scheduleId,
          name: f.newTaskName!,
          afterTaskId: anchor?.id,
          parentTaskId: anchor?.parentTaskId || undefined,
          startDate: start,
          endDate: end,
          estimatedDays: f.newTaskDays ?? 5,
          createdBy: userId ?? 'system',
        } as any);
        applied.push({ op: 'delete_task', taskId: created.id }); // undo removes it and its links
        if (anchor) await scheduleService.addDependency(created.id, anchor.id, 'FS', 0);
        if (f.beforeTaskId && taskById.has(f.beforeTaskId)) {
          await scheduleService.addDependency(f.beforeTaskId, created.id, 'FS', 0).catch(() => { /* would loop — leave it unlinked */ });
        }
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not add phase task' });
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
      source: getActorSource(),
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
          case 'restore_duration':
            await scheduleService.updateTask(action.taskId!, { estimatedDays: (action.oldValue as number | null) ?? undefined } as any);
            break;
          case 'readd_dependency':
            await scheduleService.addDependency(action.taskId!, action.dependencyId!, action.dependencyType ?? 'FS', action.lagDays ?? 0);
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
      source: getActorSource(),
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
      source: getActorSource(),
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
