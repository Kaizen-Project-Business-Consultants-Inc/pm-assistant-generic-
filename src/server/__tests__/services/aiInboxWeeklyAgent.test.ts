import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const queryControlPlane = vi.fn();
vi.mock('../../database/connection', () => ({ databaseService: { query: (...a: any[]) => query(...a), queryControlPlane: (...a: any[]) => queryControlPlane(...a) } }));
const generateProposal = vi.fn(); const rejectProposal = vi.fn(async (..._a: any[]) => true);
vi.mock('../../services/AutoRescheduleService', () => ({ autoRescheduleService: { generateProposal: (...a: any[]) => generateProposal(...a), rejectProposal: (...a: any[]) => rejectProposal(...a) } }));
const preview = vi.fn();
vi.mock('../../services/TeamPlannerService', () => ({ teamPlannerService: { preview: (...a: any[]) => preview(...a) } }));
const propose = vi.fn(); const getLatest = vi.fn(async (..._a: any[]): Promise<any> => null);
vi.mock('../../services/ScheduleFixProposerService', () => ({ scheduleFixProposerService: { propose: (...a: any[]) => propose(...a), getLatest: (...a: any[]) => getLatest(...a) } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findById: vi.fn(), findByProjectId: async () => [], workingDayTest: vi.fn() } }));
const outsidePool = vi.fn(async () => new Map());
vi.mock('../../services/poolFit', () => ({ outsidePool: (...a: any[]) => outsidePool(...a) }));
const findUser = vi.fn();
vi.mock('../../services/UserService', () => ({ userService: { findById: (id: string) => findUser(id) } }));
const findRaid = vi.fn();
vi.mock('../../database/RiskRepository', () => ({ riskRepository: { findById: (id: string) => findRaid(id) } }));
const findCR = vi.fn(); const findWf = vi.fn();
vi.mock('../../database/ApprovalWorkflowRepository', () => ({ approvalWorkflowRepository: { findChangeRequestById: (id: string) => findCR(id), findByProject: (id: string) => findWf(id) } }));
vi.mock('../../middleware/requestContext', () => ({ getTenantContext: () => ({ dbName: 't', orgId: 'org-1' }) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { buildWeeklySuggestions } from '../../services/aiInbox/weeklyAgent';

const facts = (over: any = {}) => ({
  asOf: '2026-10-16', delays: [], overloads: [], evm: null, currency: 'USD', plans: [],
  raid: { open: 0, unhandled: [], overdue: [] }, changeRequests: [], timesheetsWaiting: [], taskCount: 10, ...over,
});
const item = (kind: string, key: string, refs: any = {}, measure = 3) => ({ key, kind, level: 'amber', label: '', headline: '', suggestion: '', facts: [`fact about ${key}`], area: 'schedule', measure, refs });
const ctx = (items: any[], f: any = facts()) => ({
  projectId: 'p1', projectName: 'Harbour St Clinic', reviewId: 'rev-1', items, facts: f,
  pm: { id: 'pm-1', name: 'Jordan Lee', email: 'jordan@acme.test' },
});

describe('Weekly review agent: findings become ready-made fixes (Phase 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); query.mockResolvedValue([]); queryControlPlane.mockResolvedValue([]); });

  it('a late chain becomes one rules-based reschedule per plan, with the finish date shift', async () => {
    generateProposal.mockResolvedValue({
      id: 'rp-1', proposedChanges: [{ taskId: 't14', taskName: 'Electrical first fix', currentStartDate: '2026-10-20', proposedStartDate: '2026-10-20', currentEndDate: '2026-10-24', proposedEndDate: '2026-10-30' }],
      estimatedImpact: { originalEndDate: '2026-11-24', proposedEndDate: '2026-11-28', daysChange: 4 },
    });
    const out = await buildWeeklySuggestions(ctx([item('finish_at_risk', 'delay:t14', { taskId: 't14', scheduleId: 's1' }, 4)]) as any);
    expect(generateProposal).toHaveBeenCalledWith('s1', undefined, 'agent', { useAi: false });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'reschedule', scheduleId: 's1', reviewId: 'rev-1', agent: 'weekly_review', measure: 4 });
    expect(out[0].payload).toMatchObject({ rescheduleProposalId: 'rp-1', reviewKeys: ['delay:t14'], finishAfter: '2026-11-28' });
    expect(out[0].detail).toMatch(/24 Nov → 28 Nov.*4 working days later/);
  });

  it('an overloaded person: gives the shortest task in that week to a same-role person in the pool with room', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM task_assignments/.test(sql)) return [{ id: 't22', name: 'Fire-stopping walk-through', schedule_id: 's1', start_date: '2026-10-26', end_date: '2026-10-27' }];
      if (/SELECT name, role FROM resources/.test(sql)) return [{ name: 'Dana Okafor', role: 'Site Supervisor' }];
      if (/FROM resources r/.test(sql)) return [{ id: 'r-full', name: 'Ann Full' }, { id: 'r-sam', name: 'Sam Reid' }, { id: 'r-other', name: 'Other Client' }];
      return [];
    });
    outsidePool.mockResolvedValueOnce(new Map([['r-other', 'Other Client']]));
    preview.mockImplementation(async (i: any) => i.toResourceId === 'r-full'
      ? { overloads: [{ name: 'Ann Full' }], load: [] }
      : { overloads: [], load: [{ resourceId: 'r-dana', weeks: [{ weekStart: '2026-10-26', after: 38, capacity: 40 }] }, { resourceId: 'r-sam', weeks: [{ weekStart: '2026-10-26', after: 32, capacity: 40 }] }] });
    const f = facts({ overloads: [{ resourceId: 'r-dana', resourceName: 'Dana Okafor', weeks: [{ weekStart: '2026-10-26', allocated: 56, capacity: 40 }] }] });
    const out = await buildWeeklySuggestions(ctx([item('overloaded', 'overload:r-dana', { resourceId: 'r-dana' }, 16)], f) as any);
    expect(preview.mock.calls.map(c => c[0].toResourceId)).toEqual(['r-full', 'r-sam']); // never the other client's person
    expect(out[0]).toMatchObject({ kind: 'reassign', title: 'Give "Fire-stopping walk-through" to Sam Reid — Dana Okafor is overbooked' });
    expect(out[0].payload.move).toEqual({ taskId: 't22', fromResourceId: 'r-dana', toResourceId: 'r-sam', weeks: 0 });
    expect(out[0].payload.after).toEqual({ from: '95%', to: '80%' });
  });

  it('nobody with room: no reassign suggestion', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM task_assignments/.test(sql)) return [{ id: 't22', name: 'X', schedule_id: 's1', start_date: '2026-10-26', end_date: '2026-10-27' }];
      if (/SELECT name, role FROM resources/.test(sql)) return [{ name: 'Dana', role: 'Site Supervisor' }];
      if (/FROM resources r/.test(sql)) return [{ id: 'r-full', name: 'Ann' }];
      return [];
    });
    preview.mockResolvedValue({ overloads: [{ name: 'Ann' }], load: [] });
    const f = facts({ overloads: [{ resourceId: 'r-dana', resourceName: 'Dana', weeks: [{ weekStart: '2026-10-26', allocated: 56, capacity: 40 }] }] });
    expect(await buildWeeklySuggestions(ctx([item('overloaded', 'overload:r-dana', { resourceId: 'r-dana' })], f) as any)).toEqual([]);
  });

  it('a late chain with nothing to move: no suggestion and its saved plan is closed', async () => {
    generateProposal.mockResolvedValue({ id: 'rp-0', proposedChanges: [], estimatedImpact: {} });
    expect(await buildWeeklySuggestions(ctx([item('task_late', 'delay:t1', { taskId: 't1', scheduleId: 's1' })]) as any)).toEqual([]);
    expect(rejectProposal).toHaveBeenCalledWith('rp-0', 'Nothing to move');
  });

  it("plan quality: a pending fix proposal (the PM's own) is used as it is, never replaced", async () => {
    getLatest.mockResolvedValueOnce({ id: 'fx-pm', status: 'pending', proposalData: { fixes: [{ id: 'z', type: 'add_dependency', defaultChecked: true, taskName: 'A', dependsOnTaskName: 'B' }] } });
    const out = await buildWeeklySuggestions(ctx([item('plan_quality', 'plan:s1', { scheduleId: 's1' })]) as any);
    expect(propose).not.toHaveBeenCalled();
    expect(out[0].payload).toMatchObject({ proposalId: 'fx-pm', fixIds: ['z'] });
  });

  it('plan quality: only the add-a-link fixes the rules tick by default', async () => {
    propose.mockResolvedValue({ id: 'fx-1', proposalData: { fixes: [
      { id: 'a', type: 'add_dependency', defaultChecked: true, taskName: 'Store listing', dependsOnTaskName: 'Beta testing', dependencyType: 'SS' },
      { id: 'b', type: 'add_dependency', defaultChecked: false, taskName: 'Maybe' },
      { id: 'c', type: 'set_duration', defaultChecked: true },
    ] } });
    const out = await buildWeeklySuggestions(ctx([item('plan_quality', 'plan:s1', { scheduleId: 's1' })]) as any);
    expect(propose).toHaveBeenCalledWith('s1', null, false);
    expect(out[0]).toMatchObject({ kind: 'add_links', title: 'Link 1 task that has nothing before or after them' });
    expect(out[0].payload).toMatchObject({ proposalId: 'fx-1', fixIds: ['a'], links: [{ task: 'Store listing', after: 'Beta testing', type: 'SS' }] });
  });

  it('a risk that already has an open action linked to it is not suggested again', async () => {
    query.mockImplementation(async (sql: string) => (/FROM project_risks/.test(sql) ? [{ linked_raid_ids: '["r5"]' }] : []));
    const f = facts({ raid: { open: 2, overdue: [], unhandled: [{ id: 'r5', title: 'Handled', why: 'no owner' }, { id: 'r6', title: 'Open', why: 'no owner' }] } });
    const out = await buildWeeklySuggestions(ctx([item('risks_unhandled', 'risks-unhandled')], f) as any);
    expect(out.map(o => o.payload.riskId)).toEqual(['r6']);
  });

  it('a high risk with no response: an action owned by the PM, due in 5 working days, linked to the risk', async () => {
    const f = facts({ raid: { open: 1, overdue: [], unhandled: [{ id: 'r5', title: 'Asbestos found during demolition', why: 'no response chosen' }] } });
    const out = await buildWeeklySuggestions(ctx([item('risks_unhandled', 'risks-unhandled')], f) as any);
    expect(out[0]).toMatchObject({ kind: 'add_mitigation', itemKey: 'mitigate:r5' });
    expect(out[0].payload.action).toEqual({ title: 'Decide the response to "Asbestos found during demolition" and who owns it', dueDate: '2026-10-23', ownerUserId: 'pm-1', ownerName: 'Jordan Lee' });
  });

  it('overdue RAID items: a reminder to a reachable owner — never to a placeholder address or to the PM themself', async () => {
    findRaid.mockImplementation(async (id: string) => ({
      a7: { ownerResourceId: 'res-priya' }, a8: { ownerResourceId: 'res-ghost' }, a9: { ownerId: 'pm-1' },
    } as any)[id]);
    query.mockImplementation(async (sql: string, params: any[]) => {
      if (/SELECT name, email, user_id FROM resources/.test(sql)) {
        return params[0] === 'res-priya' ? [{ name: 'Priya Nair', email: 'priya@harbourelectric.ca', user_id: null }] : [{ name: 'Ghost', email: 'ghost@example.com', user_id: null }];
      }
      return [];
    });
    findUser.mockResolvedValue({ id: 'pm-1', email: 'jordan@acme.test', fullName: 'Jordan Lee' });
    const f = facts({ raid: { open: 3, unhandled: [], overdue: [
      { id: 'a7', title: 'Confirm the switchgear delivery date', dueDate: '2026-10-08' },
      { id: 'a8', title: 'Ghost item', dueDate: '2026-10-08' },
      { id: 'a9', title: 'My own item', dueDate: '2026-10-08' },
    ] } });
    const out = await buildWeeklySuggestions(ctx([item('raid_overdue', 'raid-overdue')], f) as any);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'remind_raid', title: 'Remind Priya Nair: "Confirm the switchgear delivery date" is overdue' });
    expect(out[0].payload.to).toEqual([{ name: 'Priya Nair', email: 'priya@harbourelectric.ca' }]);
    expect(out[0].payload.body).toMatch(/^Hi Priya,[\s\S]*due on 8 Oct[\s\S]*Jordan Lee$/);
  });

  it("a change request waiting 5+ days: a reminder to people who can approve it here — the step's role among the project's managers, or the PMO", async () => {
    // steps are read by position, as the approval service does (order values can start at 1)
    findWf.mockResolvedValue([{ id: 'wf1', steps: [{ name: 'PM check', approverRole: 'project_manager', order: 1 }, { name: 'Sponsor sign-off', approverRole: 'executive', order: 2 }] }]);
    findCR.mockResolvedValue({ id: 'cr4', workflowId: 'wf1', currentStep: 1 });
    query.mockImplementation(async (sql: string) => (/FROM project_members/.test(sql) ? [{ user_id: 'u-kim' }] : []));
    queryControlPlane.mockResolvedValue([{ id: 'u-kim', email: 'kim@acme.test', full_name: 'Kim Bailey' }]);
    const f = facts({ changeRequests: [{ id: 'cr4', title: 'Add Android tablet layouts', waitingDays: 9 }, { id: 'cr5', title: 'New', waitingDays: 2 }] });
    const out = await buildWeeklySuggestions(ctx([item('cr_waiting', 'cr-waiting')], f) as any);
    expect(queryControlPlane.mock.calls[0][0]).toMatch(/role = 'pmo' OR \(role = \? AND id IN \(\?\)\)/);
    expect(queryControlPlane.mock.calls[0][1]).toEqual(['org-1', 'executive', 'u-kim', 'executive']);
    expect(out[0].detail).toBe('Waiting on the "Sponsor sign-off" step.');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'remind_cr', measure: 9 });
    expect(out[0].payload.to).toEqual([{ name: 'Kim Bailey', email: 'kim@acme.test' }]);
  });

  it('one builder failing leaves the others', async () => {
    generateProposal.mockRejectedValue(new Error('boom'));
    const f = facts({ raid: { open: 1, overdue: [], unhandled: [{ id: 'r5', title: 'R', why: 'no owner' }] } });
    const out = await buildWeeklySuggestions(ctx([item('task_late', 'delay:t1', { taskId: 't1', scheduleId: 's1' }), item('risks_unhandled', 'risks-unhandled')], f) as any);
    expect(out.map(o => o.kind)).toEqual(['add_mitigation']);
  });
});
