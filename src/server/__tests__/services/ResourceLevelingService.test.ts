import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockFindTasksByScheduleId = vi.fn();
const mockFindTaskById = vi.fn();
const mockUpdateTask = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: (...args: any[]) => mockFindTasksByScheduleId(...args),
    findTaskById: (...args: any[]) => mockFindTaskById(...args),
    updateTask: (...args: any[]) => mockUpdateTask(...args),
  },
}));

const mockCalculateCriticalPath = vi.fn();
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: {
    calculateCriticalPath: (...args: any[]) => mockCalculateCriticalPath(...args),
  },
}));

const mockFindAllResources = vi.fn();
vi.mock('../../services/ResourceService', () => ({
  resourceService: {
    findAllResources: (...args: any[]) => mockFindAllResources(...args),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ResourceLevelingService } from '../../services/ResourceLevelingService';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTask(id: string, name: string, opts: {
  assignedTo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
  scheduleId?: string;
  description?: string;
} = {}) {
  return {
    id,
    scheduleId: opts.scheduleId ?? 'sch-1',
    name,
    assignedTo: opts.assignedTo !== undefined ? opts.assignedTo : 'Alice',
    startDate: opts.startDate !== undefined ? opts.startDate : '2026-01-05',
    endDate: opts.endDate !== undefined ? opts.endDate : '2026-01-07',
    status: opts.status ?? 'in_progress',
    priority: 'medium' as const,
    taskType: 'task' as const,
    description: opts.description ?? '',
  };
}

function makeCPMTask(taskId: string, opts: {
  totalFloat?: number;
  freeFloat?: number;
  isCritical?: boolean;
} = {}) {
  return {
    taskId,
    name: `Task ${taskId}`,
    duration: 2,
    ES: 0,
    EF: 2,
    LS: opts.totalFloat ?? 0,
    LF: (opts.totalFloat ?? 0) + 2,
    totalFloat: opts.totalFloat ?? 0,
    freeFloat: opts.freeFloat ?? 0,
    isCritical: opts.isCritical ?? false,
  };
}

function makeResource(id: string, name: string, opts: {
  isActive?: boolean;
  skills?: any[];
} = {}) {
  return {
    id,
    name,
    role: 'Developer',
    email: `${name.toLowerCase()}@test.com`,
    capacityHoursPerWeek: 40,
    skills: opts.skills ?? [],
    isActive: opts.isActive ?? true,
    costRateHourly: null,
    overtimeRateHourly: null,
    resourceGroup: null,
    userId: null,
    calendarTemplateId: null,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ResourceLevelingService', () => {
  let service: ResourceLevelingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ResourceLevelingService();
  });

  // ── getResourceHistogram ──────────────────────────────────────────

  describe('getResourceHistogram', () => {
    it('returns empty histogram when no tasks exist', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([]);

      const result = await service.getResourceHistogram('sch-1');

      expect(result.resources).toEqual([]);
      expect(result.overAllocations).toEqual([]);
      expect(mockFindTasksByScheduleId).toHaveBeenCalledWith('sch-1');
    });

    it('skips tasks without assignedTo', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', { assignedTo: null }),
      ]);

      const result = await service.getResourceHistogram('sch-1');

      expect(result.resources).toEqual([]);
    });

    it('skips tasks without startDate or endDate', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', { startDate: null }),
        makeTask('t2', 'Task 2', { endDate: null }),
      ]);

      const result = await service.getResourceHistogram('sch-1');

      expect(result.resources).toEqual([]);
    });

    it('skips cancelled and completed tasks', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', { status: 'cancelled' }),
        makeTask('t2', 'Task 2', { status: 'completed' }),
      ]);

      const result = await service.getResourceHistogram('sch-1');

      expect(result.resources).toEqual([]);
    });

    it('calculates demand for a single task spanning multiple days', async () => {
      // Task from Jan 5 to Jan 7 = 2 days of demand
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-07',
        }),
      ]);

      const result = await service.getResourceHistogram('sch-1');

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].resourceName).toBe('Alice');
      expect(result.resources[0].demand).toHaveLength(2);
      expect(result.resources[0].demand[0]).toEqual({ date: '2026-01-05', hours: 8 });
      expect(result.resources[0].demand[1]).toEqual({ date: '2026-01-06', hours: 8 });
      expect(result.overAllocations).toEqual([]);
    });

    it('detects over-allocation when resource has overlapping tasks', async () => {
      // Two tasks for Alice on the same dates
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);

      const result = await service.getResourceHistogram('sch-1');

      expect(result.resources).toHaveLength(1);
      // Both tasks contribute 8h on Jan 5 = 16h total
      expect(result.resources[0].demand[0]).toEqual({ date: '2026-01-05', hours: 16 });
      expect(result.overAllocations).toHaveLength(1);
      expect(result.overAllocations[0]).toEqual({
        resourceName: 'Alice',
        date: '2026-01-05',
        demand: 16,
        capacity: 8,
      });
    });

    it('tracks multiple resources independently', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Bob',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);

      const result = await service.getResourceHistogram('sch-1');

      expect(result.resources).toHaveLength(2);
      const alice = result.resources.find(r => r.resourceName === 'Alice');
      const bob = result.resources.find(r => r.resourceName === 'Bob');
      expect(alice).toBeDefined();
      expect(bob).toBeDefined();
      // No over-allocation since different resources
      expect(result.overAllocations).toEqual([]);
    });

    it('handles same-day start and end (1-day task)', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-05',
        }),
      ]);

      const result = await service.getResourceHistogram('sch-1');

      // daysBetween is 0, max(1,0)=1, so 1 day of demand
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].demand).toHaveLength(1);
      expect(result.resources[0].demand[0]).toEqual({ date: '2026-01-05', hours: 8 });
    });

    it('sorts demand dates chronologically', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-10',
          endDate: '2026-01-11',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);

      const result = await service.getResourceHistogram('sch-1');

      const dates = result.resources[0].demand.map(d => d.date);
      expect(dates).toEqual([...dates].sort());
    });
  });

  // ── levelResources ────────────────────────────────────────────────

  describe('levelResources', () => {
    it('returns early with no adjustments when there are no over-allocations', async () => {
      // Single task, no overlap
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: [],
        tasks: [makeCPMTask('t1', { totalFloat: 5 })],
        projectDuration: 10,
      });

      const result = await service.levelResources('sch-1');

      expect(result.adjustedTasks).toEqual([]);
      expect(result.overAllocations).toEqual([]);
      expect(result.reassignmentSuggestions).toEqual([]);
    });

    it('delays non-critical tasks with float to resolve over-allocation', async () => {
      // Two tasks for Alice on same day. t2 is non-critical with float.
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 5, isCritical: false }),
        ],
        projectDuration: 10,
      });

      const result = await service.levelResources('sch-1');

      expect(result.adjustedTasks.length).toBeGreaterThanOrEqual(1);
      const adj = result.adjustedTasks.find(a => a.taskId === 't2');
      expect(adj).toBeDefined();
      expect(adj!.originalStart).toBe('2026-01-05');
      expect(adj!.newStart).not.toBe('2026-01-05');
      expect(adj!.reason).toContain('Delayed');
      expect(adj!.reason).toContain('Alice');
    });

    it('does not delay critical-path tasks', async () => {
      // Both tasks critical, overlapping
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1', 't2'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 0, isCritical: true }),
        ],
        projectDuration: 10,
      });

      const result = await service.levelResources('sch-1');

      // No tasks should be adjusted — both are critical
      expect(result.adjustedTasks).toEqual([]);
      // Over-allocations remain
      expect(result.overAllocations.length).toBeGreaterThan(0);
    });

    it('does not delay tasks with zero float', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 0, isCritical: false }),
        ],
        projectDuration: 10,
      });

      const result = await service.levelResources('sch-1');

      expect(result.adjustedTasks).toEqual([]);
    });

    it('generates reassignment suggestions when over-allocations remain', async () => {
      // Two critical tasks for Alice — can't delay, so reassignment needed
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
          description: 'frontend development',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
          description: 'frontend work',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1', 't2'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 0, isCritical: true }),
        ],
        projectDuration: 10,
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', 'Alice', { skills: [{ name: 'frontend', level: 5 }] }),
        makeResource('r2', 'Bob', { skills: [{ name: 'frontend', level: 4 }] }),
      ]);

      const result = await service.levelResources('sch-1');

      expect(result.reassignmentSuggestions.length).toBeGreaterThan(0);
      const suggestion = result.reassignmentSuggestions[0];
      expect(suggestion.currentResource).toBe('Alice');
      expect(suggestion.suggestedResource).toBe('Bob');
      expect(suggestion.suggestedResourceId).toBe('r2');
      expect(suggestion.matchScore).toBeGreaterThan(0);
      expect(suggestion.reason).toContain('over-allocated');
    });

    it('excludes inactive resources from reassignment suggestions', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1', 't2'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 0, isCritical: true }),
        ],
        projectDuration: 10,
      });
      // Only inactive alternative resource
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', 'Alice', { isActive: true }),
        makeResource('r2', 'Bob', { isActive: false, skills: [{ name: 'dev', level: 5 }] }),
      ]);

      const result = await service.levelResources('sch-1');

      // Bob is inactive, so no suggestions for Bob
      const bobSuggestions = result.reassignmentSuggestions.filter(
        s => s.suggestedResource === 'Bob'
      );
      expect(bobSuggestions).toEqual([]);
    });

    it('handles resource service failure gracefully for reassignment suggestions', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1', 't2'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 0, isCritical: true }),
        ],
        projectDuration: 10,
      });
      mockFindAllResources.mockRejectedValue(new Error('DB connection error'));

      const result = await service.levelResources('sch-1');

      // Should still return leveling results, just no suggestions
      expect(result.reassignmentSuggestions).toEqual([]);
      expect(result.overAllocations.length).toBeGreaterThan(0);
    });

    it('sorts non-critical tasks by float descending (most flexible first)', async () => {
      // Three tasks for Alice on same day. t2 has more float than t3.
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t3', 'Task 3', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 10, isCritical: false }),
          makeCPMTask('t3', { totalFloat: 2, isCritical: false }),
        ],
        projectDuration: 20,
      });

      const result = await service.levelResources('sch-1');

      // t2 (float=10) should be tried first, then t3 (float=2)
      // At least one should be adjusted
      expect(result.adjustedTasks.length).toBeGreaterThanOrEqual(1);
      // The first adjustment should be for the task with the most float
      if (result.adjustedTasks.length >= 1) {
        expect(result.adjustedTasks[0].taskId).toBe('t2');
      }
    });

    it('assigns default low score to resources with no skills', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1', 't2'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 0, isCritical: true }),
        ],
        projectDuration: 10,
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', 'Alice', { skills: [] }),
        makeResource('r2', 'Bob', { skills: [] }), // no skills = score 10
      ]);

      const result = await service.levelResources('sch-1');

      // Bob has no skills, so match score = 10 (default low)
      if (result.reassignmentSuggestions.length > 0) {
        expect(result.reassignmentSuggestions[0].matchScore).toBe(10);
      }
    });

    it('handles tasks with no CPM entry (defaults to zero float)', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: [],
        tasks: [], // No CPM data at all
        projectDuration: 10,
      });

      const result = await service.levelResources('sch-1');

      // With zero float and not critical, tasks won't be delayed
      expect(result.adjustedTasks).toEqual([]);
    });

    it('updates leveled demand correctly after shifting a task', async () => {
      // Two tasks for Alice overlapping on Jan 5. t2 can be delayed.
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
        makeTask('t2', 'Task 2', {
          assignedTo: 'Alice',
          startDate: '2026-01-05',
          endDate: '2026-01-06',
        }),
      ]);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: [
          makeCPMTask('t1', { totalFloat: 0, isCritical: true }),
          makeCPMTask('t2', { totalFloat: 5, isCritical: false }),
        ],
        projectDuration: 10,
      });

      const result = await service.levelResources('sch-1');

      // Leveled demand should show reduced hours on the original date
      const aliceLeveled = result.leveledDemand.find(r => r.resourceName === 'Alice');
      expect(aliceLeveled).toBeDefined();

      // Original date (Jan 5) should now be 8h (only t1), not 16h
      const jan5 = aliceLeveled!.demand.find(d => d.date === '2026-01-05');
      if (jan5) {
        expect(jan5.hours).toBeLessThanOrEqual(8);
      }
    });
  });

  // ── applyLeveledDates ─────────────────────────────────────────────

  describe('applyLeveledDates', () => {
    const adjustments = [
      {
        taskId: 't1',
        taskName: 'Task 1',
        originalStart: '2026-01-05',
        originalEnd: '2026-01-06',
        newStart: '2026-01-07',
        newEnd: '2026-01-08',
        reason: 'Delayed 2 days',
      },
      {
        taskId: 't2',
        taskName: 'Task 2',
        originalStart: '2026-01-05',
        originalEnd: '2026-01-07',
        newStart: '2026-01-08',
        newEnd: '2026-01-10',
        reason: 'Delayed 3 days',
      },
    ];

    it('applies all adjustments successfully', async () => {
      mockFindTaskById.mockImplementation((id: string) =>
        Promise.resolve({ id, scheduleId: 'sch-1' })
      );
      mockUpdateTask.mockResolvedValue({});

      const result = await service.applyLeveledDates('sch-1', adjustments);

      expect(result.applied).toBe(2);
      expect(result.errors).toEqual([]);
      expect(mockUpdateTask).toHaveBeenCalledTimes(2);
      expect(mockUpdateTask).toHaveBeenCalledWith('t1', {
        startDate: '2026-01-07',
        endDate: '2026-01-08',
      });
      expect(mockUpdateTask).toHaveBeenCalledWith('t2', {
        startDate: '2026-01-08',
        endDate: '2026-01-10',
      });
    });

    it('records error when task is not found', async () => {
      mockFindTaskById.mockResolvedValue(null);

      const result = await service.applyLeveledDates('sch-1', [adjustments[0]]);

      expect(result.applied).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('not found');
    });

    it('records error when task belongs to different schedule', async () => {
      mockFindTaskById.mockResolvedValue({ id: 't1', scheduleId: 'sch-other' });

      const result = await service.applyLeveledDates('sch-1', [adjustments[0]]);

      expect(result.applied).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('does not belong to schedule');
    });

    it('records error when updateTask throws', async () => {
      mockFindTaskById.mockResolvedValue({ id: 't1', scheduleId: 'sch-1' });
      mockUpdateTask.mockRejectedValue(new Error('DB write error'));

      const result = await service.applyLeveledDates('sch-1', [adjustments[0]]);

      expect(result.applied).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('DB write error');
    });

    it('handles empty adjustments array', async () => {
      const result = await service.applyLeveledDates('sch-1', []);

      expect(result.applied).toBe(0);
      expect(result.errors).toEqual([]);
      expect(mockFindTaskById).not.toHaveBeenCalled();
    });

    it('continues processing after individual task errors', async () => {
      // t1 not found, t2 succeeds
      mockFindTaskById.mockImplementation((id: string) => {
        if (id === 't1') return Promise.resolve(null);
        return Promise.resolve({ id, scheduleId: 'sch-1' });
      });
      mockUpdateTask.mockResolvedValue({});

      const result = await service.applyLeveledDates('sch-1', adjustments);

      expect(result.applied).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('t1');
    });
  });
});
