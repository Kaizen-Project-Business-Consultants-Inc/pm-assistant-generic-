import { getActorSource } from '../middleware/requestContext';
import { changeHistoryService } from './ChangeHistoryService';
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
import { groupBy } from '../utils/groupBy';
import { type IsWorking, weekdaysOnly, shiftWorking, finishFor, utcDay, ymdOf } from '../utils/workingDays';
import {
  proposeFixesDeterministic,
  buildGroupingFixes,
  buildSplitFixes,
  buildPhaseFixes,
  splitCandidates,
  planSplitDates,
  type ProposedFix, describeFix } from './scheduleReview/fixProposer';
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
    let fixes: ProposedFix[] = proposeFixesDeterministic(review.findings, tasks, await this.workingDayTest(scheduleId));
    let source: 'ai' | 'rules' = 'rules';
    if (useAi && config.AI_ENABLED && claudeService.isAvailable() && leafCount <= 80) {
      try {
        const ai = await this.aiSuggestions(schedule.projectId, tasks, userId);
        if (ai.groupings.length > 0) fixes = [...fixes.filter(f => f.type !== 'set_parent'), ...ai.groupings];
        // A milestone-named line already has the rule-based split (review / approve / approved / gate)
        const ruleSplits = new Set(fixes.filter(f => f.type === 'split_task').map(f => f.taskId));
        fixes = [...fixes, ...ai.splits.filter(f => !ruleSplits.has(f.taskId)), ...ai.phases];
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
    // Loose top-level tasks get grouped even when the plan already has some phases (a partly
    // organised plan, e.g. a contract import with a few headings); existing phases are offered.
    const hasKids = new Set(tasks.map(t => t.parentTaskId).filter(Boolean) as string[]);
    const groupCandidates = tasks.filter(t => !t.isSummary && !t.parentTaskId && !hasKids.has(t.id));
    const existingPhases = tasks.filter(t => !t.parentTaskId && (t.isSummary || hasKids.has(t.id)));
    const wantGroups = groupCandidates.length >= 6;
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
      if (existingPhases.length > 0) {
        sections.push(`Phases the plan already has (reuse a name exactly to put tasks in it):\n${existingPhases.map(p => `- "${p.name}"`).join('\n')}`);
      }
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
      groupings: wantGroups ? buildGroupingFixes(data.groups, groupCandidates, existingPhases) : [],
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
    // Dates the fixes pick land on working days of the project calendar
    const isWorking = await this.workingDayTest(scheduleId);

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
    // The fixes of each kind, in the order they were proposed
    const fixesOfType = groupBy(fixes, f => f.type);
    const ofType = (type: ProposedFix['type']) => fixesOfType.get(type) ?? [];

    /* eslint-disable no-await-in-loop -- fixes apply one by one, in order: each is logged for undo and the cycle/duplicate checks see the links earlier fixes added */
    // 1) dependencies
    for (const f of ofType('add_dependency')) {
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
    for (const f of ofType('set_milestone')) {
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
    for (const f of ofType('set_parent')) {
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
    for (const f of ofType('set_duration')) {
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
    for (const f of ofType('insert_buffer')) {
      try {
        const gate = taskById.get(f.gateTaskId!);
        if (!gate) { skipped.push({ fixId: f.id, reason: 'gate not found' }); continue; }
        const preds = (gate.dependencies || []).map(d => ({ id: d.dependencyId, type: (d.dependencyType || 'FS') as 'FS' | 'SS' | 'FF' | 'SF', lag: d.lagDays ?? 0 }));
        if (preds.length === 0) { skipped.push({ fixId: f.id, reason: 'gate has no predecessor to buffer' }); continue; }

        // The buffer runs from the first working day after its latest feeder finishes, for
        // its length in working days (the re-flow below settles the final dates).
        // eslint-disable-next-line no-restricted-syntax -- small: one gate's own links (each read once)
        const feederEnds = preds.map(p => taskById.get(p.id)?.endDate).filter(Boolean).map(e => ymdOf(utcDay(e)));
        // eslint-disable-next-line no-restricted-syntax -- small: one gate's own links (each read once)
        const latestFeederEnd = feederEnds.sort().pop();
        const bufferStart = latestFeederEnd ? shiftWorking(utcDay(latestFeederEnd), 1, isWorking) : null;
        const buffer = await scheduleService.createTask({
          scheduleId,
          name: `Buffer before ${f.gateName ?? gate.name}`,
          estimatedDays: f.bufferDays ?? 1,
          startDate: bufferStart ? ymdOf(bufferStart) : undefined,
          endDate: bufferStart ? ymdOf(finishFor(bufferStart, f.bufferDays ?? 1, isWorking)) : undefined,
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
    // Looked up per split: who has tasks under it, and each task's successors (plan order, each once)
    const parentIds = new Set(tasks.map(x => x.parentTaskId).filter(Boolean));
    const successorsOf = new Map<string, typeof tasks>();
    for (const x of tasks) {
      const seen = new Set<string>();
      for (const d of x.dependencies || []) {
        if (seen.has(d.dependencyId)) continue;
        seen.add(d.dependencyId);
        const list = successorsOf.get(d.dependencyId);
        if (list) list.push(x); else successorsOf.set(d.dependencyId, [x]);
      }
    }
    for (const f of ofType('split_task')) {
      try {
        const t = taskById.get(f.taskId!);
        if (!t || !t.startDate || !t.endDate || !f.parts?.length) { skipped.push({ fixId: f.id, reason: 'task not found or has no dates' }); continue; }
        if (parentIds.has(t.id)) { skipped.push({ fixId: f.id, reason: 'task already has tasks under it' }); continue; }
        const planned = planSplitDates(String(t.startDate), String(t.endDate), f.parts, isWorking);
        const created: string[] = [];
        let after = t.id;
        // Replace (a milestone-named line): the task itself becomes the first part, so its
        // row, predecessors and history stay; the other parts follow it at the same level.
        let toCreate = planned;
        if (f.replace) {
          const [head, ...rest] = planned;
          applied.push({
            op: 'restore_task', taskId: t.id,
            oldValue: { name: t.name, isMilestone: !!t.isMilestone, estimatedDays: t.estimatedDays ?? null, startDate: String(t.startDate).slice(0, 10), endDate: String(t.endDate).slice(0, 10) },
          });
          await scheduleService.updateTask(t.id, {
            name: head.name, isMilestone: head.isMilestone, startDate: head.startDate, endDate: head.endDate,
            estimatedDays: head.isMilestone ? 0 : head.days,
          } as any);
          created.push(t.id);
          toCreate = rest;
        }
        for (const part of toCreate) {
          const child = await scheduleService.createTask({
            scheduleId,
            name: part.name,
            parentTaskId: f.replace ? (t.parentTaskId || undefined) : t.id,
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
        for (const d of f.replace ? [] : t.dependencies || []) { // replaced: the task is the first part and keeps them
          await scheduleService.addDependency(first, d.dependencyId, (d.dependencyType || 'FS') as any, d.lagDays ?? 0);
          await scheduleService.removeDependency(t.id, d.dependencyId);
          applied.push({ op: 'readd_dependency', taskId: t.id, dependencyId: d.dependencyId, dependencyType: (d.dependencyType || 'FS') as any, lagDays: d.lagDays ?? 0 });
        }
        for (const succ of successorsOf.get(t.id) ?? []) {
          // eslint-disable-next-line no-restricted-syntax -- small: one task's own links (each read once)
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
    for (const f of ofType('add_task')) {
      try {
        const anchor = f.afterTaskId ? taskById.get(f.afterTaskId) : undefined;
        // Starts the first working day after its anchor finishes; its length is working days
        const startDay = anchor?.endDate ? shiftWorking(utcDay(anchor.endDate), 1, isWorking) : null;
        const start = startDay ? ymdOf(startDay) : undefined;
        const end = startDay ? ymdOf(finishFor(startDay, f.newTaskDays ?? 5, isWorking)) : undefined;
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
    /* eslint-enable no-await-in-loop */

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
    await changeHistoryService.record({
      projectId: proposal.projectId,
      scheduleId,
      kind: 'review_fix',
      ref: proposalId,
      summary: `Applied ${appliedCount} Schedule Review fix${appliedCount === 1 ? '' : 'es'}${recompute.tasksMoved ? ` · ${recompute.tasksMoved} task${recompute.tasksMoved === 1 ? '' : 's'} moved` : ''}`,
      // eslint-disable-next-line no-restricted-syntax -- small: a two-item list per action
      taskIds: recompute.deltas.map(d => d.taskId).concat(applied.flatMap((a: any) => [a.taskId, a.newTaskId].filter(Boolean))),
      // History shows what the fixes did (2026-10-01: it only listed task names)
      undo: {
        proposalId,
        fixes: fixes.map(describeFix),
        added: applied.filter((a: any) => a.op === 'delete_task').map((a: any) => a.taskId),
        moved: recompute.deltas.map(d => ({ taskId: d.taskId, startDate: d.oldStart, endDate: d.oldEnd })),
      },
    });

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

  /** The schedule's project calendar; Mon-Fri when it cannot be read */
  private async workingDayTest(scheduleId: string): Promise<IsWorking> {
    try {
      return (await scheduleService.workingDayTest(scheduleId)) ?? weekdaysOnly;
    } catch {
      return weekdaysOnly;
    }
  }

  /** Reverse an applied proposal, then re-score. */
  async undo(scheduleId: string, proposalId: string, userId: string | null): Promise<{ score: number }> {
    const proposal = await scheduleFixProposalRepository.findById(proposalId);
    if (!proposal || proposal.scheduleId !== scheduleId) throw new ScheduleFixNotFoundError(proposalId);
    if (proposal.status !== 'applied') throw new ScheduleFixStateError(`Proposal is ${proposal.status}, not applied`);

    const log = proposal.appliedData ?? [];
    /* eslint-disable no-await-in-loop -- undo replays the applied log newest-first; a created parent must be deleted only after its children are restored */
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
          case 'restore_task': {
            const o = action.oldValue as { name: string; isMilestone: boolean; estimatedDays: number | null; startDate: string; endDate: string };
            await scheduleService.updateTask(action.taskId!, {
              name: o.name, isMilestone: o.isMilestone, estimatedDays: o.estimatedDays ?? undefined, startDate: o.startDate, endDate: o.endDate,
            } as any);
            break;
          }
        }
      } catch (err: any) {
        logger.warn('[ScheduleFix] undo step failed', { proposalId, op: action.op, error: err?.message });
      }
    }
    /* eslint-enable no-await-in-loop */

    // Restore every task's dates from the Pre-review baseline (the recompute on
    // apply moved them), then remove that baseline so undo returns the exact prior
    // state. Read the baseline BEFORE deleting it.
    if (proposal.baselineId) {
      try {
        const baseline = await baselineService.findById(proposal.baselineId);
        // All tasks in one batched write (one UPDATE per 100 tasks; their bookings move with
        // them). A task removed since is simply not matched by the UPDATE.
        await taskRepository.updateDatesMany((baseline?.tasks ?? []).map((bt) => ({
          id: bt.taskId,
          startDate: bt.startDate ? new Date(bt.startDate).toISOString().slice(0, 10) : null,
          endDate: bt.endDate ? new Date(bt.endDate).toISOString().slice(0, 10) : null,
        })));
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
