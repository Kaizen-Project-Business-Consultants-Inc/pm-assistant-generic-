import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Meeting Follow-Up agent (Oct 2026): overdue meeting actions are counted from the RAID log
 * (type 'action', source 'meeting', still open), not from the analysis JSON — so an action
 * marked done in RAID stops being reported.
 */
vi.mock('../../../config', () => ({ config: {} }));
vi.mock('../../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const registry = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../../services/AgentRegistryService', () => ({ agentRegistry: registry }));
const notify = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../../services/NotificationService', () => ({ notificationService: notify }));
vi.mock('../../../services/AgentActivityLogService', () => ({ AgentActivityLogService: class {} }));
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../database/connection', () => ({ databaseService: db }));

import { runMeetingFollowUpAgent } from '../../../services/scheduling/registryAgentRunners';

const project = { id: 'p-1', name: 'DBJ-Loans', projectManagerId: 'u-pm', createdBy: 'u-pm' } as any;
const activityLog = { log: vi.fn() } as any;

describe('Meeting Follow-Up agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notify.create.mockResolvedValue(undefined);
  });

  it('reports overdue meeting actions from the RAID log, not the analysis snapshot', async () => {
    // The analysis still lists an overdue action — but it was done in RAID, so only the RAID rows count
    registry.invoke.mockResolvedValue({ success: true, output: { analyses: [
      { id: 'ma-1', taskUpdates: [], appliedItems: [], actionItems: [{ description: 'old', dueDate: '2020-01-01' }] },
    ] } });
    db.query.mockResolvedValue([{ due_date: '2020-01-02' }, { due_date: '2099-01-01' }]);

    const alerts = await runMeetingFollowUpAgent(project, activityLog);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM project_risks');
    expect(sql).toContain("type = 'action' AND source = 'meeting'");
    expect(sql).toContain("status NOT IN ('completed', 'closed', 'cancelled', 'deferred')");
    expect(params).toEqual(['p-1']);
    expect(alerts).toBe(1);
    expect(notify.create).toHaveBeenCalledTimes(1);
    expect(notify.create.mock.calls[0][0]).toMatchObject({ message: '1 overdue meeting action(s) in the RAID log.', linkType: 'raid', projectId: 'p-1' });
  });

  it('says nothing once every meeting action is done', async () => {
    registry.invoke.mockResolvedValue({ success: true, output: { analyses: [
      { id: 'ma-1', taskUpdates: [], appliedItems: [], actionItems: [{ description: 'old', dueDate: '2020-01-01' }] },
    ] } });
    db.query.mockResolvedValue([]);

    expect(await runMeetingFollowUpAgent(project, activityLog)).toBe(0);
    expect(notify.create).not.toHaveBeenCalled();
  });

  it('still flags unapplied task updates per analysis', async () => {
    registry.invoke.mockResolvedValue({ success: true, output: { analyses: [
      { id: 'ma-1', taskUpdates: [{}, {}], appliedItems: [0], actionItems: [] },
    ] } });
    db.query.mockResolvedValue([]);

    expect(await runMeetingFollowUpAgent(project, activityLog)).toBe(1);
    expect(notify.create.mock.calls[0][0]).toMatchObject({ message: '1 unapplied task update(s).', linkType: 'meeting', linkId: 'ma-1' });
  });
});
