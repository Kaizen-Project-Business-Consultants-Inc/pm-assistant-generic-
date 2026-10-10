import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor } from '../../../services/agents/ActionExecutor';

// Mock all dependencies
vi.mock('../../../services/agents/ActionProposalService', () => ({
  actionProposalService: {
    registerAutoExecutor: vi.fn(),
    getById: vi.fn(),
    getActions: vi.fn(),
    updateStatus: vi.fn(),
    updateActionStatus: vi.fn(),
  },
}));

vi.mock('../../../services/ScheduleService', () => ({
  scheduleService: {
    updateTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
  },
}));

vi.mock('../../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../services/NotificationService', () => ({
  notificationService: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../services/DeadLetterService', () => ({
  deadLetterService: {
    capture: vi.fn(),
  },
}));

// Which tasks are in which project (the proposal's tasks must all be in its own project)
// outside: tasks in another project; gone: tasks deleted since (neither in this project nor another)
const taskProject = vi.hoisted(() => ({ outside: new Set<string>(), gone: new Set<string>() }));
vi.mock('../../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async (sql: string, params: string[]) => {
      const ids = params.slice(0, -1).filter(id => !taskProject.gone.has(id));
      const other = sql.includes('project_id <> ?');
      return [{ n: ids.filter(id => taskProject.outside.has(id) === other).length }];
    }),
  },
}));

describe('ActionExecutor', () => {
  let executor: ActionExecutor;

  beforeEach(() => {
    executor = new ActionExecutor();
    vi.clearAllMocks();
  });

  it('returns error when proposal not found', async () => {
    const { actionProposalService } = await import('../../../services/agents/ActionProposalService');
    vi.mocked(actionProposalService.getById).mockResolvedValue(null);

    const result = await executor.execute('missing-id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Proposal not found');
  });

  it('returns error when proposal not approved', async () => {
    const { actionProposalService } = await import('../../../services/agents/ActionProposalService');
    vi.mocked(actionProposalService.getById).mockResolvedValue({
      id: 'p1',
      status: 'pending',
      actions: [],
    } as any);

    const result = await executor.execute('p1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('pending');
  });

  it('executes all actions successfully', async () => {
    const { actionProposalService } = await import('../../../services/agents/ActionProposalService');
    const { scheduleService } = await import('../../../services/ScheduleService');
    const { auditLedgerService } = await import('../../../services/AuditLedgerService');

    vi.mocked(actionProposalService.getById).mockResolvedValue({
      id: 'p1',
      projectId: 'proj-1',
      agentId: 'schedule-recovery-v1',
      status: 'approved',
      title: 'Test',
      createdBy: 'user-1',
      actions: [
        {
          id: 'a1',
          proposalId: 'p1',
          executionOrder: 1,
          actionType: 'update_task_dates',
          targetEntityType: 'task',
          targetEntityId: 'task-1',
          oldValue: { endDate: '2026-07-01' },
          newValue: { endDate: '2026-07-05' },
          status: 'pending',
        },
        {
          id: 'a2',
          proposalId: 'p1',
          executionOrder: 2,
          actionType: 'update_progress',
          targetEntityType: 'task',
          targetEntityId: 'task-2',
          oldValue: { progressPercentage: 50 },
          newValue: { progressPercentage: 75 },
          status: 'pending',
        },
      ],
    } as any);

    const result = await executor.execute('p1');

    expect(result.success).toBe(true);
    expect(result.actionsExecuted).toBe(2);
    expect(result.actionsFailed).toBe(0);
    expect(result.actionsRolledBack).toBe(0);
    expect(vi.mocked(scheduleService.updateTask)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(actionProposalService.updateStatus)).toHaveBeenCalledWith('p1', 'executed');
    expect(vi.mocked(auditLedgerService.append)).toHaveBeenCalled();
  });

  it('rolls back on failure', async () => {
    const { actionProposalService } = await import('../../../services/agents/ActionProposalService');
    const { scheduleService } = await import('../../../services/ScheduleService');

    vi.mocked(actionProposalService.getById).mockResolvedValue({
      id: 'p1',
      projectId: 'proj-1',
      agentId: 'test',
      status: 'approved',
      title: 'Test',
      createdBy: 'user-1',
      actions: [
        {
          id: 'a1',
          executionOrder: 1,
          actionType: 'update_task_dates',
          targetEntityType: 'task',
          targetEntityId: 'task-1',
          oldValue: { endDate: '2026-07-01' },
          newValue: { endDate: '2026-07-05' },
          status: 'pending',
        },
        {
          id: 'a2',
          executionOrder: 2,
          actionType: 'update_task_dates',
          targetEntityType: 'task',
          targetEntityId: 'task-2',
          oldValue: { endDate: '2026-07-10' },
          newValue: { endDate: '2026-07-15' },
          status: 'pending',
        },
      ],
    } as any);

    // First call succeeds, second fails
    vi.mocked(scheduleService.updateTask)
      .mockResolvedValueOnce({ id: 'task-1' } as any)
      .mockRejectedValueOnce(new Error('Task not found'));

    const result = await executor.execute('p1');

    expect(result.success).toBe(false);
    expect(result.actionsExecuted).toBe(1);
    expect(result.actionsFailed).toBe(1);
    expect(result.actionsRolledBack).toBe(1);
    expect(result.error).toBe('Task not found');

    // Verify rollback was called with old values for action 1
    expect(vi.mocked(scheduleService.updateTask)).toHaveBeenCalledTimes(3); // exec1, exec2(fail), rollback1
    expect(vi.mocked(actionProposalService.updateStatus)).toHaveBeenCalledWith('p1', 'failed');
  });

  it('handles empty actions list', async () => {
    const { actionProposalService } = await import('../../../services/agents/ActionProposalService');
    vi.mocked(actionProposalService.getById).mockResolvedValue({
      id: 'p1',
      status: 'approved',
      actions: [],
    } as any);

    const result = await executor.execute('p1');
    expect(result.success).toBe(true);
    expect(result.actionsExecuted).toBe(0);
  });

  it('refuses a proposal whose actions change a task of another project; nothing runs (2026-10-09 audit)', async () => {
    const { actionProposalService } = await import('../../../services/agents/ActionProposalService');
    const { scheduleService } = await import('../../../services/ScheduleService');
    taskProject.outside = new Set(['task-of-B']);
    vi.mocked(actionProposalService.getById).mockResolvedValue({
      id: 'p1', projectId: 'proj-A', status: 'approved', title: 'T', createdBy: 'u1',
      actions: [
        { id: 'a1', actionType: 'update_progress', targetEntityType: 'task', targetEntityId: 'task-of-A', newValue: { progressPercentage: 50 }, executionOrder: 1, status: 'pending' },
        { id: 'a2', actionType: 'update_progress', targetEntityType: 'task', targetEntityId: 'task-of-B', newValue: { progressPercentage: 50 }, executionOrder: 2, status: 'pending' },
      ],
    } as any);
    const result = await executor.execute('p1');
    taskProject.outside = new Set();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside its own project/);
    expect(scheduleService.updateTask).not.toHaveBeenCalled();
    expect(actionProposalService.updateStatus).not.toHaveBeenCalled();
  });

  describe('undoing a proposal (2026-10-10 review)', () => {
    const executed = (taskId: string) => ({
      id: 'p2', projectId: 'proj-A', status: 'executed', title: 'T', createdBy: 'u1',
      actions: [{ id: 'a1', actionType: 'update_progress', targetEntityType: 'task', targetEntityId: taskId, oldValue: { progressPercentage: 10 }, newValue: { progressPercentage: 50 }, executionOrder: 1, status: 'executed' }],
    });

    it('a task deleted since does not block the undo', async () => {
      const { actionProposalService } = await import('../../../services/agents/ActionProposalService');
      vi.mocked(actionProposalService.getById).mockResolvedValue(executed('task-deleted') as any);
      taskProject.gone = new Set(['task-deleted']);
      const result = await executor.rollbackProposal('p2');
      taskProject.gone = new Set();
      expect(result.error).toBeUndefined();
      expect(actionProposalService.updateStatus).toHaveBeenCalledWith('p2', 'rolled_back');
    });

    it('a task that now lies in another project refuses the undo; nothing is changed', async () => {
      const { actionProposalService } = await import('../../../services/agents/ActionProposalService');
      const { scheduleService } = await import('../../../services/ScheduleService');
      vi.mocked(actionProposalService.getById).mockResolvedValue(executed('task-of-B') as any);
      taskProject.outside = new Set(['task-of-B']);
      const result = await executor.rollbackProposal('p2');
      taskProject.outside = new Set();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside its own project/);
      expect(scheduleService.updateTask).not.toHaveBeenCalled();
      expect(actionProposalService.updateStatus).not.toHaveBeenCalled();
    });
  });
});
