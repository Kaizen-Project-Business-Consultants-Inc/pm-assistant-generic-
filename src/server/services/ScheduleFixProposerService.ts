import { getActorSource } from '../middleware/requestContext';
import { changeHistoryService } from './ChangeHistoryService';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { scheduleService } from './ScheduleService';
import { taskRepository } from '../database/TaskRepository';
import { baselineService } from './BaselineService';
import { scheduleRecomputeService, planReflow, type DateDelta } from './ScheduleRecomputeService';
import { scheduleReviewService, toReviewTask as toFullReviewTask } from './ScheduleReviewService';
import { claudeService } from './claudeService';
import { config } from '../config';
import { AILearningServiceV2 } from './aiLearningService';
import { auditLedgerService } from './AuditLedgerService';
import logger from '../utils/logger';
import { groupBy } from '../utils/groupBy';
import { type IsWorking, weekdaysOnly, calendarDaysBetween } from '../utils/workingDays';
import {
  proposeFixesDeterministic,
  buildGroupingFixes,
  buildSplitFixes,
  buildPhaseFixes,
  splitCandidates,
  planSplitDates,
  withSeverity,
  unaddressedFindings,
  problemsOf,
  type ProposedFix, type FixSeverity, describeFix } from './scheduleReview/fixProposer';
import { applyFixesInMemory, latestFinish, rollUpSummaries, PlanCopy, milestoneUpdate, splitHeadValues, splitPartValues } from './scheduleReview/fixPreview';
import { RULES_VERSION, findMissingPhases, PRE_REVIEW_BASELINE_NAME, reviewSchedule, linksDatesBreak, type ReviewTask, type ReviewInput } from './scheduleReview/rules';
import { companyCacheKey } from '../utils/companyCacheKey';
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
  /** The project's own end date — the panel warns when the finish passes it */
  projectEnd: string | null;
  warning: string | null;
  dateDeltas: DateDelta[];
  /** What the review still finds after the fixes, by level (info counted as low) */
  afterCounts: Record<FixSeverity, number>;
}

interface PreviewResult {
  tasksMoved: number;
  /** The most any one task moves, in calendar days (U61) */
  maxShiftDays: number;
  /** Links the plan's own dates already break (R41): Apply makes the dates follow them too */
  brokenLinks: number;
  /** One of them, to name in the warning */
  brokenExample: { task: string; waitsFor: string } | null;
  /** The tasks that move, the furthest first (at most MAX_PREVIEW_MOVES) */
  moves: Array<{ name: string; finishBefore: string | null; finishAfter: string; days: number }>;
  /** The plan's last finish now, and after Apply would re-flow it (YYYY-MM-DD) */
  finishBefore: string | null;
  finishAfter: string | null;
  finishShiftDays: number;
  /** The project's own end date, to warn when the finish passes it */
  projectEnd: string | null;
  scoreBefore: number;
  scoreAfter: number;
}

/** How long a preview reuses what the review read for its proposal, and how many proposals it keeps */
const PREVIEW_BASE_TTL_MS = 5 * 60_000;

/** Most moved tasks a preview lists (the count says how many in all) */
const MAX_PREVIEW_MOVES = 50;

/** What would move, by how far each finish moves (calendar days), the furthest first */
function movesList(deltas: DateDelta[]): PreviewResult['moves'] {
  return deltas
    .map(d => ({
      name: d.name,
      finishBefore: d.oldEnd ? d.oldEnd.slice(0, 10) : null,
      finishAfter: d.newEnd.slice(0, 10),
      days: d.oldEnd ? calendarDaysBetween(d.oldEnd.slice(0, 10), d.newEnd.slice(0, 10)) : 0,
    }))
    .sort((a, b) => Math.abs(b.days) - Math.abs(a.days))
    .slice(0, MAX_PREVIEW_MOVES);
}
const PREVIEW_BASE_MAX = 200;

/** The ticked fixes, in proposal order; a rename takes the name the PM typed, when they changed it */
function chosenFixes(all: ProposedFix[], fixIds: string[], names: Record<string, string>): ProposedFix[] {
  const selected = new Set(fixIds);
  return all
    .filter(f => selected.has(f.id))
    .map(f => (f.type === 'rename_task' && names[f.id] ? { ...f, newName: names[f.id] } : f));
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
    const project = await projectService.findById(schedule.projectId).catch(() => null);
    const projectEnd = project?.endDate ? String(project.endDate).slice(0, 10) : null;
    let fixes: ProposedFix[] = proposeFixesDeterministic(review.findings, tasks, await this.workingDayTest(scheduleId), new Date(), projectEnd);
    let source: 'ai' | 'rules' = 'rules';
    if (useAi && config.AI_ENABLED && claudeService.isAvailable() && leafCount <= 80) {
      try {
        const ai = await this.aiSuggestions(schedule.projectId, project, tasks, userId);
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

    // Each fix carries the level of the finding it answers — the panel groups by it
    fixes = withSeverity(fixes, review.findings);

    await scheduleFixProposalRepository.supersedePending(scheduleId);

    return scheduleFixProposalRepository.insert({
      id: randomUUID(),
      scheduleId,
      projectId: schedule.projectId,
      status: 'pending',
      source,
      reviewId: review.id,
      // What no fix answers is listed for the PM to decide ("Needs your decision")
      proposalData: { fixes, problems: problemsOf(fixes, review.findings), needsDecision: unaddressedFindings(fixes, review.findings) },
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
  private async aiSuggestions(projectId: string, project: Awaited<ReturnType<typeof projectService.findById>>, tasks: ReviewTask[], userId: string | null): Promise<{ groupings: ProposedFix[]; splits: ProposedFix[]; phases: ProposedFix[] }> {
    // Loose top-level tasks get grouped even when the plan already has some phases (a partly
    // organised plan, e.g. a contract import with a few headings); existing phases are offered.
    const hasKids = new Set(tasks.map(t => t.parentTaskId).filter(Boolean) as string[]);
    const groupCandidates = tasks.filter(t => !t.isSummary && !t.parentTaskId && !hasKids.has(t.id));
    const existingPhases = tasks.filter(t => !t.parentTaskId && (t.isSummary || hasKids.has(t.id)));
    const wantGroups = groupCandidates.length >= 6;
    const splitCands = splitCandidates(tasks);

    const sprints = await sprintService.getByProject(projectId).catch(() => []);
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
  async apply(scheduleId: string, proposalId: string, fixIds: string[], userId: string | null, names: Record<string, string> = {}): Promise<ApplyResult> {
    const proposal = await scheduleFixProposalRepository.findById(proposalId);
    if (!proposal || proposal.scheduleId !== scheduleId) throw new ScheduleFixNotFoundError(proposalId);
    if (proposal.status !== 'pending') throw new ScheduleFixStateError(`Proposal is ${proposal.status}, not pending`);

    const fixes = chosenFixes(proposal.proposalData.fixes, fixIds, names);
    const skipped: Array<{ fixId: string; reason: string }> = [];

    const before = await scheduleReviewService.latest(scheduleId);
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const project = await projectService.findById(proposal.projectId).catch(() => null);
    // Dates the fixes pick land on working days of the project calendar
    const isWorking = await this.workingDayTest(scheduleId);
    // The plan as each step leaves it: later steps read the links and fields earlier ones changed
    // (a buffer in front of a gate linked in step 1; a split of a task that just got a link). The
    // preview runs the same steps on the same copy (scheduleReview/fixPreview.ts).
    const plan = new PlanCopy(tasks, isWorking);
    const taskById = plan.byId;

    // Snapshot before touching anything, so the PM can fall back to it.
    let baselineId: string | null = null;
    try {
      const baseline = await baselineService.create(scheduleId, PRE_REVIEW_BASELINE_NAME, userId ?? 'system');
      baselineId = baseline.id;
    } catch (err: any) {
      logger.warn('[ScheduleFix] pre-review baseline failed', { scheduleId, error: err?.message });
    }

    const applied: AppliedAction[] = [];
    let appliedCount = 0;
    // The fixes of each kind, in the order they were proposed
    const fixesOfType = groupBy(fixes, f => f.type);
    const ofType = (type: ProposedFix['type']) => fixesOfType.get(type) ?? [];
    /** Save a link and keep the copy in step */
    const addLink = async (taskId: string, depId: string, type: 'FS' | 'SS' | 'FF' | 'SF' = 'FS', lag = 0) => {
      await scheduleService.addDependency(taskId, depId, type, lag);
      plan.link(taskId, depId, type, lag);
    };
    const removeLink = async (taskId: string, depId: string) => {
      await scheduleService.removeDependency(taskId, depId);
      plan.unlink(taskId, depId);
    };

    /* eslint-disable no-await-in-loop -- fixes apply one by one, in order: each is logged for undo and the cycle/duplicate checks see the links earlier fixes added */
    // 1) dependencies — a duplicate or a loop is skipped, as the preview skips it
    for (const f of ofType('add_dependency')) {
      if (!plan.canLink(f.taskId!, f.dependsOnTaskId!)) { skipped.push({ fixId: f.id, reason: 'already linked, or the link would make a loop' }); continue; }
      try {
        await addLink(f.taskId!, f.dependsOnTaskId!, f.dependencyType ?? 'FS', f.lagDays ?? 0);
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
      try {
        await scheduleService.updateTask(f.taskId!, milestoneUpdate(t) as any);
        plan.update(f.taskId, milestoneUpdate(t));
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
            plan.add({ name: f.newParentName, isSummary: true }, parentId);
            parentIdByName.set(f.newParentName, parentId);
            // Delete the created parent LAST on undo (recorded before its children's restore_parent).
            applied.push({ op: 'delete_task', taskId: parentId });
          }
        }
        if (!parentId) { skipped.push({ fixId: f.id, reason: 'no parent target' }); continue; }
        const old = taskById.get(f.taskId!)?.parentTaskId ?? null;
        await scheduleService.updateTask(f.taskId!, { parentTaskId: parentId });
        plan.update(f.taskId, { parentTaskId: parentId });
        plan.update(parentId, { isSummary: true });
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
        plan.update(f.taskId, { estimatedDays: f.newDuration });
        applied.push({ op: 'restore_duration', taskId: f.taskId!, oldValue: old });
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not set duration' });
      }
    }

    // 5) buffers — insert a protective task between a gate and its predecessors (its links as
    // they are now, including any step 1 added). Rewire: preds → buffer → gate. Record
    // readd_dependency so undo restores the gate's original links, plus delete_task for the buffer.
    for (const f of ofType('insert_buffer')) {
      try {
        const gate = taskById.get(f.gateTaskId!);
        if (!gate) { skipped.push({ fixId: f.id, reason: 'gate not found' }); continue; }
        const shape = plan.bufferFor(f);
        if (!shape) { skipped.push({ fixId: f.id, reason: 'gate has no predecessor to buffer' }); continue; }
        const preds = gate.dependencies.map(d => ({ id: d.dependencyId, type: (d.dependencyType || 'FS') as 'FS' | 'SS' | 'FF' | 'SF', lag: d.lagDays ?? 0 }));
        const buffer = await scheduleService.createTask({
          scheduleId,
          name: shape.name,
          parentTaskId: shape.parentTaskId ?? undefined, // in the gate's own phase, not loose at the end of the plan
          estimatedDays: shape.estimatedDays,
          startDate: shape.startDate,
          endDate: shape.endDate,
          createdBy: userId ?? 'system',
        });
        plan.add({ ...shape, dependencies: [] }, buffer.id);
        applied.push({ op: 'delete_task', taskId: buffer.id });

        // Move the gate's incoming links onto the buffer.
        for (const p of preds) {
          await addLink(buffer.id, p.id, p.type, p.lag);
          await removeLink(f.gateTaskId!, p.id);
          applied.push({ op: 'readd_dependency', taskId: f.gateTaskId!, dependencyId: p.id, dependencyType: p.type, lagDays: p.lag });
        }
        // Gate now depends on the buffer.
        await addLink(f.gateTaskId!, buffer.id, 'FS', 0);
        applied.push({ op: 'remove_dependency', taskId: f.gateTaskId!, dependencyId: buffer.id });
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not insert buffer' });
      }
    }

    // 6) splits — the bundled task becomes a summary over its parts, linked in order, with
    // the task's own dates shared across them. Its links move onto the parts (a summary
    // shouldn't carry links — R29): predecessors to the first part, successors off the last —
    // its links as they are now, so one step 1 added moves too.
    const parentIds = new Set(tasks.map(x => x.parentTaskId).filter(Boolean)); // who had tasks under it before the fixes
    for (const f of ofType('split_task')) {
      try {
        const t = taskById.get(f.taskId!);
        if (!t || !t.startDate || !t.endDate || !f.parts?.length) { skipped.push({ fixId: f.id, reason: 'task not found or has no dates' }); continue; }
        if (parentIds.has(t.id)) { skipped.push({ fixId: f.id, reason: 'task already has tasks under it' }); continue; }
        // Who waits on it now (earlier splits may have moved links onto it) — before its own parts link to it
        const waiting = plan.successorsOf(t.id);
        const planned = planSplitDates(String(t.startDate), String(t.endDate), f.parts, isWorking);
        const created: string[] = [];
        // Replace (a milestone-named line): the task itself becomes the first part, so its
        // row, predecessors and history stay; the other parts follow it at the same level.
        let toCreate = planned;
        let after = t.id;
        if (f.replace) {
          const [head, ...rest] = planned;
          applied.push({
            op: 'restore_task', taskId: t.id,
            oldValue: { name: t.name, isMilestone: !!t.isMilestone, estimatedDays: t.estimatedDays ?? null, startDate: String(t.startDate).slice(0, 10), endDate: String(t.endDate).slice(0, 10) },
          });
          const headValues = splitHeadValues(head);
          await scheduleService.updateTask(t.id, headValues as any);
          plan.update(t.id, headValues);
          created.push(t.id);
          toCreate = rest;
        }
        for (const part of toCreate) {
          const values = splitPartValues(t, part, !!f.replace);
          const child = await scheduleService.createTask({
            scheduleId,
            ...values,
            parentTaskId: values.parentTaskId || undefined,
            afterTaskId: after,
            assignedTo: t.assignedTo || undefined,
            priority: t.priority,
            createdBy: userId ?? 'system',
          } as any);
          plan.add(values, child.id);
          applied.push({ op: 'delete_task', taskId: child.id }); // undo removes parts (and their links)
          created.push(child.id);
          after = child.id;
        }
        if (!f.replace) plan.update(t.id, { isSummary: true });
        // A milestone part (approval, sign-off) happens the day the work before it finishes,
        // so that link is finish-to-finish; finish-to-start would push it a day later and
        // stretch the summary past the task's own end.
        for (let i = 1; i < created.length; i++) {
          await addLink(created[i], created[i - 1], planned[i].isMilestone ? 'FF' : 'FS', 0);
        }
        const first = created[0];
        const last = created[created.length - 1];
        for (const d of f.replace ? [] : [...t.dependencies]) { // replaced: the task is the first part and keeps them
          const type = (d.dependencyType || 'FS') as 'FS' | 'SS' | 'FF' | 'SF';
          await addLink(first, d.dependencyId, type, d.lagDays ?? 0);
          await removeLink(t.id, d.dependencyId);
          applied.push({ op: 'readd_dependency', taskId: t.id, dependencyId: d.dependencyId, dependencyType: type, lagDays: d.lagDays ?? 0 });
        }
        for (const succ of waiting) {
          // eslint-disable-next-line no-restricted-syntax -- small: one task's own links (each read once)
          const d = succ.dependencies.find(dd => dd.dependencyId === t.id);
          if (!d) continue;
          const type = (d.dependencyType || 'FS') as 'FS' | 'SS' | 'FF' | 'SF';
          await addLink(succ.id, last, type, d.lagDays ?? 0);
          await removeLink(succ.id, t.id);
          applied.push({ op: 'readd_dependency', taskId: succ.id, dependencyId: t.id, dependencyType: type, lagDays: d.lagDays ?? 0 });
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
        const shape = plan.phaseTaskFor(f);
        const created = await scheduleService.createTask({
          scheduleId,
          name: shape.name,
          afterTaskId: f.afterTaskId && taskById.has(f.afterTaskId) ? f.afterTaskId : undefined,
          parentTaskId: shape.parentTaskId || undefined,
          startDate: shape.startDate,
          endDate: shape.endDate,
          estimatedDays: shape.estimatedDays,
          createdBy: userId ?? 'system',
        } as any);
        plan.add(shape, created.id);
        applied.push({ op: 'delete_task', taskId: created.id }); // undo removes it and its links
        if (f.afterTaskId && taskById.has(f.afterTaskId)) await addLink(created.id, f.afterTaskId, 'FS', 0);
        if (f.beforeTaskId && plan.canLink(f.beforeTaskId, created.id)) {
          await addLink(f.beforeTaskId, created.id, 'FS', 0).catch(() => { /* would loop — leave it unlinked */ });
        }
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not add phase task' });
      }
    }
    // 8) renames — a heading's name only; its dates never move
    for (const f of ofType('rename_task')) {
      const t = taskById.get(f.taskId!);
      if (!t || !f.newName) { skipped.push({ fixId: f.id, reason: 'task not found or no new name' }); continue; }
      try {
        const oldName = t.name;
        await scheduleService.updateTask(t.id, { name: f.newName });
        plan.update(t.id, { name: f.newName });
        applied.push({ op: 'restore_name', taskId: t.id, oldValue: oldName });
        appliedCount++;
      } catch (err: any) {
        skipped.push({ fixId: f.id, reason: err?.message || 'could not rename task' });
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
    // The finish before is the plan's before any fix (as the preview reports it): the re-flow only
    // sees the plan after the fixes, with the tasks they added
    const finishBefore = latestFinish(tasks);
    const finishAfter = recompute.projectEndAfter ?? finishBefore;
    const finishShiftDays = finishBefore && finishAfter ? calendarDaysBetween(finishBefore, finishAfter) : 0;
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
      payload: { proposalId, appliedCount, beforeScore: before?.score ?? null, afterScore: after.score, actions: applied, skipped, baselineId, datesMoved: recompute.tasksMoved, projectEndShiftDays: finishShiftDays },
      source: getActorSource(),
    }).catch(err => logger.warn('[ScheduleFix] audit append (apply) failed', { proposalId, error: err?.message }));

    return {
      beforeScore: before?.score ?? null,
      afterScore: after.score,
      appliedCount,
      skipped,
      datesMoved: recompute.tasksMoved,
      projectEndBefore: finishBefore,
      projectEndAfter: finishAfter,
      projectEndShiftDays: finishShiftDays,
      projectEnd: project?.endDate ? String(project.endDate).slice(0, 10) : null,
      warning,
      dateDeltas: recompute.deltas.slice(0, 50),
      afterCounts: {
        critical: after.counts?.critical ?? 0,
        high: after.counts?.high ?? 0,
        medium: after.counts?.medium ?? 0,
        low: (after.counts?.low ?? 0) + (after.counts?.info ?? 0),
      },
    };
  }

  /**
   * What Apply would do to the dates and the score, without saving anything (2026-10-18: a
   * "Select all in Critical" pushed a finish out eight months with no warning). The ticked fixes
   * are applied to an in-memory copy, the same forward pass as Apply re-flows it, and the rules
   * score the result — with float and over-allocation as the plan stands now, so the score after
   * is an estimate; Apply's own re-run is the real one.
   */
  async preview(scheduleId: string, proposalId: string, fixIds: string[], names: Record<string, string> = {}): Promise<PreviewResult> {
    const proposal = await scheduleFixProposalRepository.findById(proposalId);
    if (!proposal || proposal.scheduleId !== scheduleId) throw new ScheduleFixNotFoundError(proposalId);
    if (proposal.status !== 'pending') throw new ScheduleFixStateError(`Proposal is ${proposal.status}, not pending`);

    const fixes = chosenFixes(proposal.proposalData.fixes, fixIds, names);
    // Float, over-allocation, baselines, resources, calendar and the score now: read once per
    // proposal (the panel asks on every tick). Each preview then reads only the tasks.
    const base = await this.previewBase(scheduleId, proposalId);
    const { input } = base;
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const isWorking = input.isWorking ?? weekdaysOnly;

    const changed = applyFixesInMemory(tasks, fixes, isWorking);
    const flow = planReflow(changed, isWorking);
    const moved = new Map(flow.deltas.map(d => [d.taskId, d]));
    const after = rollUpSummaries(changed.map(t => {
      const d = moved.get(t.id);
      return d ? { ...t, startDate: d.newStart, endDate: d.newEnd } : t;
    }));

    const finishBefore = latestFinish(tasks);
    const finishAfter = flow.projectEndAfter;
    const broken = linksDatesBreak(tasks.map(toFullReviewTask));
    const moves = movesList(flow.deltas);
    return {
      tasksMoved: flow.tasksMoved,
      // how far a finish moves, as the result table shows it
      maxShiftDays: moves.reduce((m, x) => Math.max(m, Math.abs(x.days)), 0),
      brokenLinks: broken.length,
      brokenExample: broken[0] ? { task: broken[0].task.name, waitsFor: broken[0].waitsFor.name } : null,
      moves,
      finishBefore,
      finishAfter,
      finishShiftDays: finishBefore && finishAfter ? calendarDaysBetween(finishBefore, finishAfter) : 0,
      projectEnd: input.project?.endDate ? String(input.project.endDate).slice(0, 10) : null,
      scoreBefore: base.scoreBefore,
      scoreAfter: reviewSchedule({ ...input, tasks: after.map(toFullReviewTask) }).score,
    };
  }

  /** In-process (it holds the float map and the calendar test), per company and proposal, a few minutes */
  private previewBases = new Map<string, { at: number; base: { input: ReviewInput; scoreBefore: number } }>();

  /** Loads under way, so previews sent while one is loading share it (U52, 2026-10-20: each tick
   *  change could start its own full read of the plan's inputs at the same time) */
  private previewLoads = new Map<string, Promise<{ input: ReviewInput; scoreBefore: number }>>();

  private async previewBase(scheduleId: string, proposalId: string): Promise<{ input: ReviewInput; scoreBefore: number }> {
    const key = companyCacheKey(`schedule-fix-preview:${proposalId}`);
    const hit = this.previewBases.get(key);
    if (hit && Date.now() - hit.at < PREVIEW_BASE_TTL_MS) return hit.base;
    const loading = this.previewLoads.get(key);
    if (loading) return loading;
    const load = this.loadPreviewBase(key, scheduleId).finally(() => this.previewLoads.delete(key));
    this.previewLoads.set(key, load);
    return load;
  }

  private async loadPreviewBase(key: string, scheduleId: string): Promise<{ input: ReviewInput; scoreBefore: number }> {
    const { input } = await scheduleReviewService.gatherInput(scheduleId);
    // Kept without the tasks: each preview reads them fresh, and a big plan's list is the bulk of it
    const base = { input: { ...input, tasks: [] }, scoreBefore: reviewSchedule(input).score };
    const now = Date.now();
    this.previewBases.delete(key);
    // Bounded: expired entries go, then the oldest past the cap (a Map keeps insertion order)
    for (const [k, v] of this.previewBases) if (now - v.at >= PREVIEW_BASE_TTL_MS) this.previewBases.delete(k);
    for (const k of this.previewBases.keys()) {
      if (this.previewBases.size < PREVIEW_BASE_MAX) break;
      this.previewBases.delete(k);
    }
    this.previewBases.set(key, { at: now, base });
    return base;
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
          case 'restore_name':
            await scheduleService.updateTask(action.taskId!, { name: action.oldValue as string });
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
          // A phase's length is worked out from its tasks and is not part of its dates: write it back in the same batch, or
          // Undo leaves "44 days" on a phase whose dates are back to 15 (found by QA on staging, 2026-10-24)
          ...(bt.estimatedDays != null ? { estimatedDays: bt.estimatedDays } : {}),
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
