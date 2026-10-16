import { databaseService } from '../../database/connection';
import { aiSuggestionRepository, type AiSuggestion, type SuggestionStatus } from '../../database/AiSuggestionRepository';
import { riskRepository } from '../../database/RiskRepository';
import type { WeeklyReviewRow } from '../../database/WeeklyReviewRepository';
import { checkProjectRoleFor } from '../../middleware/requireProjectAccess';
import { autoRescheduleService, StaleProposalError } from '../AutoRescheduleService';
import { teamPlannerService } from '../TeamPlannerService';
import { scheduleFixProposerService, ScheduleFixStateError, ScheduleFixNotFoundError } from '../ScheduleFixProposerService';
import { changeHistoryService, NotLatestChangeError } from '../ChangeHistoryService';
import { riskService } from '../RiskService';
import { emailService, EmailRejectedError } from '../EmailService';
import { ResourceValidationError } from '../ResourceService';
import { scheduleService } from '../ScheduleService';
import { userService } from '../UserService';
import { killSwitchService } from '../agents/KillSwitchService';
import { checkBackgroundSend } from '../../utils/trialEmail';
import { mapWithLimit } from '../../utils/mapWithLimit';
import { dismissReviewItem, DISMISS_REASONS, type DismissReason } from '../weeklyReview/dismissItem';
import type { WeeklyFacts } from '../weeklyReview/picker';
import { buildWeeklySuggestions, scheduleOfProject, WEEKLY_AGENT } from './weeklyAgent';
import { formatDay } from './format';
import logger from '../../utils/logger';

/** The signed-in person deciding (the route's request.user) */
interface Decider { userId: string; role: string; isGuest?: boolean }

/** Reject = the review's Dismiss: not raised again for 28 days unless it gets worse */
export const REJECT_REASONS = DISMISS_REASONS;

/** A suggestion that can't be decided as asked — the PM's to fix, a 409 with the reason */
export class AiInboxStateError extends Error {}
export class AiInboxNotFoundError extends Error {}

/** An accept that started but never finished (the server stopped) shows under Decided after this */
const INTERRUPTED_AFTER_MS = 10 * 60_000;
/** Decided and replaced suggestions are kept this long, then removed */
const KEEP_DAYS = 90;

/** The features' own refusals, passed on to the PM with their words (not "could not apply") */
const FEATURE_REFUSALS = [ResourceValidationError, StaleProposalError, EmailRejectedError];
function asStateError(err: unknown): unknown {
  if (err instanceof AiInboxStateError || err instanceof AiInboxNotFoundError) return err;
  if (err instanceof NotLatestChangeError) return new AiInboxStateError('The plan has changed since — only the newest change can be undone. Use Schedule History.');
  if (err instanceof ScheduleFixStateError || err instanceof ScheduleFixNotFoundError) return new AiInboxStateError('The plan’s suggested fixes were redone since — run the review again for a fresh suggestion.');
  if (FEATURE_REFUSALS.some(E => err instanceof E)) return new AiInboxStateError((err as Error).message);
  return err;
}

/**
 * The AI inbox (Phase 2 step 1): agents' suggestions waiting for the PM. Only a manager of the
 * project sees and decides its suggestions; Accept runs the existing feature's own change (with its
 * Undo) after checking the plan is still as the card showed; Reject teaches the review not to raise
 * it again unless it gets worse.
 */
class AiInboxService {
  /** After a weekly review run: its ready-made fixes, replacing the project's older ones */
  async fromReview(review: WeeklyReviewRow & { projectName?: string }, facts: WeeklyFacts, userId: string | null): Promise<number> {
    const projectId = review.projectId;
    const gate = await killSwitchService.canRun(WEEKLY_AGENT, projectId);
    if (!gate.allowed) return 0;
    if (!(await this.enabled(projectId, WEEKLY_AGENT))) return 0;
    const pm = await this.pmOf(projectId, userId);
    if (!pm) return 0;
    await this.retireWaiting(projectId);
    const drafts = await buildWeeklySuggestions({
      projectId, projectName: review.projectName ?? '', reviewId: review.id, items: review.items, facts, pm,
    });
    await aiSuggestionRepository.insertMany(drafts);
    aiSuggestionRepository.purgeOld(projectId, KEEP_DAYS).catch(err =>
      logger.warn('[AiInbox] old suggestions not removed', { projectId, error: err?.message }));
    return drafts.length;
  }

  /** The project's suggestions still waiting are replaced: their saved reschedule plans are closed too */
  private async retireWaiting(projectId: string): Promise<void> {
    const waiting = await aiSuggestionRepository.list([projectId], ['waiting']);
    await Promise.all(waiting.filter(s => s.kind === 'reschedule' && s.payload?.rescheduleProposalId)
      .map(s => autoRescheduleService.rejectProposal(s.payload.rescheduleProposalId, 'Replaced by a newer weekly review').catch(() => false)));
    await aiSuggestionRepository.markWaitingStale(projectId, WEEKLY_AGENT);
  }

  /** Is this agent on for the project: the project's own setting, else the company's, else on */
  async enabled(projectId: string, agent: string): Promise<boolean> {
    const rows = await databaseService.query<{ project_id: string; enabled: number }>(
      `SELECT project_id, enabled FROM agent_settings WHERE agent = ? AND project_id IN (?, '')`, [agent, projectId]);
    const own = rows.find(r => r.project_id === projectId) ?? rows.find(r => r.project_id === '');
    return own ? !!Number(own.enabled) : true;
  }

  /**
   * Who the suggestions are drafted for: the person who ran the review, else (the Friday run) the
   * project's owner or a manager — the same people the Friday job notifies. Emails are signed by
   * whoever actually sends them.
   */
  private async pmOf(projectId: string, userId: string | null): Promise<{ id: string; name: string; email: string | null } | null> {
    let id = userId;
    if (!id) {
      const [m] = await databaseService.query<{ user_id: string }>(
        `SELECT user_id FROM project_members WHERE project_id = ? AND role IN ('owner', 'manager') ORDER BY role = 'owner' DESC, added_at LIMIT 1`, [projectId]);
      id = m?.user_id ?? null;
    }
    if (!id) return null;
    const u = await userService.findById(id);
    return u ? { id: u.id, name: u.fullName || u.email, email: u.email ?? null } : null;
  }

  /** The projects among these the person manages (only a project's managers see its suggestions) */
  private async managed(user: Decider, projectIds: string[]): Promise<string[]> {
    const ok = await mapWithLimit(projectIds, 4, id => checkProjectRoleFor(user, id, 'manager').then(d => d.ok).catch(() => false));
    return projectIds.filter((_, i) => ok[i]);
  }

  async list(user: Decider, view: 'waiting' | 'done'): Promise<Array<AiSuggestion & { projectName: string }>> {
    const statuses: SuggestionStatus[] = view === 'waiting' ? ['waiting'] : ['accepted', 'rejected', 'undone', 'working'];
    const withAny = await databaseService.query<{ project_id: string }>(
      `SELECT DISTINCT project_id FROM ai_suggestions WHERE status IN (${statuses.map(() => '?').join(',')})`, statuses);
    const projectIds = await this.managed(user, withAny.map(r => r.project_id));
    const now = Date.now();
    const rows = (await aiSuggestionRepository.list(projectIds, statuses))
      // a running accept isn't "decided" until it has had time to finish; one that never did is shown as interrupted
      .filter(r => r.status !== 'working' || (r.decidedAt != null && now - Date.parse(`${r.decidedAt.replace(' ', 'T')}Z`) > INTERRUPTED_AFTER_MS));
    const names = await this.projectNames([...new Set(rows.map(r => r.projectId))]);
    return rows.map(r => ({ ...r, projectName: names.get(r.projectId) ?? '' }));
  }

  /** How many wait for this person (the side menu's count) */
  async count(user: Decider): Promise<number> {
    const byProject = await aiSuggestionRepository.waitingByProject();
    const mine = await this.managed(user, [...byProject.keys()]);
    return mine.reduce((n, id) => n + (byProject.get(id) ?? 0), 0);
  }

  /** How many wait on one project (its review card links to them) */
  async countForProject(projectId: string): Promise<number> {
    return aiSuggestionRepository.waitingCount(projectId);
  }

  private async projectNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await databaseService.query<{ id: string; name: string }>(
      `SELECT id, name FROM projects WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    return new Map(rows.map(r => [r.id, r.name]));
  }

  /** The suggestion, if this person may decide it (a manager of its project) */
  private async mine(user: Decider, id: string): Promise<AiSuggestion> {
    const s = await aiSuggestionRepository.findById(id);
    if (!s) throw new AiInboxNotFoundError('That suggestion no longer exists.');
    const decision = await checkProjectRoleFor(user, s.projectId, 'manager');
    if (!decision.ok) throw new AiInboxNotFoundError('That suggestion no longer exists.');
    return s;
  }

  async accept(user: Decider, id: string, edits: { subject?: string; body?: string } = {}): Promise<AiSuggestion> {
    const s = await this.mine(user, id);
    if (s.status !== 'waiting') throw new AiInboxStateError(s.status === 'stale' ? 'A newer review replaced this suggestion — open the latest one.' : 'This suggestion was already decided.');
    // claim it first, so a double click can't apply it twice
    if (!(await aiSuggestionRepository.decide(id, 'waiting', 'working', user.userId, {}))) {
      throw new AiInboxStateError('This suggestion was already decided.');
    }
    let outcome: { summary: string; undoRef: unknown };
    try {
      outcome = await this.run(user, s, edits);
    } catch (err) {
      // nothing was applied: back to waiting (one gone stale was already marked stale)
      await aiSuggestionRepository.decide(id, 'working', 'waiting', user.userId, {});
      throw asStateError(err);
    }
    // applied: never back to waiting from here (a second Accept would apply it again)
    await aiSuggestionRepository.decide(id, 'working', 'accepted', user.userId, { resultSummary: outcome.summary, undoRef: outcome.undoRef ?? undefined });
    return (await aiSuggestionRepository.findById(id))!;
  }

  /** The plan has moved on since the suggestion: it can't be applied as shown */
  private async goneStale(s: AiSuggestion, message: string): Promise<never> {
    await aiSuggestionRepository.decide(s.id, 'working', 'stale', 'system', {});
    if (s.kind === 'reschedule') await autoRescheduleService.rejectProposal(s.payload.rescheduleProposalId, 'The plan changed since').catch(() => false);
    throw new AiInboxStateError(message);
  }

  /** Accept: the existing feature's own change, and how to undo it */
  private async run(user: Decider, s: AiSuggestion, edits: { subject?: string; body?: string }): Promise<{ summary: string; undoRef: unknown }> {
    const p = s.payload;
    if (s.scheduleId && !(await scheduleOfProject(s.scheduleId, s.projectId))) throw new AiInboxStateError('That plan no longer exists.');
    switch (s.kind) {
      case 'reschedule': return this.reschedule(s);
      case 'reassign': {
        // the colleague who had room when this was suggested may not now
        const preview = await teamPlannerService.preview(p.move);
        if (preview.overloads.length > 0) {
          return this.goneStale(s, `${p.toName} no longer has room that week — run the review again for a fresh suggestion.`);
        }
        const result = await teamPlannerService.apply(p.move);
        return { summary: result.summary || `Gave "${p.taskName}" to ${p.toName}.`, undoRef: result.changeId ? { type: 'history', scheduleId: s.scheduleId, changeId: result.changeId } : null };
      }
      case 'add_links': {
        const r = await scheduleFixProposerService.apply(p.scheduleId, p.proposalId, p.fixIds, user.userId);
        return { summary: `Added ${r.appliedCount} link${r.appliedCount === 1 ? '' : 's'}. Schedule review ${r.beforeScore} → ${r.afterScore}.`, undoRef: { type: 'schedule_fix', scheduleId: p.scheduleId, proposalId: p.proposalId } };
      }
      case 'add_mitigation': return this.mitigate(user, s);
      case 'remind_raid':
      case 'remind_cr': return this.send(user, s, edits);
      default:
        throw new AiInboxStateError('This kind of suggestion can no longer be applied.');
    }
  }

  /** The late chain: only if every task is still where the card said it was */
  private async reschedule(s: AiSuggestion): Promise<{ summary: string; undoRef: unknown }> {
    const p = s.payload;
    const proposal = await autoRescheduleService.getProposal(p.rescheduleProposalId);
    if (!proposal || proposal.status !== 'pending') return this.goneStale(s, 'The plan changed since this was suggested — run the review again for a fresh suggestion.');
    const tasks = await scheduleService.findTasksByScheduleId(s.scheduleId!);
    const byId = new Map(tasks.map(t => [t.id, t]));
    const day = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : '');
    const moved = proposal.proposedChanges.some(c => {
      const t = byId.get(c.taskId);
      return !t || day(t.startDate) !== day(c.currentStartDate) || day(t.endDate) !== day(c.currentEndDate);
    });
    if (moved) return this.goneStale(s, 'Some of these tasks were moved since this was suggested — run the review again for a fresh suggestion.');
    if (!(await autoRescheduleService.acceptProposal(p.rescheduleProposalId))) {
      return this.goneStale(s, 'The plan changed since this was suggested — run the review again for a fresh suggestion.');
    }
    const [change] = await databaseService.query<{ id: string }>(
      `SELECT id FROM change_batches WHERE schedule_id = ? AND kind = 'ai_reschedule' AND ref = ? ORDER BY created_at DESC LIMIT 1`,
      [s.scheduleId, p.rescheduleProposalId]);
    const n = proposal.proposedChanges.length;
    return { summary: `Moved ${n} task${n === 1 ? '' : 's'}. Finish: ${formatDay(p.finishAfter)}.`, undoRef: change ? { type: 'history', scheduleId: s.scheduleId, changeId: change.id } : null };
  }

  /** A linked action for the risk; the risk's mitigation plan names it, so the review sees it handled */
  private async mitigate(user: Decider, s: AiSuggestion): Promise<{ summary: string; undoRef: unknown }> {
    const p = s.payload;
    const created = await riskService.create({
      projectId: s.projectId, type: 'action', title: p.action.title,
      description: `Added from the AI inbox: the risk "${p.riskTitle}" had no response.`,
      status: 'open', ownerId: user.userId, dueDate: p.action.dueDate, actionType: 'preventive',
      linkedRaidIds: [p.riskId], source: 'agent', sourceAgentId: WEEKLY_AGENT, createdBy: user.userId,
    } as any, user.role);
    const risk = await riskRepository.findById(p.riskId);
    const plan = `Action: ${p.action.title} (due ${formatDay(p.action.dueDate)})`;
    let setPlan = false;
    if (risk && !risk.mitigationPlan && !risk.responsePlan && !risk.responseStrategy) {
      await riskService.update(p.riskId, { mitigationPlan: plan }, user.userId);
      setPlan = true;
    }
    return {
      summary: `Added the action "${p.action.title}", due ${formatDay(p.action.dueDate)}, linked to the risk.`,
      undoRef: { type: 'raid_action', raidId: created.id, riskId: p.riskId, planSet: setPlan ? plan : null },
    };
  }

  /** A reminder email, signed by whoever sends it; a failed recipient doesn't undo the ones already sent */
  private async send(user: Decider, s: AiSuggestion, edits: { subject?: string; body?: string }): Promise<{ summary: string; undoRef: unknown }> {
    const p = s.payload;
    const to: Array<{ name: string; email: string }> = p.to ?? [];
    if (to.length === 0) throw new AiInboxStateError('There is nobody to send this to.');
    const allowance = await checkBackgroundSend(user.userId, to.length);
    if (!allowance.ok) throw new AiInboxStateError(allowance.reason);
    const sender = await userService.findById(user.userId);
    const name = sender?.fullName || sender?.email || 'your project manager';
    const subject = (edits.subject ?? p.subject).trim().slice(0, 200);
    let body = (edits.body ?? p.body).trim().slice(0, 5000);
    if (!subject || !body) throw new AiInboxStateError('Write a subject and a message first.');
    // the draft is signed with the PM it was drafted for; it goes out signed by the sender
    if (p.signedAs && p.signedAs !== name && body.endsWith(p.signedAs)) body = body.slice(0, -p.signedAs.length) + name;
    const sent: string[] = []; const failed: string[] = [];
    for (const r of to) {
      try {
        // eslint-disable-next-line no-await-in-loop -- a handful of people; one at a time for the email provider's limit
        await emailService.sendMessageEmail({ to: r.email, subject, body, replyTo: sender?.email ?? null, sentFor: name });
        sent.push(r.name);
      } catch (err: any) {
        logger.warn('[AiInbox] reminder not sent', { error: err?.message });
        failed.push(r.name);
      }
    }
    if (sent.length === 0) throw new AiInboxStateError('The email could not be sent. Check the address and try again.');
    if (s.kind === 'remind_raid') {
      await riskRepository.createActivityLog({ raidItemId: p.raidId, projectId: s.projectId, userId: user.userId, actionType: 'comment', comment: `Reminder emailed to ${sent.join(', ')} (AI inbox).` })
        .catch(err => logger.warn('[AiInbox] reminder not logged on the RAID item', { error: err?.message }));
    }
    return { summary: `Sent to ${sent.join(', ')}.${failed.length ? ` Not sent to ${failed.join(', ')}.` : ''}`, undoRef: null };
  }

  async reject(user: Decider, id: string, reason: DismissReason): Promise<AiSuggestion> {
    const s = await this.mine(user, id);
    if (s.status !== 'waiting' && s.status !== 'stale') throw new AiInboxStateError('This suggestion was already decided.');
    if (!(await aiSuggestionRepository.decide(id, s.status, 'rejected', user.userId, { reason }))) {
      throw new AiInboxStateError('This suggestion was already decided.');
    }
    if (s.kind === 'reschedule' && s.payload?.rescheduleProposalId) {
      await autoRescheduleService.rejectProposal(s.payload.rescheduleProposalId, `Rejected in the AI inbox: ${reason}`).catch(() => false);
    }
    // the review learns: not raised again for 28 days unless it gets worse
    if (s.reviewId) {
      for (const key of (s.payload?.reviewKeys ?? []) as string[]) {
        // eslint-disable-next-line no-await-in-loop -- one or two keys
        await dismissReviewItem(s.projectId, s.reviewId, key, reason, user.userId)
          .catch(err => logger.warn('[AiInbox] review item not dismissed', { key, error: err?.message }));
      }
    }
    return (await aiSuggestionRepository.findById(id))!;
  }

  async undo(user: Decider, id: string): Promise<AiSuggestion> {
    const s = await this.mine(user, id);
    if (s.status !== 'accepted') throw new AiInboxStateError('Only an accepted suggestion can be undone.');
    const ref = s.undoRef;
    if (!ref) throw new AiInboxStateError(s.kind.startsWith('remind') ? 'An email that was sent can’t be unsent.' : 'This change has no undo.');
    try {
      if (ref.type === 'history') {
        await changeHistoryService.undo(ref.scheduleId, ref.changeId);
      } else if (ref.type === 'schedule_fix') {
        // the same rule as the Schedule Review panel: only the plan's newest change, and History kept in step
        await changeHistoryService.assertLatestByRef(ref.scheduleId, 'review_fix', ref.proposalId);
        await scheduleFixProposerService.undo(ref.scheduleId, ref.proposalId, user.userId);
        await changeHistoryService.markUndoneByRef('review_fix', ref.proposalId);
      } else if (ref.type === 'raid_action') {
        await riskService.cancel(ref.raidId, 'Undone from the AI inbox', user.userId);
        if (ref.planSet) {
          const risk = await riskRepository.findById(ref.riskId);
          if (risk?.mitigationPlan === ref.planSet) await riskService.update(ref.riskId, { mitigationPlan: '' }, user.userId);
        }
      }
    } catch (err) {
      throw asStateError(err);
    }
    await aiSuggestionRepository.decide(id, 'accepted', 'undone', user.userId, {});
    return (await aiSuggestionRepository.findById(id))!;
  }
}

export const aiInboxService = new AiInboxService();
