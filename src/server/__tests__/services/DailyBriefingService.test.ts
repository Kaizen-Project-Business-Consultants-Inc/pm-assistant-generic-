import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockQuery = vi.fn().mockResolvedValue([]);
const mockQueryControlPlane = vi.fn().mockResolvedValue([]);

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(),
    queryControlPlane: vi.fn(),
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { dailyBriefingService } from '../../services/DailyBriefingService';
import { databaseService } from '../../database/connection';

// ── Typed references ───────────────────────────────────────────────────────

const queryMock = databaseService.query as ReturnType<typeof vi.fn>;
const queryControlPlaneMock = databaseService.queryControlPlane as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * The service fires 11 parallel queries via Promise.all.
 * This helper sets up the default empty results for all 11 queries,
 * allowing individual tests to override specific indices.
 *
 * Order:
 *  0: proposals (query)
 *  1: changeRequests (query)
 *  2: notifications (queryControlPlane)
 *  3: dueToday (query)
 *  4: dueThisWeek (query)
 *  5: overdue (query)
 *  6: risks (query)
 *  7: milestones (query)
 *  8: overdueActions (query)
 *  9: blockedTasks (query)
 * 10: openIssues (query)
 */
function setupDefaultResults(overrides: Record<number, any[]> = {}) {
  const defaults: any[][] = [
    [{ cnt: 0 }],   // 0: proposals
    [],              // 1: changeRequests
    [],              // 2: notifications (via queryControlPlane)
    [],              // 3: dueToday
    [],              // 4: dueThisWeek
    [],              // 5: overdue
    [],              // 6: risks
    [],              // 7: milestones
    [],              // 8: overdueActions
    [],              // 9: blockedTasks
    [],              // 10: openIssues
  ];

  for (const [idx, val] of Object.entries(overrides)) {
    defaults[Number(idx)] = val;
  }

  // query calls: indices 0,1,3,4,5,6,7,8,9,10 (10 calls)
  // queryControlPlane calls: index 2 (1 call)
  let queryCallIdx = 0;
  const queryResults = [
    defaults[0],  // proposals
    defaults[1],  // changeRequests
    defaults[3],  // dueToday
    defaults[4],  // dueThisWeek
    defaults[5],  // overdue
    defaults[6],  // risks
    defaults[7],  // milestones
    defaults[8],  // overdueActions
    defaults[9],  // blockedTasks
    defaults[10], // openIssues
  ];

  queryMock.mockImplementation(() => {
    const result = queryResults[queryCallIdx] ?? [];
    queryCallIdx++;
    return Promise.resolve(result);
  });

  queryControlPlaneMock.mockResolvedValue(defaults[2]);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DailyBriefingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy Path ─────────────────────────────────────────────────────────

  describe('getDailyBriefing', () => {
    it('returns a complete briefing structure with all empty data', async () => {
      setupDefaultResults();

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result).toHaveProperty('generatedAt');
      expect(result.userRole).toBe('admin');
      expect(result.actionItems.pendingProposals).toBe(0);
      expect(result.actionItems.pendingChangeRequests).toEqual([]);
      expect(result.actionItems.unreadNotifications).toEqual({ total: 0, critical: 0, high: 0 });
      expect(result.tasksDueToday).toEqual([]);
      expect(result.tasksDueThisWeek).toEqual([]);
      expect(result.overdueTasks).toEqual([]);
      expect(result.recentHighRisks).toEqual([]);
      expect(result.upcomingMilestones).toEqual([]);
      expect(result.raidWatch).toEqual([]);
    });

    it('returns generatedAt as a valid ISO date string', async () => {
      setupDefaultResults();

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
    });

    // ── Proposals ──────────────────────────────────────────────────────

    it('returns pending proposals count', async () => {
      setupDefaultResults({ 0: [{ cnt: 5 }] });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.pendingProposals).toBe(5);
    });

    it('handles proposals count as string (DB returns strings)', async () => {
      setupDefaultResults({ 0: [{ cnt: '12' }] });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.pendingProposals).toBe(12);
    });

    // ── Change Requests ────────────────────────────────────────────────

    it('returns pending change requests', async () => {
      const crs = [
        { id: 'cr-1', title: 'Add feature X', projectName: 'Proj A', projectId: 'p-1', projectCode: 'PA', priority: 'high' },
        { id: 'cr-2', title: 'Fix bug Y', projectName: 'Proj B', projectId: 'p-2', projectCode: 'PB', priority: 'medium' },
      ];
      setupDefaultResults({ 1: crs });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.pendingChangeRequests).toEqual(crs);
      expect(result.actionItems.pendingChangeRequests).toHaveLength(2);
    });

    // ── Notifications ──────────────────────────────────────────────────

    it('aggregates unread notifications by severity', async () => {
      const notifs = [
        { severity: 'critical', cnt: 2 },
        { severity: 'high', cnt: 5 },
        { severity: 'medium', cnt: 3 },
        { severity: 'low', cnt: 1 },
      ];
      setupDefaultResults({ 2: notifs });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.unreadNotifications.total).toBe(11);
      expect(result.actionItems.unreadNotifications.critical).toBe(2);
      expect(result.actionItems.unreadNotifications.high).toBe(5);
    });

    it('handles notification counts as strings', async () => {
      const notifs = [
        { severity: 'critical', cnt: '3' },
        { severity: 'high', cnt: '7' },
      ];
      setupDefaultResults({ 2: notifs });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.unreadNotifications.total).toBe(10);
      expect(result.actionItems.unreadNotifications.critical).toBe(3);
      expect(result.actionItems.unreadNotifications.high).toBe(7);
    });

    it('returns zero for missing severity levels', async () => {
      const notifs = [{ severity: 'low', cnt: 4 }];
      setupDefaultResults({ 2: notifs });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.unreadNotifications.critical).toBe(0);
      expect(result.actionItems.unreadNotifications.high).toBe(0);
      expect(result.actionItems.unreadNotifications.total).toBe(4);
    });

    // ── Tasks Due Today ────────────────────────────────────────────────

    it('returns tasks due today', async () => {
      const tasks = [
        { id: 't-1', name: 'Task 1', projectName: 'P1', projectId: 'p-1', projectCode: 'P1', scheduleId: 's-1', sortOrder: 1, priority: 'high' },
      ];
      setupDefaultResults({ 3: tasks });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.tasksDueToday).toEqual(tasks);
    });

    // ── Tasks Due This Week ────────────────────────────────────────────

    it('returns tasks due this week', async () => {
      const tasks = [
        { id: 't-2', name: 'Task 2', projectName: 'P1', projectId: 'p-1', projectCode: 'P1', scheduleId: 's-1', sortOrder: 2, priority: 'medium', dueDate: '2026-09-15', daysUntil: 2 },
      ];
      setupDefaultResults({ 4: tasks });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.tasksDueThisWeek).toEqual(tasks);
    });

    // ── Overdue Tasks ──────────────────────────────────────────────────

    it('returns overdue tasks', async () => {
      const tasks = [
        { id: 't-3', name: 'Late Task', projectName: 'P2', projectId: 'p-2', projectCode: 'P2', scheduleId: 's-2', sortOrder: 1, priority: 'critical', overdueDays: 5 },
      ];
      setupDefaultResults({ 5: tasks });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.overdueTasks).toEqual(tasks);
    });

    // ── High Risks ─────────────────────────────────────────────────────

    it('returns recent high risks', async () => {
      const risks = [
        { id: 'r-1', title: 'Risk 1', projectName: 'P1', projectId: 'p-1', projectCode: 'P1', severity: 'critical', type: 'risk' },
      ];
      setupDefaultResults({ 6: risks });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.recentHighRisks).toEqual(risks);
    });

    // ── Milestones ─────────────────────────────────────────────────────

    it('returns upcoming milestones', async () => {
      const milestones = [
        { id: 'm-1', name: 'Phase 1 Complete', projectName: 'P1', projectId: 'p-1', projectCode: 'P1', scheduleId: 's-1', dueDate: '2026-09-16', daysUntil: 3 },
      ];
      setupDefaultResults({ 7: milestones });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.upcomingMilestones).toEqual(milestones);
    });

    // ── RAID Watch ─────────────────────────────────────────────────────

    it('builds RAID watch items from overdue action items', async () => {
      const actions = [
        { id: 'a-1', description: 'Review design doc', due_date: '2026-09-10', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', overdueDays: 3, resourceName: 'Alice' },
      ];
      setupDefaultResults({ 8: actions });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.raidWatch).toHaveLength(1);
      expect(result.raidWatch[0]).toMatchObject({
        id: 'a-1',
        type: 'action_item',
        label: 'Review design doc',
        projectId: 'p-1',
        detail: '3d overdue',
        linkTab: 'raid',
        resourceName: 'Alice',
      });
    });

    it('truncates action item description to 80 chars in label', async () => {
      const longDesc = 'A'.repeat(100);
      const actions = [
        { id: 'a-2', description: longDesc, due_date: '2026-09-10', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', overdueDays: 1, resourceName: null },
      ];
      setupDefaultResults({ 8: actions });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.raidWatch[0].label).toHaveLength(80);
    });

    it('uses fallback label when action item description is null', async () => {
      const actions = [
        { id: 'a-3', description: null, due_date: '2026-09-10', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', overdueDays: 2, resourceName: null },
      ];
      setupDefaultResults({ 8: actions });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.raidWatch[0].label).toBe('Action item');
    });

    it('builds RAID watch items from blocked tasks', async () => {
      const blocked = [
        { id: 't-10', name: 'Deploy', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', scheduleId: 's-1', sortOrder: 5, blockedByName: 'QA Testing', resourceName: 'Bob' },
      ];
      setupDefaultResults({ 9: blocked });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.raidWatch).toHaveLength(1);
      expect(result.raidWatch[0]).toMatchObject({
        id: 't-10',
        type: 'blocked_task',
        label: 'Deploy',
        detail: 'blocked by: QA Testing',
        linkTab: 'schedule',
        resourceName: 'Bob',
      });
    });

    it('builds RAID watch items from open issues', async () => {
      const issues = [
        { id: 'i-1', title: 'Server crash', severity: 'critical', projectId: 'p-1', projectName: 'P1', projectCode: 'P1' },
      ];
      setupDefaultResults({ 10: issues });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.raidWatch).toHaveLength(1);
      expect(result.raidWatch[0]).toMatchObject({
        id: 'i-1',
        type: 'open_issue',
        label: 'Server crash',
        detail: 'critical issue',
        linkTab: 'raid',
      });
      // open_issue type should not have resourceName
      expect(result.raidWatch[0].resourceName).toBeUndefined();
    });

    it('combines all RAID watch types in correct order', async () => {
      setupDefaultResults({
        8: [{ id: 'a-1', description: 'Action', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', overdueDays: 1, resourceName: null }],
        9: [{ id: 'b-1', name: 'Blocked', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', scheduleId: 's-1', sortOrder: 1, blockedByName: 'Pred', resourceName: null }],
        10: [{ id: 'i-1', title: 'Issue', severity: 'high', projectId: 'p-1', projectName: 'P1', projectCode: 'P1' }],
      });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.raidWatch).toHaveLength(3);
      expect(result.raidWatch[0].type).toBe('action_item');
      expect(result.raidWatch[1].type).toBe('blocked_task');
      expect(result.raidWatch[2].type).toBe('open_issue');
    });

    // ── Full briefing with data ────────────────────────────────────────

    it('returns a fully populated briefing', async () => {
      setupDefaultResults({
        0: [{ cnt: 3 }],
        1: [{ id: 'cr-1', title: 'CR', projectName: 'P', projectId: 'p-1', projectCode: 'PC', priority: 'high' }],
        2: [{ severity: 'critical', cnt: 1 }, { severity: 'high', cnt: 2 }],
        3: [{ id: 't-1', name: 'Today', projectName: 'P', projectId: 'p-1', projectCode: 'PC', scheduleId: 's-1', sortOrder: 1, priority: 'high' }],
        5: [{ id: 't-3', name: 'Late', projectName: 'P', projectId: 'p-1', projectCode: 'PC', scheduleId: 's-1', sortOrder: 3, priority: 'critical', overdueDays: 2 }],
        6: [{ id: 'r-1', title: 'Risk', projectName: 'P', projectId: 'p-1', projectCode: 'PC', severity: 'high', type: 'risk' }],
      });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'executive');

      expect(result.actionItems.pendingProposals).toBe(3);
      expect(result.actionItems.pendingChangeRequests).toHaveLength(1);
      expect(result.actionItems.unreadNotifications.total).toBe(3);
      expect(result.tasksDueToday).toHaveLength(1);
      expect(result.overdueTasks).toHaveLength(1);
      expect(result.recentHighRisks).toHaveLength(1);
    });
  });

  // ── Role-based Scoping ───────────────────────────────────────────────

  describe('role-based query scoping', () => {
    it('does not include member join for global roles (admin)', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      // For global roles, query params should be empty arrays (no userId in member join)
      // The proposals query (first query call) should have empty params
      expect(queryMock).toHaveBeenCalled();
      const firstCallArgs = queryMock.mock.calls[0];
      expect(firstCallArgs[1]).toEqual([]);
    });

    it('does not include member join for executive role', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'executive');

      const firstCallArgs = queryMock.mock.calls[0];
      expect(firstCallArgs[1]).toEqual([]);
    });

    it('does not include member join for pmo role', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'pmo');

      const firstCallArgs = queryMock.mock.calls[0];
      expect(firstCallArgs[1]).toEqual([]);
    });

    it('includes member join for non-global roles (project_manager)', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'project_manager');

      // For non-global roles, member params should include userId
      const firstCallArgs = queryMock.mock.calls[0];
      expect(firstCallArgs[1]).toEqual(['user-1']);
    });

    it('includes member join for team_member role', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'team_member');

      // For team_member (non-global + restricted): member params include userId
      const firstCallArgs = queryMock.mock.calls[0];
      expect(firstCallArgs[1]).toEqual(['user-1']);
    });

    it('uses portfolio scope override to get global view for non-global role', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'project_manager', 'portfolio');

      // portfolio scope makes it global, so no member params
      const firstCallArgs = queryMock.mock.calls[0];
      expect(firstCallArgs[1]).toEqual([]);
    });

    it('includes resource info in tasks for manager roles', async () => {
      const tasks = [
        { id: 't-1', name: 'Task 1', projectName: 'P', projectId: 'p-1', projectCode: 'PC', scheduleId: 's-1', sortOrder: 1, priority: 'high', resourceName: 'Alice' },
      ];
      setupDefaultResults({ 3: tasks });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.tasksDueToday[0].resourceName).toBe('Alice');
    });

    it('does not show resource names for RAID blocked tasks for non-manager roles', async () => {
      const blocked = [
        { id: 't-10', name: 'Deploy', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', scheduleId: 's-1', sortOrder: 5, blockedByName: 'QA', resourceName: 'Secret Person' },
      ];
      setupDefaultResults({ 9: blocked });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'viewer');

      // viewer is not a manager role, so resourceName should be undefined
      expect(result.raidWatch[0].resourceName).toBeUndefined();
    });

    it('shows resource names for RAID action items for manager roles', async () => {
      const actions = [
        { id: 'a-1', description: 'Action', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', overdueDays: 1, resourceName: 'Alice' },
      ];
      setupDefaultResults({ 8: actions });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'project_manager');

      expect(result.raidWatch[0].resourceName).toBe('Alice');
    });

    it('restricted roles (viewer) get assigned join params for task queries', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'viewer');

      // For the dueToday query (3rd query call, index 2):
      // restricted roles add userId as assignedParams before memberParams
      // dueToday params: [...assignedParams, ...memberParams] = ['user-1', 'user-1']
      const dueTodayCallArgs = queryMock.mock.calls[2];
      expect(dueTodayCallArgs[1]).toEqual(['user-1', 'user-1']);
    });

    it('restricted roles include action assigned filter params', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'team_member');

      // overdueActions query (index 7 in query calls):
      // params: [...memberParams, ...actionAssignedParams] = ['user-1', 'user-1']
      const overdueActionsCallArgs = queryMock.mock.calls[7];
      expect(overdueActionsCallArgs[1]).toEqual(['user-1', 'user-1']);
    });

    it('restricted roles include owner filter for open issues', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'viewer');

      // openIssues query (index 9 in query calls, last one):
      // params: [...memberParams, ...(isRestricted ? [userId] : [])] = ['user-1', 'user-1']
      const openIssuesCallArgs = queryMock.mock.calls[9];
      expect(openIssuesCallArgs[1]).toEqual(['user-1', 'user-1']);
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty proposals result array', async () => {
      setupDefaultResults({ 0: [] });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.pendingProposals).toBe(0);
    });

    it('handles null cnt in proposals', async () => {
      setupDefaultResults({ 0: [{ cnt: null }] });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.pendingProposals).toBe(0);
    });

    it('handles undefined cnt in proposals', async () => {
      setupDefaultResults({ 0: [{}] });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(result.actionItems.pendingProposals).toBe(0);
    });

    it('handles action item with empty string description', async () => {
      const actions = [
        { id: 'a-4', description: '', due_date: '2026-09-10', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', overdueDays: 1, resourceName: null },
      ];
      setupDefaultResults({ 8: actions });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      // empty string is falsy, so fallback to 'Action item'
      expect(result.raidWatch[0].label).toBe('Action item');
    });

    it('handles resourceName as null in RAID items for manager roles', async () => {
      const actions = [
        { id: 'a-5', description: 'Test', projectId: 'p-1', projectName: 'P1', projectCode: 'P1', overdueDays: 1, resourceName: null },
      ];
      setupDefaultResults({ 8: actions });

      const result = await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      // null resourceName with showResource=true → (null || undefined) → undefined
      expect(result.raidWatch[0].resourceName).toBeUndefined();
    });

    it('makes exactly 10 tenant queries and 1 control plane query', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-1', 'admin');

      expect(queryMock).toHaveBeenCalledTimes(10);
      expect(queryControlPlaneMock).toHaveBeenCalledTimes(1);
    });

    it('passes userId to control plane notifications query', async () => {
      setupDefaultResults();

      await dailyBriefingService.getDailyBriefing('user-42', 'admin');

      expect(queryControlPlaneMock).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        ['user-42']
      );
    });
  });

  // ── Error Handling ───────────────────────────────────────────────────

  describe('error handling', () => {
    it('propagates database errors', async () => {
      queryMock.mockRejectedValue(new Error('DB connection lost'));
      queryControlPlaneMock.mockResolvedValue([]);

      await expect(
        dailyBriefingService.getDailyBriefing('user-1', 'admin')
      ).rejects.toThrow('DB connection lost');
    });

    it('propagates control plane query errors', async () => {
      queryMock.mockResolvedValue([]);
      queryControlPlaneMock.mockRejectedValue(new Error('Control plane down'));

      await expect(
        dailyBriefingService.getDailyBriefing('user-1', 'admin')
      ).rejects.toThrow('Control plane down');
    });
  });
});
