import { randomUUID } from 'crypto';
import { databaseService } from '../../database/connection';
import { riskRepository } from '../../database/RiskRepository';
import { approvalWorkflowRepository } from '../../database/ApprovalWorkflowRepository';
import type { WeeklyFacts, WeeklyItem } from '../weeklyReview/picker';
import type { AiSuggestion } from '../../database/AiSuggestionRepository';
import { autoRescheduleService } from '../AutoRescheduleService';
import { teamPlannerService, type MoveInput } from '../TeamPlannerService';
import { scheduleFixProposerService } from '../ScheduleFixProposerService';
import { scheduleService } from '../ScheduleService';
import { outsidePool } from '../poolFit';
import { userService } from '../UserService';
import { getTenantContext } from '../../middleware/requestContext';
import { isUndeliverableEmail } from '../../utils/placeholderEmail';
import { shiftWorking, utcDay, ymdOf } from '../../utils/workingDays';
import { formatDay } from './format';
import logger from '../../utils/logger';

/**
 * The Weekly review agent (Phase 2 step 1): turns what the Weekly PM review found into ready-made
 * fixes for the AI inbox. Rules only, no AI: each fix is built by the feature that already does that
 * job (AI Reschedule, the Team Planner, Schedule Review's fixes, the RAID log), so Accept runs that
 * feature's own tested change with its own Undo. It never changes anything itself.
 */
export const WEEKLY_AGENT = 'weekly_review';

type Draft = Omit<AiSuggestion, 'status' | 'reason' | 'resultSummary' | 'undoRef' | 'decidedBy' | 'decidedAt' | 'createdAt'>;

interface Ctx {
  projectId: string;
  projectName: string;
  reviewId: string;
  items: WeeklyItem[];
  facts: WeeklyFacts;
  /** the PM the suggestions are for (drafts are signed by them, actions are theirs) */
  pm: { id: string; name: string; email: string | null };
}

/** at most this many of one kind per project and week — the inbox is for decisions, not a backlog */
const PER_KIND = 3;

const draft = (ctx: Ctx, d: Omit<Draft, 'id' | 'projectId' | 'agent' | 'reviewId'>): Draft =>
  ({ id: randomUUID(), projectId: ctx.projectId, agent: WEEKLY_AGENT, reviewId: ctx.reviewId, ...d });

/** Each builder is on its own: one that fails is logged and skipped, the others still run */
async function each<T>(what: string, ctx: Ctx, fn: () => Promise<T[]>): Promise<T[]> {
  try { return await fn(); } catch (err: any) {
    logger.warn(`[AiInbox] ${what} skipped`, { projectId: ctx.projectId, error: err?.message });
    return [];
  }
}

export async function buildWeeklySuggestions(ctx: Ctx): Promise<Draft[]> {
  // one after another: the Friday job already runs several projects' reviews at once
  const builders: Array<[string, (c: Ctx) => Promise<Draft[]>]> = [
    ['reschedule', reschedule], ['rebalance', rebalance], ['links', links],
    ['mitigations', mitigations], ['RAID reminders', raidReminders], ['change request reminders', crReminders],
  ];
  const out: Draft[] = [];
  for (const [what, build] of builders) {
    // eslint-disable-next-line no-await-in-loop -- six builders, on purpose not in parallel
    out.push(...await each(what, ctx, () => build(ctx)));
  }
  return out;
}

// ── Late chains → AI Reschedule's plan (rules-based) ─────────────────────────────────────────────
async function reschedule(ctx: Ctx): Promise<Draft[]> {
  const late = ctx.items.filter(i => (i.kind === 'finish_at_risk' || i.kind === 'task_late') && i.refs?.scheduleId);
  const bySchedule = new Map<string, WeeklyItem[]>();
  for (const i of late) bySchedule.set(i.refs!.scheduleId!, [...(bySchedule.get(i.refs!.scheduleId!) ?? []), i]);
  const out: Draft[] = [];
  for (const [scheduleId, items] of bySchedule) {
    // eslint-disable-next-line no-await-in-loop -- one per plan of the project (usually one)
    const p = await autoRescheduleService.generateProposal(scheduleId, undefined, 'agent', { useAi: false });
    if (p.proposedChanges.length === 0) {
      // eslint-disable-next-line no-await-in-loop -- one per plan; nothing to move: don't leave an open proposal behind
      await autoRescheduleService.rejectProposal(p.id, 'Nothing to move').catch(() => false);
      continue;
    }
    const n = p.proposedChanges.length;
    const shift = p.estimatedImpact.daysChange;
    out.push(draft(ctx, {
      scheduleId, kind: 'reschedule', itemKey: `reschedule:${scheduleId}`,
      title: `Move ${n} late task${n === 1 ? '' : 's'} so the plan matches reality`,
      detail: shift > 0
        ? `Finish moves ${formatDay(p.estimatedImpact.originalEndDate)} → ${formatDay(p.estimatedImpact.proposedEndDate)} (${shift} working day${shift === 1 ? '' : 's'} later)`
        : 'The project finish date does not change',
      payload: {
        rescheduleProposalId: p.id,
        reviewKeys: items.map(i => i.key),
        changes: p.proposedChanges.slice(0, 25).map(c => ({ taskId: c.taskId, name: c.taskName, startBefore: c.currentStartDate, startAfter: c.proposedStartDate, endBefore: c.currentEndDate, endAfter: c.proposedEndDate })),
        more: Math.max(0, n - 25),
        finishBefore: p.estimatedImpact.originalEndDate, finishAfter: p.estimatedImpact.proposedEndDate,
      },
      evidence: [...items.flatMap(i => i.facts).slice(0, 6), 'Dates count working days on the project calendar.'],
      measure: Math.max(...items.map(i => i.measure)),
    }));
  }
  return out;
}

// ── An overloaded person → give one task to a same-role colleague with room ──────────────────────
async function rebalance(ctx: Ctx): Promise<Draft[]> {
  const items = ctx.items.filter(i => i.kind === 'overloaded' && i.refs?.resourceId).slice(0, 2);
  const overloadOf = new Map(ctx.facts.overloads.map(o => [o.resourceId, o]));
  const out: Draft[] = [];
  for (const item of items) {
    const fromId = item.refs!.resourceId!;
    const over = overloadOf.get(fromId);
    const week = over?.weeks[0];
    if (!week) continue;
    const weekEnd = ymdOf(shiftWorking(utcDay(week.weekStart), 4, d => d.getUTCDay() !== 0 && d.getUTCDay() !== 6));
    // eslint-disable-next-line no-await-in-loop -- at most PER_KIND people a week
    const tasks = await databaseService.query<{ id: string; name: string; schedule_id: string; start_date: string; end_date: string }>(
      `SELECT t.id, t.name, t.schedule_id, t.start_date, t.end_date
         FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN schedules s ON s.id = t.schedule_id
        WHERE a.resource_id = ? AND s.project_id = ? AND COALESCE(t.is_summary, 0) = 0 AND COALESCE(t.is_milestone, 0) = 0
          AND t.status NOT IN ('completed', 'cancelled') AND t.start_date <= ? AND t.end_date >= ?
        ORDER BY DATEDIFF(t.end_date, t.start_date) ASC LIMIT 5`,
      [fromId, ctx.projectId, weekEnd, week.weekStart]);
    if (tasks.length === 0) continue;
    // eslint-disable-next-line no-await-in-loop -- one person's role, once
    const [from] = await databaseService.query<{ name: string; role: string }>('SELECT name, role FROM resources WHERE id = ?', [fromId]);
    if (!from?.role) continue;
    // eslint-disable-next-line no-await-in-loop -- once per overloaded person
    const people = await databaseService.query<{ id: string; name: string }>(
      `SELECT r.id, r.name FROM resources r
         LEFT JOIN task_assignments a ON a.resource_id = r.id
         LEFT JOIN tasks t ON t.id = a.task_id AND t.status NOT IN ('completed', 'cancelled') AND t.start_date <= ? AND t.end_date >= ?
        WHERE r.is_active = 1 AND COALESCE(r.is_generic, 0) = 0 AND r.role = ? AND r.id <> ?
        GROUP BY r.id, r.name ORDER BY COUNT(t.id), r.name LIMIT 12`,
      [weekEnd, week.weekStart, from.role, fromId]);
    // eslint-disable-next-line no-await-in-loop -- one pool check for the whole list
    const outside = await outsidePool(people.map(p => p.id), tasks[0].schedule_id);
    // eslint-disable-next-line no-restricted-syntax -- small: at most 12 people, Set look-up
    const candidates = people.filter(p => !outside.has(p.id));
    let found: { input: MoveInput; preview: Awaited<ReturnType<typeof teamPlannerService.preview>>; to: { id: string; name: string }; task: typeof tasks[number] } | null = null;
    for (const task of tasks.slice(0, 1)) {
      for (const to of candidates.slice(0, 4)) {
        const input: MoveInput = { taskId: task.id, fromResourceId: fromId, toResourceId: to.id, weeks: 0 };
        // eslint-disable-next-line no-await-in-loop -- at most 2 tasks × 6 people, stops at the first that fits
        const preview = await teamPlannerService.preview(input);
        if (preview.overloads.length === 0) { found = { input, preview, to, task }; break; }
      }
      if (found) break;
    }
    if (!found) continue;
    // eslint-disable-next-line no-restricted-syntax -- small: the move's two people and their few weeks
    const loadOf = (id: string) => found!.preview.load.find(l => l.resourceId === id)?.weeks.find(w => w.weekStart === week.weekStart);
    const a = loadOf(fromId); const b = loadOf(found.to.id);
    const pct = (h?: number, c?: number) => (h != null && c ? `${Math.round((h / c) * 100)}%` : '');
    out.push(draft(ctx, {
      scheduleId: found.task.schedule_id, kind: 'reassign', itemKey: `reassign:${fromId}`,
      title: `Give "${found.task.name}" to ${found.to.name} — ${from.name} is overbooked`,
      detail: `${from.name} is booked ${pct(week.allocated, week.capacity)} the week of ${formatDay(week.weekStart)}; ${found.to.name} has the same role and room.`,
      payload: {
        move: found.input, reviewKeys: [item.key], taskName: found.task.name, fromName: from.name, toName: found.to.name,
        weekStart: week.weekStart,
        after: { from: pct(a?.after, a?.capacity), to: pct(b?.after, b?.capacity) },
      },
      evidence: [...item.facts.slice(0, 3), `${found.to.name}: same role (${from.role}), same client pool, under capacity that week after the move.`],
      measure: item.measure,
    }));
  }
  return out;
}

// ── Plan quality → link the tasks that have nothing before or after them ─────────────────────────
async function links(ctx: Ctx): Promise<Draft[]> {
  const items = ctx.items.filter(i => i.kind === 'plan_quality' && i.refs?.scheduleId);
  const out: Draft[] = [];
  for (const item of items) {
    const scheduleId = item.refs!.scheduleId!;
    // A pending proposal for the plan (perhaps one the PM made) is used as it is — proposing again would
    // replace it. Only when there is none does the agent ask for one.
    // eslint-disable-next-line no-await-in-loop -- one per plan of the project
    const pending = await scheduleFixProposerService.getLatest(scheduleId);
    // eslint-disable-next-line no-await-in-loop -- one per plan of the project, only when none is pending
    const proposal = pending?.status === 'pending' ? pending : await scheduleFixProposerService.propose(scheduleId, null, false);
    // eslint-disable-next-line no-restricted-syntax -- small: one proposal's fixes, read once
    const fixes = ((proposal.proposalData as any)?.fixes ?? []).filter((f: any) => f.type === 'add_dependency' && f.defaultChecked);
    if (fixes.length === 0) continue;
    out.push(draft(ctx, {
      scheduleId, kind: 'add_links', itemKey: `links:${scheduleId}`,
      title: `Link ${fixes.length} task${fixes.length === 1 ? ' that has' : 's that have'} nothing before or after them`,
      detail: 'A linked plan moves by itself when something slips, and its critical path is real.',
      payload: {
        scheduleId, proposalId: proposal.id, fixIds: fixes.map((f: any) => f.id), reviewKeys: [item.key],
        links: fixes.slice(0, 25).map((f: any) => ({ task: f.taskName, after: f.dependsOnTaskName, type: f.dependencyType ?? 'FS' })),
        more: Math.max(0, fixes.length - 25),
      },
      evidence: item.facts.slice(0, 4),
      measure: item.measure,
    }));
  }
  return out;
}

// ── A high risk with no response → an action to decide it, linked to the risk ────────────────────
async function mitigations(ctx: Ctx): Promise<Draft[]> {
  if (!ctx.items.some(i => i.kind === 'risks_unhandled')) return [];
  // a risk that already has an open action linked to it is being handled (an accepted suggestion, or the PM's own)
  const actions = await databaseService.query<{ linked_raid_ids: unknown }>(
    `SELECT linked_raid_ids FROM project_risks WHERE project_id = ? AND type = 'action' AND status NOT IN ('closed', 'resolved', 'cancelled', 'completed', 'reversed')
        AND linked_raid_ids IS NOT NULL LIMIT 500`, [ctx.projectId]);
  const handled = new Set(actions.flatMap(a => {
    try { const v = typeof a.linked_raid_ids === 'string' ? JSON.parse(a.linked_raid_ids) : a.linked_raid_ids; return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  }));
  const schedules = await scheduleService.findByProjectId(ctx.projectId);
  const isWorking = schedules[0] ? await scheduleService.workingDayTest(schedules[0].id) : (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
  const due = ymdOf(shiftWorking(utcDay(ctx.facts.asOf), 5, isWorking));
  return ctx.facts.raid.unhandled.filter(r => !handled.has(r.id)).slice(0, PER_KIND).map(r => draft(ctx, {
    scheduleId: null, kind: 'add_mitigation', itemKey: `mitigate:${r.id}`,
    title: `Add an action to handle the risk "${r.title}"`,
    detail: `High risk with ${r.why}.`,
    payload: {
      riskId: r.id, riskTitle: r.title, reviewKeys: ['risks-unhandled'],
      action: { title: `Decide the response to "${r.title}" and who owns it`, dueDate: due, ownerUserId: ctx.pm.id, ownerName: ctx.pm.name },
    },
    evidence: [`Risk "${r.title}": ${r.why}.`, 'The action is linked to the risk as its mitigation.'],
    measure: 1,
  }));
}

/** Where a RAID owner can be reached: a person record's email, or a login's (never a placeholder) */
async function ownerContact(item: { ownerId?: string | null; ownerResourceId?: string | null }): Promise<{ name: string; email: string; userId: string | null } | null> {
  if (item.ownerResourceId) {
    const [r] = await databaseService.query<{ name: string; email: string; user_id: string | null }>('SELECT name, email, user_id FROM resources WHERE id = ?', [item.ownerResourceId]);
    return r?.email && !isUndeliverableEmail(r.email) ? { name: r.name, email: r.email, userId: r.user_id ?? null } : null;
  }
  if (item.ownerId) {
    const u = await userService.findById(item.ownerId);
    return u?.email && !isUndeliverableEmail(u.email) ? { name: u.fullName || u.email, email: u.email, userId: u.id } : null;
  }
  return null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// ── An overdue RAID action → a reminder to its owner, drafted for the PM to send ──────────────────
async function raidReminders(ctx: Ctx): Promise<Draft[]> {
  if (!ctx.items.some(i => i.kind === 'raid_overdue')) return [];
  const out: Draft[] = [];
  for (const o of ctx.facts.raid.overdue.slice(0, PER_KIND * 2)) {
    if (out.length >= PER_KIND) break;
    // eslint-disable-next-line no-await-in-loop -- a handful of overdue items
    const item = await riskRepository.findById(o.id);
    if (!item) continue;
    // eslint-disable-next-line no-await-in-loop -- one owner each
    const owner = await ownerContact(item);
    if (!owner || owner.userId === ctx.pm.id) continue; // nobody to remind, or the PM themself
    const subject = `${ctx.projectName}: "${o.title}" was due ${formatDay(o.dueDate)}`;
    const body = `Hi ${firstName(owner.name)},\n\nCould you give me an update on "${o.title}"? It was due on ${formatDay(o.dueDate)} and it is still open on ${ctx.projectName}.\n\nThanks,\n${ctx.pm.name}`;
    out.push(draft(ctx, {
      scheduleId: null, kind: 'remind_raid', itemKey: `remind:${o.id}`,
      title: `Remind ${owner.name}: "${o.title}" is overdue`,
      detail: `Due ${formatDay(o.dueDate)}, still open.`,
      payload: { raidId: o.id, reviewKeys: ['raid-overdue'], to: [{ name: owner.name, email: owner.email }], subject, body, signedAs: ctx.pm.name },
      evidence: [`"${o.title}" was due ${formatDay(o.dueDate)} and is not closed.`, `Owner: ${owner.name}.`],
      measure: 1,
    }));
  }
  return out;
}

// ── A change request waiting on its approvers → a reminder to them ────────────────────────────────
async function crReminders(ctx: Ctx): Promise<Draft[]> {
  if (!ctx.items.some(i => i.kind === 'cr_waiting')) return [];
  const orgId = getTenantContext()?.orgId;
  if (!orgId) return [];
  const waiting = ctx.facts.changeRequests.filter(c => c.waitingDays >= 5).slice(0, 2);
  if (waiting.length === 0) return [];
  const workflows = await approvalWorkflowRepository.findByProject(ctx.projectId);
  const out: Draft[] = [];
  for (const c of waiting) {
    // eslint-disable-next-line no-await-in-loop -- at most 2 a week
    const cr = await approvalWorkflowRepository.findChangeRequestById(c.id);
    // eslint-disable-next-line no-restricted-syntax -- small: the project's few approval workflows, at most 2 requests
    const wf = cr ? workflows.find(w => w.id === (cr as any).workflowId) : null;
    // the pending step is by position, exactly as ApprovalWorkflowService reads it
    const step = wf && cr?.currentStep != null ? wf.steps[cr.currentStep] ?? null : null;
    if (!step?.approverRole) continue;
    // Who can act on it: someone with the step's role who manages this project, or the company PMO
    // (approving needs the manager role on the project, or PMO) — never people from unrelated projects
    // eslint-disable-next-line no-await-in-loop -- at most 2 requests
    const approvers = await approversFor(ctx, orgId, step.approverRole);
    if (approvers.length === 0) continue;
    const subject = `${ctx.projectName}: change request "${c.title}" is waiting for a decision`;
    const body = `Hi,\n\nThe change request "${c.title}" on ${ctx.projectName} has been waiting ${c.waitingDays} days for the "${step.name}" approval. Could you approve or reject it this week? It is in Kovarti under Change Requests.\n\nThanks,\n${ctx.pm.name}`;
    out.push(draft(ctx, {
      scheduleId: null, kind: 'remind_cr', itemKey: `remind-cr:${c.id}`,
      title: `Remind the approvers: "${c.title}" has waited ${c.waitingDays} days`,
      detail: `Waiting on the "${step.name}" step.`,
      payload: { crId: c.id, reviewKeys: ['cr-waiting'], to: approvers.map(a => ({ name: a.full_name || a.email, email: a.email })), subject, body, signedAs: ctx.pm.name },
      evidence: [`Raised ${c.waitingDays} days ago, still pending.`, `Approvers for "${step.name}": ${approvers.map(a => a.full_name || a.email).join(', ')}.`],
      measure: c.waitingDays,
    }));
  }
  return out;
}

/** People with this role who can approve on the project (its owners/managers), plus the company's PMO */
async function approversFor(ctx: Ctx, orgId: string, role: string): Promise<Array<{ id: string; email: string; full_name: string | null }>> {
  const members = await databaseService.query<{ user_id: string }>(
    `SELECT user_id FROM project_members WHERE project_id = ? AND role IN ('owner', 'manager') LIMIT 50`, [ctx.projectId]);
  const ids = members.map(m => m.user_id);
  const rows = await databaseService.queryControlPlane<{ id: string; email: string; full_name: string | null }>(
    `SELECT id, email, full_name FROM users
      WHERE organization_id = ? AND is_active = 1
        AND (role = 'pmo' OR (role = ?${ids.length ? ` AND id IN (${ids.map(() => '?').join(',')})` : ' AND 1 = 0'}))
      ORDER BY role = ? DESC, full_name LIMIT 5`,
    [orgId, role, ...ids, role]);
  return rows.filter(u => u.email && !isUndeliverableEmail(u.email) && u.id !== ctx.pm.id);
}

/** The tasks of a schedule still exist and are the project's (a suggestion may be days old) */
export async function scheduleOfProject(scheduleId: string, projectId: string): Promise<boolean> {
  const s = await scheduleService.findById(scheduleId);
  return !!s && s.projectId === projectId;
}
