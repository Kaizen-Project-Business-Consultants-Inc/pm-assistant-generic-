import { describe, it, expect, vi, beforeEach } from 'vitest';

// the suggestions table, in memory
const rows = new Map<string, any>();
vi.mock('../../database/AiSuggestionRepository', () => ({
  aiSuggestionRepository: {
    findById: async (id: string) => (rows.has(id) ? { ...rows.get(id) } : null),
    decide: async (id: string, from: string, to: string, by: string, f: any) => {
      const r = rows.get(id);
      if (!r || r.status !== from) return false;
      Object.assign(r, { status: to, decidedBy: by }, f.reason ? { reason: f.reason } : {}, f.resultSummary ? { resultSummary: f.resultSummary } : {}, f.undoRef !== undefined ? { undoRef: f.undoRef } : {});
      return true;
    },
    list: async (ids: string[], statuses: string[]) => [...rows.values()].filter(r => ids.includes(r.projectId) && statuses.includes(r.status)),
    waitingByProject: async () => {
      const m = new Map<string, number>();
      for (const r of rows.values()) if (r.status === 'waiting') m.set(r.projectId, (m.get(r.projectId) ?? 0) + 1);
      return m;
    },
    markWaitingStale: vi.fn(), insertMany: vi.fn(), purgeOld: vi.fn(async () => {}),
    waitingCount: async (id: string) => [...rows.values()].filter(r => r.projectId === id && r.status === 'waiting').length,
  },
}));
const query = vi.fn();
vi.mock('../../database/connection', () => ({ databaseService: { query: (...a: any[]) => query(...a) } }));
const role = vi.fn();
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRoleFor: (...a: any[]) => role(...a) }));
const acceptProposal = vi.fn(); const getProposal = vi.fn(); const rejectProposal = vi.fn(async (..._a: any[]) => true);
const errs = vi.hoisted(() => ({
  StaleProposalError: class extends Error {}, ScheduleFixStateError: class extends Error {}, ScheduleFixNotFoundError: class extends Error {},
  NotLatestChangeError: class extends Error {}, EmailRejectedError: class extends Error {}, ResourceValidationError: class extends Error {},
}));
vi.mock('../../services/AutoRescheduleService', () => ({ StaleProposalError: errs.StaleProposalError, autoRescheduleService: {
  acceptProposal: (...a: any[]) => acceptProposal(...a), getProposal: (...a: any[]) => getProposal(...a), rejectProposal: (...a: any[]) => rejectProposal(...a) } }));
const plannerApply = vi.fn(); const plannerPreview = vi.fn(async (..._a: any[]): Promise<any> => ({ overloads: [] }));
vi.mock('../../services/TeamPlannerService', () => ({ teamPlannerService: { apply: (...a: any[]) => plannerApply(...a), preview: (...a: any[]) => plannerPreview(...a) } }));
const fixApply = vi.fn(); const fixUndo = vi.fn();
vi.mock('../../services/ScheduleFixProposerService', () => ({ ScheduleFixStateError: errs.ScheduleFixStateError, ScheduleFixNotFoundError: errs.ScheduleFixNotFoundError,
  scheduleFixProposerService: { apply: (...a: any[]) => fixApply(...a), undo: (...a: any[]) => fixUndo(...a) } }));
const historyUndo = vi.fn(); const assertLatest = vi.fn(async (..._a: any[]) => {}); const markUndone = vi.fn(async (..._a: any[]) => {});
vi.mock('../../services/ChangeHistoryService', () => ({ NotLatestChangeError: errs.NotLatestChangeError, changeHistoryService: {
  undo: (...a: any[]) => historyUndo(...a), assertLatestByRef: (...a: any[]) => assertLatest(...a), markUndoneByRef: (...a: any[]) => markUndone(...a) } }));
const riskCreate = vi.fn(); const riskCancel = vi.fn(); const riskUpdate = vi.fn(async (..._a: any[]) => ({}));
vi.mock('../../services/RiskService', () => ({ riskService: { create: (...a: any[]) => riskCreate(...a), cancel: (...a: any[]) => riskCancel(...a), update: (...a: any[]) => riskUpdate(...a) } }));
const activity = vi.fn(async (..._a: any[]) => ({}));
const riskFind = vi.fn(async (..._a: any[]): Promise<any> => ({ mitigationPlan: null, responsePlan: null, responseStrategy: null }));
vi.mock('../../database/RiskRepository', () => ({ riskRepository: { createActivityLog: (...a: any[]) => activity(...a), findById: (...a: any[]) => riskFind(...a) } }));
const sendMessage = vi.fn();
vi.mock('../../services/EmailService', () => ({ EmailRejectedError: errs.EmailRejectedError, emailService: { sendMessageEmail: (...a: any[]) => sendMessage(...a) } }));
vi.mock('../../services/ResourceService', () => ({ ResourceValidationError: errs.ResourceValidationError }));
const tasksOf = vi.fn(async (..._a: any[]): Promise<any[]> => [{ id: 't14', startDate: '2026-10-20', endDate: '2026-10-24' }]);
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findTasksByScheduleId: (...a: any[]) => tasksOf(...a) } }));
vi.mock('../../services/UserService', () => ({ userService: { findById: async () => ({ id: 'pm-1', email: 'jordan@acme.test', fullName: 'Jordan Lee' }) } }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: vi.fn() } }));
vi.mock('../../services/agents/KillSwitchService', () => ({ killSwitchService: { canRun: async () => ({ allowed: true }) } }));
const allowance = vi.fn(async () => ({ ok: true }));
vi.mock('../../utils/trialEmail', () => ({ checkBackgroundSend: (...a: any[]) => allowance(...a) }));
vi.mock('../../services/aiInbox/weeklyAgent', () => ({ buildWeeklySuggestions: vi.fn(), WEEKLY_AGENT: 'weekly_review', scheduleOfProject: async () => true }));
const dismiss = vi.fn(async () => ({}));
vi.mock('../../services/weeklyReview/dismissItem', () => ({ dismissReviewItem: (...a: any[]) => dismiss(...a), DISMISS_REASONS: ['not_a_problem', 'already_handled', 'facts_wrong'] }));
vi.mock('../../utils/mapWithLimit', () => ({ mapWithLimit: (items: any[], _n: number, fn: any) => Promise.all(items.map(fn)) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { aiInboxService, AiInboxStateError, AiInboxNotFoundError } from '../../services/aiInbox/AiInboxService';

const pm = { userId: 'pm-1', role: 'project_manager' };
const put = (id: string, kind: string, payload: any, extra: any = {}) =>
  rows.set(id, { id, projectId: 'p1', scheduleId: 's1', agent: 'weekly_review', kind, reviewId: 'rev-1', itemKey: `k:${id}`, title: 'T', detail: null, payload, evidence: [], measure: 1, status: 'waiting', reason: null, resultSummary: null, undoRef: null, ...extra });

describe('AI inbox: only the PM decides; Accept runs the feature’s own change with its Undo', () => {
  beforeEach(() => {
    rows.clear(); vi.clearAllMocks();
    role.mockResolvedValue({ ok: true });
    query.mockResolvedValue([]);
  });

  it('someone who does not manage the project: the suggestion does not exist for them, and their count is 0', async () => {
    put('a', 'reschedule', {});
    role.mockResolvedValue({ ok: false });
    await expect(aiInboxService.accept({ userId: 'tm', role: 'team_member' }, 'a')).rejects.toBeInstanceOf(AiInboxNotFoundError);
    expect(await aiInboxService.count({ userId: 'tm', role: 'team_member' })).toBe(0);
    expect(acceptProposal).not.toHaveBeenCalled();
  });

  const plan = { status: 'pending', proposedChanges: [{ taskId: 't14', currentStartDate: '2026-10-20', currentEndDate: '2026-10-24' }] };

  it('reschedule: accepts the AI Reschedule plan and keeps its Schedule History change for Undo', async () => {
    put('a', 'reschedule', { rescheduleProposalId: 'rp-1', finishAfter: '2026-11-28' });
    getProposal.mockResolvedValue(plan);
    acceptProposal.mockResolvedValue(true);
    query.mockResolvedValue([{ id: 'chg-9' }]);
    const s = await aiInboxService.accept(pm, 'a');
    expect(acceptProposal).toHaveBeenCalledWith('rp-1');
    expect(s).toMatchObject({ status: 'accepted', undoRef: { type: 'history', scheduleId: 's1', changeId: 'chg-9' } });
    expect(s.resultSummary).toBe('Moved 1 task. Finish: 28 Nov.');
    historyUndo.mockResolvedValue({ summary: '', restored: 2 });
    expect((await aiInboxService.undo(pm, 'a')).status).toBe('undone');
    expect(historyUndo).toHaveBeenCalledWith('s1', 'chg-9');
  });

  it('a task moved by hand since: nothing is overwritten, the suggestion goes stale and its saved plan is closed', async () => {
    put('a', 'reschedule', { rescheduleProposalId: 'rp-1' });
    getProposal.mockResolvedValue(plan);
    tasksOf.mockResolvedValueOnce([{ id: 't14', startDate: '2026-10-21', endDate: '2026-10-27' }]);
    await expect(aiInboxService.accept(pm, 'a')).rejects.toThrow(/were moved since/);
    expect(acceptProposal).not.toHaveBeenCalled();
    expect(rows.get('a').status).toBe('stale');
    expect(rejectProposal).toHaveBeenCalledWith('rp-1', 'The plan changed since');
  });

  it('a colleague who no longer has room: the move is not made', async () => {
    put('a', 'reassign', { move: { taskId: 't' }, toName: 'Sam Reid' });
    plannerPreview.mockResolvedValueOnce({ overloads: [{ name: 'Sam Reid' }] });
    await expect(aiInboxService.accept(pm, 'a')).rejects.toThrow('Sam Reid no longer has room that week');
    expect(plannerApply).not.toHaveBeenCalled();
  });

  it("a feature's own refusal reaches the PM in its words (a 409, not 'could not apply')", async () => {
    put('a', 'reassign', { move: { taskId: 't' }, toName: 'Sam' });
    plannerApply.mockRejectedValueOnce(new errs.ResourceValidationError('Dana is no longer on this task.'));
    const err = await aiInboxService.accept(pm, 'a').catch(e => e);
    expect(err).toBeInstanceOf(AiInboxStateError);
    expect(err.message).toBe('Dana is no longer on this task.');
    expect(rows.get('a').status).toBe('waiting');
  });

  it('a second Accept (double click) is refused — the change runs once', async () => {
    put('a', 'reassign', { move: { taskId: 't' }, taskName: 'X', toName: 'Sam' });
    plannerApply.mockResolvedValue({ changeId: 'chg-1', summary: 'Moved' });
    await aiInboxService.accept(pm, 'a');
    await expect(aiInboxService.accept(pm, 'a')).rejects.toBeInstanceOf(AiInboxStateError);
    expect(plannerApply).toHaveBeenCalledTimes(1);
  });

  it('links: applies the Schedule Review fixes it showed; Undo uses that feature’s undo', async () => {
    put('a', 'add_links', { scheduleId: 's1', proposalId: 'fx-1', fixIds: ['f1', 'f2'] });
    fixApply.mockResolvedValue({ appliedCount: 2, beforeScore: 71, afterScore: 84 });
    expect((await aiInboxService.accept(pm, 'a')).resultSummary).toBe('Added 2 links. Schedule review 71 → 84.');
    expect(fixApply).toHaveBeenCalledWith('s1', 'fx-1', ['f1', 'f2'], 'pm-1');
    await aiInboxService.undo(pm, 'a');
    expect(assertLatest).toHaveBeenCalledWith('s1', 'review_fix', 'fx-1');
    expect(fixUndo).toHaveBeenCalledWith('s1', 'fx-1', 'pm-1');
    expect(markUndone).toHaveBeenCalledWith('review_fix', 'fx-1');
  });

  it('undo of links after later changes: refused with the History rule, nothing removed', async () => {
    put('a', 'add_links', { scheduleId: 's1', proposalId: 'fx-1', fixIds: ['f1'] }, { status: 'accepted', undoRef: { type: 'schedule_fix', scheduleId: 's1', proposalId: 'fx-1' } });
    assertLatest.mockRejectedValueOnce(new errs.NotLatestChangeError('not latest'));
    await expect(aiInboxService.undo(pm, 'a')).rejects.toThrow(/only the newest change/);
    expect(fixUndo).not.toHaveBeenCalled();
    expect(rows.get('a').status).toBe('accepted');
  });

  it('mitigation: adds the action linked to the risk; Undo cancels it (RAID items are never deleted)', async () => {
    put('a', 'add_mitigation', { riskId: 'r5', riskTitle: 'Asbestos', action: { title: 'Decide', dueDate: '2026-10-23', ownerUserId: 'pm-1' } }, { scheduleId: null });
    riskCreate.mockResolvedValue({ id: 'act-12' });
    await aiInboxService.accept(pm, 'a');
    expect(riskCreate.mock.calls[0][0]).toMatchObject({ projectId: 'p1', type: 'action', linkedRaidIds: ['r5'], ownerId: 'pm-1', source: 'agent', status: 'open' });
    // the risk now names its mitigation, so next week's review sees it handled
    expect(riskUpdate).toHaveBeenCalledWith('r5', { mitigationPlan: 'Action: Decide (due 23 Oct)' }, 'pm-1');
    riskFind.mockResolvedValueOnce({ mitigationPlan: 'Action: Decide (due 23 Oct)' });
    await aiInboxService.undo(pm, 'a');
    expect(riskCancel).toHaveBeenCalledWith('act-12', 'Undone from the AI inbox', 'pm-1');
    expect(riskUpdate).toHaveBeenLastCalledWith('r5', { mitigationPlan: '' }, 'pm-1');
  });

  it('reminder: sends the edited text from Kovarti with replies to the PM, logs it on the RAID item, and cannot be unsent', async () => {
    put('a', 'remind_raid', { raidId: 'a7', to: [{ name: 'Priya Nair', email: 'priya@x.ca' }], subject: 'S', body: 'B', signedAs: 'Jordan Lee' }, { scheduleId: null });
    const s = await aiInboxService.accept(pm, 'a', { subject: 'Switchgear date?', body: 'Hi Priya, by Wednesday please.' });
    expect(sendMessage).toHaveBeenCalledWith({ to: 'priya@x.ca', subject: 'Switchgear date?', body: 'Hi Priya, by Wednesday please.', replyTo: 'jordan@acme.test', sentFor: 'Jordan Lee' });
    expect(activity.mock.calls[0][0]).toMatchObject({ raidItemId: 'a7', actionType: 'comment' });
    expect(s.resultSummary).toBe('Sent to Priya Nair.');
    await expect(aiInboxService.undo(pm, 'a')).rejects.toThrow(/can.t be unsent/);
  });

  it('a reminder drafted for another manager is signed by the person who sends it', async () => {
    put('a', 'remind_raid', { raidId: 'a7', to: [{ name: 'P', email: 'p@x.ca' }], subject: 'S', body: 'Hi P,\n\nThanks,\nAlex Other', signedAs: 'Alex Other' }, { scheduleId: null });
    await aiInboxService.accept(pm, 'a');
    expect(sendMessage.mock.calls[0][0].body).toBe('Hi P,\n\nThanks,\nJordan Lee');
  });

  it('a reminder that reaches some people: done, saying who it missed (never sent twice)', async () => {
    put('a', 'remind_cr', { crId: 'c', to: [{ name: 'Kim', email: 'k@x.ca' }, { name: 'Lee', email: 'l@x.ca' }], subject: 'S', body: 'B' }, { scheduleId: null });
    sendMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('bounced'));
    const s = await aiInboxService.accept(pm, 'a');
    expect(s).toMatchObject({ status: 'accepted', resultSummary: 'Sent to Kim. Not sent to Lee.' });
  });

  it('reminder over the trial email allowance: refused with the reason, nothing sent', async () => {
    put('a', 'remind_cr', { crId: 'c', to: [{ name: 'Kim', email: 'kim@x.ca' }], subject: 'S', body: 'B' }, { scheduleId: null });
    allowance.mockResolvedValueOnce({ ok: false, reason: 'The free trial sends at most 5 emails a day.' } as any);
    await expect(aiInboxService.accept(pm, 'a')).rejects.toThrow('The free trial sends at most 5 emails a day.');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(rows.get('a').status).toBe('waiting');
  });

  it('reject: records why and tells the review, so it is not raised again unless it gets worse', async () => {
    put('a', 'reschedule', { reviewKeys: ['delay:t14', 'delay:t15'] });
    const s = await aiInboxService.reject(pm, 'a', 'already_handled');
    expect(s).toMatchObject({ status: 'rejected', reason: 'already_handled' });
    expect(dismiss.mock.calls.map(c => c[2])).toEqual(['delay:t14', 'delay:t15']);
    expect(dismiss.mock.calls[0]).toEqual(['p1', 'rev-1', 'delay:t14', 'already_handled', 'pm-1']);
  });

  it('a suggestion a newer review replaced can no longer be accepted', async () => {
    put('a', 'reschedule', {}, { status: 'stale' });
    await expect(aiInboxService.accept(pm, 'a')).rejects.toThrow(/newer review replaced/);
  });

  it('the list and the count are only the projects the person manages', async () => {
    put('a', 'reschedule', {}); put('b', 'reschedule', {}, { projectId: 'p2' });
    query.mockResolvedValue([{ project_id: 'p1' }, { project_id: 'p2' }]);
    role.mockImplementation(async (_u: any, projectId: string) => ({ ok: projectId === 'p1' }));
    expect((await aiInboxService.list(pm, 'waiting')).map(s => s.id)).toEqual(['a']);
    expect(await aiInboxService.count(pm)).toBe(1);
  });
});
