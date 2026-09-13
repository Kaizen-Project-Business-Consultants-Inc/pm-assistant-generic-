import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock functions (vi.mock is hoisted, so references must use vi.hoisted)
// ---------------------------------------------------------------------------

const {
  mockFindTasksByScheduleId,
  mockFindScheduleById,
  mockUpdateTask,
  mockLogActivity,
  mockCalculateCriticalPath,
  mockRepoInsert,
  mockRepoFindById,
  mockRepoFindBySchedule,
  mockRepoUpdateStatus,
  mockRepoUpdateProposalData,
  mockIsAvailable,
  mockComplete,
  mockAuditAppend,
} = vi.hoisted(() => ({
  mockFindTasksByScheduleId: vi.fn(),
  mockFindScheduleById: vi.fn(),
  mockUpdateTask: vi.fn(),
  mockLogActivity: vi.fn(),
  mockCalculateCriticalPath: vi.fn(),
  mockRepoInsert: vi.fn().mockResolvedValue(undefined),
  mockRepoFindById: vi.fn(),
  mockRepoFindBySchedule: vi.fn(),
  mockRepoUpdateStatus: vi.fn().mockResolvedValue(undefined),
  mockRepoUpdateProposalData: vi.fn().mockResolvedValue(undefined),
  mockIsAvailable: vi.fn(),
  mockComplete: vi.fn(),
  mockAuditAppend: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../services/ScheduleService', () => ({
  ScheduleService: vi.fn().mockImplementation(() => ({
    findTasksByScheduleId: mockFindTasksByScheduleId,
    findById: mockFindScheduleById,
    updateTask: mockUpdateTask,
    logActivity: mockLogActivity,
  })),
}));

vi.mock('../../services/CriticalPathService', () => ({
  CriticalPathService: vi.fn().mockImplementation(() => ({
    calculateCriticalPath: mockCalculateCriticalPath,
  })),
}));

vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: mockIsAvailable,
    completeWithJsonSchema: mockComplete,
  },
}));

vi.mock('../../config', () => ({
  config: { AI_ENABLED: false },
}));

vi.mock('../../database/RescheduleProposalRepository', () => ({
  rescheduleProposalRepository: {
    insert: mockRepoInsert,
    findById: mockRepoFindById,
    findBySchedule: mockRepoFindBySchedule,
    updateStatus: mockRepoUpdateStatus,
    updateProposalData: mockRepoUpdateProposalData,
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-proposal-id'),
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: mockAuditAppend,
  },
}));

vi.mock('../../services/DeadLetterService', () => ({
  deadLetterService: { capture: vi.fn() },
}));

vi.mock('../../utils/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/promptSanitizer', () => ({
  sanitizeForPrompt: vi.fn((s: string) => s),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { AutoRescheduleService } from '../../services/AutoRescheduleService';
import { config } from '../../config';
import type { Task } from '../../services/ScheduleService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function makeTask(id: string, name: string, opts: {
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  progressPercentage?: number;
  dependencies?: Array<{ dependencyId: string; dependencyType?: string; lagDays?: number }>;
  priority?: string;
  dependency?: string | null;
  estimatedDays?: number;
} = {}): Task {
  return {
    id,
    scheduleId: 'sch-1',
    name,
    status: (opts.status ?? 'in_progress') as any,
    priority: (opts.priority ?? 'medium') as any,
    taskType: 'task',
    startDate: opts.startDate ?? null,
    endDate: opts.endDate ?? null,
    progressPercentage: opts.progressPercentage ?? 0,
    dependencies: opts.dependencies ?? [],
    dependency: opts.dependency ?? null,
    estimatedDays: opts.estimatedDays ?? undefined,
  } as Task;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString().split('T')[0];
}

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * DAY_MS).toISOString().split('T')[0];
}

function makeCriticalPathResult(criticalIds: string[] = []) {
  return {
    criticalPathTaskIds: criticalIds,
    tasks: [],
    projectDuration: 30,
  };
}

function makeProposalRow(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'prop-1',
    schedule_id: 'sch-1',
    status: 'pending',
    proposal_data: JSON.stringify({
      delayedTasks: [],
      proposedChanges: [
        {
          taskId: 't1',
          taskName: 'Task 1',
          currentStartDate: '2026-01-01',
          currentEndDate: '2026-01-10',
          proposedStartDate: '2026-01-01',
          proposedEndDate: '2026-01-15',
          reason: 'Delayed',
        },
      ],
      rationale: 'Test rationale',
      estimatedImpact: {
        originalEndDate: '2026-01-10',
        proposedEndDate: '2026-01-15',
        daysChange: 5,
        criticalPathImpact: 'None',
      },
    }),
    source: 'manual',
    feedback: null,
    created_at: '2026-01-01 00:00:00',
  };
  return { ...defaults, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutoRescheduleService', () => {
  let service: AutoRescheduleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AutoRescheduleService();
    (config as any).AI_ENABLED = false;
    mockIsAvailable.mockReturnValue(false);
    mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
    mockFindTasksByScheduleId.mockResolvedValue([]);
    mockFindScheduleById.mockResolvedValue(null);
    mockUpdateTask.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);
    mockRepoInsert.mockResolvedValue(undefined);
    mockRepoUpdateStatus.mockResolvedValue(undefined);
    mockRepoUpdateProposalData.mockResolvedValue(undefined);
  });

  // =========================================================================
  // detectDelays
  // =========================================================================

  describe('detectDelays', () => {
    it('returns empty array when there are no tasks', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([]);
      const result = await service.detectDelays('sch-1');
      expect(result).toEqual([]);
    });

    it('skips completed and cancelled tasks', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Completed', { status: 'completed', startDate: daysAgo(20), endDate: daysAgo(5), progressPercentage: 50 }),
        makeTask('t2', 'Cancelled', { status: 'cancelled', startDate: daysAgo(20), endDate: daysAgo(5), progressPercentage: 0 }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result).toEqual([]);
    });

    it('skips tasks with no start or end date', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'No dates', { startDate: null, endDate: null }),
        makeTask('t2', 'No end', { startDate: daysAgo(10), endDate: null }),
        makeTask('t3', 'No start', { startDate: null, endDate: daysFromNow(5) }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result).toEqual([]);
    });

    it('skips tasks whose start date is in the future', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Future task', {
          startDate: daysFromNow(5),
          endDate: daysFromNow(15),
          progressPercentage: 0,
        }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result).toEqual([]);
    });

    it('skips tasks where totalDuration is zero or negative', async () => {
      const sameDay = daysAgo(1);
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Same day', { startDate: sameDay, endDate: sameDay, progressPercentage: 0 }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result).toEqual([]);
    });

    it('detects a delayed task when progress is more than 10% behind expected', async () => {
      // Task started 10 days ago, ends in 10 days (20 day duration).
      // Expected progress: ~50%. Actual: 10% => behind by 40%.
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Behind task', {
          startDate: daysAgo(10),
          endDate: daysFromNow(10),
          progressPercentage: 10,
        }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result.length).toBe(1);
      expect(result[0].taskId).toBe('t1');
      expect(result[0].taskName).toBe('Behind task');
      expect(result[0].currentProgress).toBe(10);
      expect(result[0].delayDays).toBeGreaterThan(0);
    });

    it('does not flag a task when progress is within 10% of expected', async () => {
      // 10 of 20 days elapsed => ~50% expected. 45% actual => only 5% behind.
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'On track', {
          startDate: daysAgo(10),
          endDate: daysFromNow(10),
          progressPercentage: 45,
        }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result).toEqual([]);
    });

    it('handles zero-progress tasks by estimating double remaining duration', async () => {
      // Started 5 days ago, ends in 5 days. 0% progress.
      // With 0%: estimatedEnd = now + remaining*2 = now + 5*2 = 10 days from now
      // Original end = 5 days from now, delay ~5 days
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Stalled task', {
          startDate: daysAgo(5),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result.length).toBe(1);
      expect(result[0].delayDays).toBeGreaterThanOrEqual(4);
      expect(result[0].delayDays).toBeLessThanOrEqual(6);
    });

    it('projects completion based on current velocity for partial progress', async () => {
      // 10 of 20 days elapsed, 20% progress. Velocity = 10d / 20% = 0.5 d/%.
      // Remaining: 80% * 0.5 = 40 days from now.
      // Delay = 40 - 10 = ~30 days.
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Slow task', {
          startDate: daysAgo(10),
          endDate: daysFromNow(10),
          progressPercentage: 20,
        }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result.length).toBe(1);
      expect(result[0].delayDays).toBeGreaterThan(25);
    });

    it('treats undefined progressPercentage as 0', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'No progress field', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: undefined as any,
        }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result.length).toBe(1);
      expect(result[0].currentProgress).toBe(0);
    });

    describe('severity classification', () => {
      it('assigns critical severity for critical path task with > 14 day delay', async () => {
        mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult(['t1']));
        mockFindTasksByScheduleId.mockResolvedValue([
          makeTask('t1', 'Critical late task', {
            startDate: daysAgo(30),
            endDate: daysFromNow(30),
            progressPercentage: 0,
          }),
        ]);
        const result = await service.detectDelays('sch-1');
        expect(result.length).toBe(1);
        expect(result[0].severity).toBe('critical');
        expect(result[0].isOnCriticalPath).toBe(true);
      });

      it('assigns high severity for critical path task with small delay', async () => {
        mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult(['t1']));
        // 8 of 10 days elapsed, 40% progress. Expected: 80%. Behind by 40%.
        // Velocity: 8/40 = 0.2 d/%, remaining: 60% * 0.2 = 12 days.
        // Delay = 12 - 2 = 10 days. On critical path but <= 14 => high.
        mockFindTasksByScheduleId.mockResolvedValue([
          makeTask('t1', 'Critical small delay', {
            startDate: daysAgo(8),
            endDate: daysFromNow(2),
            progressPercentage: 40,
          }),
        ]);
        const result = await service.detectDelays('sch-1');
        expect(result.length).toBe(1);
        expect(result[0].severity).toBe('high');
      });

      it('assigns high severity for non-critical task with > 21 day delay', async () => {
        mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult([]));
        mockFindTasksByScheduleId.mockResolvedValue([
          makeTask('t1', 'Very late non-critical', {
            startDate: daysAgo(30),
            endDate: daysFromNow(30),
            progressPercentage: 0,
          }),
        ]);
        const result = await service.detectDelays('sch-1');
        expect(result.length).toBe(1);
        expect(result[0].severity).toBe('high');
        expect(result[0].isOnCriticalPath).toBe(false);
      });

      it('assigns medium severity for 7-21 day delay on non-critical path', async () => {
        mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult([]));
        // 5 of 10 days, 20% progress. Expected: 50%. Behind by 30%.
        // Velocity: 5/20 = 0.25 d/%, remaining: 80% * 0.25 = 20 days
        // Delay = 20 - 5 = 15 days => medium
        mockFindTasksByScheduleId.mockResolvedValue([
          makeTask('t1', 'Medium delay', {
            startDate: daysAgo(5),
            endDate: daysFromNow(5),
            progressPercentage: 20,
          }),
        ]);
        const result = await service.detectDelays('sch-1');
        expect(result.length).toBe(1);
        expect(result[0].severity).toBe('medium');
      });

      it('assigns low severity for <= 7 day delay on non-critical path', async () => {
        mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult([]));
        // 8 of 10 days, 65% progress. Expected: 80%. Behind by 15%.
        // Velocity: 8/65 = 0.123 d/%, remaining: 35% * 0.123 = 4.3 days
        // Delay = 4.3 - 2 = ~3 days => low
        mockFindTasksByScheduleId.mockResolvedValue([
          makeTask('t1', 'Small delay', {
            startDate: daysAgo(8),
            endDate: daysFromNow(2),
            progressPercentage: 65,
          }),
        ]);
        const result = await service.detectDelays('sch-1');
        expect(result.length).toBe(1);
        expect(result[0].severity).toBe('low');
      });
    });

    it('sorts delayed tasks by severity (critical first)', async () => {
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult(['t1']));
      mockFindTasksByScheduleId.mockResolvedValue([
        // t2: not on critical path, small delay => low (listed first in array)
        makeTask('t2', 'Low', {
          startDate: daysAgo(8),
          endDate: daysFromNow(2),
          progressPercentage: 65,
        }),
        // t1: on critical path, large delay => critical
        makeTask('t1', 'Critical', {
          startDate: daysAgo(30),
          endDate: daysFromNow(30),
          progressPercentage: 0,
        }),
      ]);
      const result = await service.detectDelays('sch-1');
      expect(result.length).toBe(2);
      expect(result[0].severity).toBe('critical');
      expect(result[1].severity).toBe('low');
    });
  });

  // =========================================================================
  // generateProposal — heuristic fallback (AI disabled)
  // =========================================================================

  describe('generateProposal (heuristic fallback)', () => {
    beforeEach(() => {
      (config as any).AI_ENABLED = false;
    });

    it('throws when schedule is not found', async () => {
      mockFindScheduleById.mockResolvedValue(null);
      await expect(service.generateProposal('sch-missing')).rejects.toThrow('Schedule sch-missing not found');
    });

    it('generates proposal with no delays when all tasks are on track', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'On track', {
          startDate: daysAgo(5),
          endDate: daysFromNow(15),
          progressPercentage: 30,
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      expect(proposal.id).toBe('test-proposal-id');
      expect(proposal.scheduleId).toBe('sch-1');
      expect(proposal.status).toBe('pending');
      expect(proposal.delayedTasks).toEqual([]);
      expect(proposal.proposedChanges).toEqual([]);
      expect(proposal.rationale).toContain('No delays detected');
    });

    it('generates proposed date changes for delayed tasks', async () => {
      const endDate = daysFromNow(10);
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Delayed task', {
          startDate: daysAgo(10),
          endDate: daysFromNow(10),
          progressPercentage: 10,
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      expect(proposal.delayedTasks.length).toBe(1);
      expect(proposal.proposedChanges.length).toBeGreaterThanOrEqual(1);
      const change = proposal.proposedChanges[0];
      expect(change.taskId).toBe('t1');
      expect(change.taskName).toBe('Delayed task');
      expect(new Date(change.proposedEndDate).getTime()).toBeGreaterThan(new Date(change.currentEndDate).getTime());
    });

    it('shifts dependent tasks when a predecessor is delayed', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Predecessor', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
        makeTask('t2', 'Dependent', {
          startDate: daysFromNow(6),
          endDate: daysFromNow(16),
          progressPercentage: 0,
          dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 0 }],
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      const depChange = proposal.proposedChanges.find(c => c.taskId === 't2');
      expect(depChange).toBeDefined();
      expect(depChange!.reason).toContain('dependency');
    });

    it('does not shift completed or cancelled dependents', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Predecessor', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
        makeTask('t2', 'Done dependent', {
          status: 'completed',
          startDate: daysFromNow(6),
          endDate: daysFromNow(16),
          dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 0 }],
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      const depChange = proposal.proposedChanges.find(c => c.taskId === 't2');
      expect(depChange).toBeUndefined();
    });

    it('does not duplicate dependents already in proposedChanges', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Delayed A', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
        makeTask('t2', 'Delayed B', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
        makeTask('t3', 'Shared dependent', {
          startDate: daysFromNow(6),
          endDate: daysFromNow(16),
          progressPercentage: 0,
          dependencies: [
            { dependencyId: 't1', dependencyType: 'FS', lagDays: 0 },
            { dependencyId: 't2', dependencyType: 'FS', lagDays: 0 },
          ],
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      const t3Changes = proposal.proposedChanges.filter(c => c.taskId === 't3');
      expect(t3Changes.length).toBeLessThanOrEqual(1);
    });

    it('calculates estimatedImpact with correct daysChange', async () => {
      const originalEnd = daysFromNow(10);
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: originalEnd });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Late task', {
          startDate: daysAgo(10),
          endDate: daysFromNow(10),
          progressPercentage: 0,
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      expect(proposal.estimatedImpact.originalEndDate).toBe(new Date(originalEnd).toISOString().split('T')[0]);
      expect(proposal.estimatedImpact.daysChange).toBeGreaterThan(0);
    });

    it('persists proposal to the database', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([]);

      await service.generateProposal('sch-1');
      expect(mockRepoInsert).toHaveBeenCalledWith(
        'test-proposal-id',
        'sch-1',
        expect.any(String),
        'manual',
        expect.any(String),
      );
    });

    it('continues gracefully if DB insert fails', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([]);
      mockRepoInsert.mockRejectedValueOnce(new Error('DB down'));

      const proposal = await service.generateProposal('sch-1');
      expect(proposal).toBeDefined();
      expect(proposal.id).toBe('test-proposal-id');
    });

    it('logs activity when userId is provided and proposedChanges exist', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Late task', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
      ]);

      await service.generateProposal('sch-1', 'user-1');
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.any(String),
        'user-1',
        'System',
        'auto-reschedule-proposed',
        'proposal',
        undefined,
        expect.stringContaining('Proposal'),
      );
    });

    it('does not log activity when there are no proposed changes', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([]);

      await service.generateProposal('sch-1', 'user-1');
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it('passes source parameter to repository insert', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([]);

      await service.generateProposal('sch-1', undefined, 'agent');
      expect(mockRepoInsert).toHaveBeenCalledWith(
        expect.any(String),
        'sch-1',
        expect.any(String),
        'agent',
        expect.any(String),
      );
    });

    it('includes critical path impact text when critical path is affected', async () => {
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult(['t1']));
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Critical delayed', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      expect(proposal.estimatedImpact.criticalPathImpact).toContain('Critical path is affected');
    });

    it('includes non-critical impact text when critical path is not affected', async () => {
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult([]));
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Non-critical delayed', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      expect(proposal.estimatedImpact.criticalPathImpact).toContain('not directly affected');
    });
  });

  // =========================================================================
  // generateProposal — AI-powered
  // =========================================================================

  describe('generateProposal (AI-powered)', () => {
    beforeEach(() => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);
    });

    it('uses AI when enabled and delays exist', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Delayed', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
      ]);
      mockComplete.mockResolvedValue({
        data: {
          proposedChanges: [
            {
              taskId: 't1',
              taskName: 'Delayed',
              proposedStartDate: daysAgo(10),
              proposedEndDate: daysFromNow(15),
              reason: 'AI reason',
            },
          ],
          rationale: 'AI rationale',
          estimatedImpact: {
            proposedEndDate: daysFromNow(15),
            daysChange: 10,
            criticalPathImpact: 'Extended',
          },
        },
      });

      const proposal = await service.generateProposal('sch-1');
      expect(mockComplete).toHaveBeenCalledOnce();
      expect(proposal.rationale).toBe('AI rationale');
      expect(proposal.proposedChanges[0].reason).toBe('AI reason');
      expect(proposal.estimatedImpact.daysChange).toBe(10);
    });

    it('falls back to heuristic when AI is enabled but no delays detected', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'On track', {
          startDate: daysAgo(5),
          endDate: daysFromNow(15),
          progressPercentage: 30,
        }),
      ]);

      const proposal = await service.generateProposal('sch-1');
      expect(mockComplete).not.toHaveBeenCalled();
      expect(proposal.rationale).toContain('No delays detected');
    });

    it('maps AI proposed changes with current dates from task data', async () => {
      const start = daysAgo(10);
      const end = daysFromNow(5);
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Delayed', {
          startDate: start,
          endDate: end,
          progressPercentage: 0,
        }),
      ]);
      mockComplete.mockResolvedValue({
        data: {
          proposedChanges: [
            { taskId: 't1', taskName: 'Delayed', proposedStartDate: start, proposedEndDate: daysFromNow(15), reason: 'R' },
          ],
          rationale: 'R',
          estimatedImpact: { proposedEndDate: daysFromNow(15), daysChange: 10, criticalPathImpact: 'X' },
        },
      });

      const proposal = await service.generateProposal('sch-1');
      expect(proposal.proposedChanges[0].currentStartDate).toBe(new Date(start).toISOString().split('T')[0]);
      expect(proposal.proposedChanges[0].currentEndDate).toBe(new Date(end).toISOString().split('T')[0]);
    });

    it('handles AI response with unknown taskId gracefully', async () => {
      mockFindScheduleById.mockResolvedValue({ id: 'sch-1', name: 'Test', endDate: daysFromNow(30) });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Delayed', {
          startDate: daysAgo(10),
          endDate: daysFromNow(5),
          progressPercentage: 0,
        }),
      ]);
      mockComplete.mockResolvedValue({
        data: {
          proposedChanges: [
            { taskId: 'unknown-id', taskName: 'Ghost', proposedStartDate: '2026-01-01', proposedEndDate: '2026-01-15', reason: 'R' },
          ],
          rationale: 'R',
          estimatedImpact: { proposedEndDate: daysFromNow(15), daysChange: 10, criticalPathImpact: 'X' },
        },
      });

      const proposal = await service.generateProposal('sch-1');
      // Should still produce the proposal; currentStartDate/currentEndDate will be empty
      expect(proposal.proposedChanges[0].taskId).toBe('unknown-id');
      expect(proposal.proposedChanges[0].currentStartDate).toBe('');
      expect(proposal.proposedChanges[0].currentEndDate).toBe('');
    });
  });

  // =========================================================================
  // acceptProposal
  // =========================================================================

  describe('acceptProposal', () => {
    it('returns false when proposal is not found', async () => {
      mockRepoFindById.mockResolvedValue(null);
      const result = await service.acceptProposal('nonexistent');
      expect(result).toBe(false);
    });

    it('returns false when proposal is not pending', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow({ status: 'accepted' }));
      const result = await service.acceptProposal('prop-1');
      expect(result).toBe(false);
    });

    it('applies proposed changes and updates task dates', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      const result = await service.acceptProposal('prop-1');

      expect(result).toBe(true);
      expect(mockUpdateTask).toHaveBeenCalledWith('t1', {
        startDate: '2026-01-01',
        endDate: '2026-01-15',
      });
    });

    it('logs activity for each proposed change', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      await service.acceptProposal('prop-1');

      expect(mockLogActivity).toHaveBeenCalledWith(
        't1',
        '1',
        'System',
        'auto-rescheduled',
        'dates',
        '2026-01-01 - 2026-01-10',
        '2026-01-01 - 2026-01-15',
      );
    });

    it('appends audit ledger entry for each change', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      await service.acceptProposal('prop-1');

      expect(mockAuditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          action: 'schedule.auto_reschedule',
          entityType: 'task',
          entityId: 't1',
        }),
      );
    });

    it('updates proposal status to accepted in DB', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      await service.acceptProposal('prop-1');
      expect(mockRepoUpdateStatus).toHaveBeenCalledWith('prop-1', 'accepted');
    });

    it('continues gracefully if DB status update fails', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      mockRepoUpdateStatus.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.acceptProposal('prop-1');
      expect(result).toBe(true);
    });

    it('applies all changes for multi-task proposals', async () => {
      const row = makeProposalRow({
        proposal_data: JSON.stringify({
          delayedTasks: [],
          proposedChanges: [
            { taskId: 't1', taskName: 'T1', currentStartDate: '2026-01-01', currentEndDate: '2026-01-10', proposedStartDate: '2026-01-01', proposedEndDate: '2026-01-15', reason: 'R1' },
            { taskId: 't2', taskName: 'T2', currentStartDate: '2026-01-11', currentEndDate: '2026-01-20', proposedStartDate: '2026-01-16', proposedEndDate: '2026-01-25', reason: 'R2' },
          ],
          rationale: 'Multi',
          estimatedImpact: { originalEndDate: '2026-01-20', proposedEndDate: '2026-01-25', daysChange: 5, criticalPathImpact: 'N' },
        }),
      });
      mockRepoFindById.mockResolvedValue(row);

      await service.acceptProposal('prop-1');
      expect(mockUpdateTask).toHaveBeenCalledTimes(2);
      expect(mockLogActivity).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // rejectProposal
  // =========================================================================

  describe('rejectProposal', () => {
    it('returns false when proposal is not found', async () => {
      mockRepoFindById.mockResolvedValue(null);
      const result = await service.rejectProposal('nonexistent');
      expect(result).toBe(false);
    });

    it('returns false when proposal is not pending', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow({ status: 'accepted' }));
      const result = await service.rejectProposal('prop-1');
      expect(result).toBe(false);
    });

    it('updates status to rejected in DB', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      const result = await service.rejectProposal('prop-1');
      expect(result).toBe(true);
      expect(mockRepoUpdateStatus).toHaveBeenCalledWith('prop-1', 'rejected', undefined);
    });

    it('stores feedback when provided', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      const result = await service.rejectProposal('prop-1', 'Not appropriate');
      expect(result).toBe(true);
      expect(mockRepoUpdateStatus).toHaveBeenCalledWith('prop-1', 'rejected', 'Not appropriate');
    });

    it('continues gracefully if DB update fails', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      mockRepoUpdateStatus.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.rejectProposal('prop-1');
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // modifyProposal
  // =========================================================================

  describe('modifyProposal', () => {
    const modifications = [
      {
        taskId: 't1',
        taskName: 'Task 1',
        currentStartDate: '2026-01-01',
        currentEndDate: '2026-01-10',
        proposedStartDate: '2026-01-01',
        proposedEndDate: '2026-01-20',
        reason: 'Modified by user',
      },
    ];

    it('returns false when proposal is not found', async () => {
      mockRepoFindById.mockResolvedValue(null);
      const result = await service.modifyProposal('nonexistent', modifications);
      expect(result).toBe(false);
    });

    it('returns false when proposal is not pending', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow({ status: 'rejected' }));
      const result = await service.modifyProposal('prop-1', modifications);
      expect(result).toBe(false);
    });

    it('updates proposal data and sets status to modified', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      const result = await service.modifyProposal('prop-1', modifications);
      expect(result).toBe(true);
      expect(mockRepoUpdateProposalData).toHaveBeenCalledWith(
        'prop-1',
        'modified',
        expect.any(String),
      );
      const storedData = JSON.parse(mockRepoUpdateProposalData.mock.calls[0][2]);
      expect(storedData.proposedChanges).toEqual(modifications);
    });

    it('preserves original rationale and estimatedImpact in stored data', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      await service.modifyProposal('prop-1', modifications);
      const storedData = JSON.parse(mockRepoUpdateProposalData.mock.calls[0][2]);
      expect(storedData.rationale).toBe('Test rationale');
      expect(storedData.estimatedImpact).toBeDefined();
    });

    it('continues gracefully if DB update fails', async () => {
      mockRepoFindById.mockResolvedValue(makeProposalRow());
      mockRepoUpdateProposalData.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.modifyProposal('prop-1', modifications);
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // getProposals
  // =========================================================================

  describe('getProposals', () => {
    it('returns proposals for a schedule', async () => {
      mockRepoFindBySchedule.mockResolvedValue([makeProposalRow()]);
      const proposals = await service.getProposals('sch-1');
      expect(proposals.length).toBe(1);
      expect(proposals[0].id).toBe('prop-1');
      expect(proposals[0].scheduleId).toBe('sch-1');
      expect(proposals[0].status).toBe('pending');
    });

    it('returns empty array when DB read fails', async () => {
      mockRepoFindBySchedule.mockRejectedValue(new Error('DB error'));
      const proposals = await service.getProposals('sch-1');
      expect(proposals).toEqual([]);
    });

    it('handles malformed proposal_data JSON gracefully', async () => {
      mockRepoFindBySchedule.mockResolvedValue([
        makeProposalRow({ proposal_data: 'not valid json' }),
      ]);
      const proposals = await service.getProposals('sch-1');
      expect(proposals.length).toBe(1);
      expect(proposals[0].rationale).toBe('Parse error');
      expect(proposals[0].delayedTasks).toEqual([]);
      expect(proposals[0].proposedChanges).toEqual([]);
    });

    it('returns empty array when no proposals exist', async () => {
      mockRepoFindBySchedule.mockResolvedValue([]);
      const proposals = await service.getProposals('sch-1');
      expect(proposals).toEqual([]);
    });
  });

  // =========================================================================
  // rowToProposal edge cases (tested via getProposals)
  // =========================================================================

  describe('rowToProposal edge cases', () => {
    it('sets defaults for missing fields in proposal_data', async () => {
      mockRepoFindBySchedule.mockResolvedValue([
        makeProposalRow({ proposal_data: JSON.stringify({}) }),
      ]);
      const proposals = await service.getProposals('sch-1');
      expect(proposals[0].delayedTasks).toEqual([]);
      expect(proposals[0].proposedChanges).toEqual([]);
      expect(proposals[0].rationale).toBe('');
      expect(proposals[0].estimatedImpact).toEqual({
        originalEndDate: '',
        proposedEndDate: '',
        daysChange: 0,
        criticalPathImpact: '',
      });
    });

    it('maps feedback from row to proposal', async () => {
      mockRepoFindBySchedule.mockResolvedValue([
        makeProposalRow({ feedback: 'User feedback here' }),
      ]);
      const proposals = await service.getProposals('sch-1');
      expect(proposals[0].feedback).toBe('User feedback here');
    });

    it('sets feedback to undefined when null in row', async () => {
      mockRepoFindBySchedule.mockResolvedValue([
        makeProposalRow({ feedback: null }),
      ]);
      const proposals = await service.getProposals('sch-1');
      expect(proposals[0].feedback).toBeUndefined();
    });

    it('handles multiple proposals in sequence', async () => {
      mockRepoFindBySchedule.mockResolvedValue([
        makeProposalRow({ id: 'prop-1', status: 'accepted' }),
        makeProposalRow({ id: 'prop-2', status: 'pending' }),
        makeProposalRow({ id: 'prop-3', status: 'rejected', feedback: 'Rejected' }),
      ]);
      const proposals = await service.getProposals('sch-1');
      expect(proposals.length).toBe(3);
      expect(proposals[0].status).toBe('accepted');
      expect(proposals[1].status).toBe('pending');
      expect(proposals[2].status).toBe('rejected');
      expect(proposals[2].feedback).toBe('Rejected');
    });
  });
});
