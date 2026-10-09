import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockFindTasksByScheduleId = vi.fn();
const mockFindTaskById = vi.fn();
const mockUpdateTask = vi.fn();
const mockWorkingDayTest = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    workingDayTest: (...args: any[]) => mockWorkingDayTest(...args),
    findTasksByScheduleId: (...args: any[]) => mockFindTasksByScheduleId(...args),
    findTaskById: (...args: any[]) => mockFindTaskById(...args),
    updateTask: (...args: any[]) => mockUpdateTask(...args),
  },
}));

const mockFindTasksByIds = vi.fn();
vi.mock('../../database/TaskRepository', () => ({
  taskRepository: { findByIds: (...args: any[]) => mockFindTasksByIds(...args) },
}));

const mockCalculateCriticalPath = vi.fn();
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: {
    calculateCriticalPath: (...args: any[]) => mockCalculateCriticalPath(...args),
  },
}));

const mockFindAllResources = vi.fn();
const mockFindEffective = vi.fn();
vi.mock('../../services/ResourceService', () => ({
  resourceService: {
    findAllResources: (...args: any[]) => mockFindAllResources(...args),
    findEffectiveAssignments: (...args: any[]) => mockFindEffective(...args),
  },
}));

const mockCapacityBatch = vi.fn();
vi.mock('../../services/ResourceAvailabilityService', () => ({
  resourceAvailabilityService: {
    getEffectiveCapacityBatch: (...args: any[]) => mockCapacityBatch(...args),
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
    mockWorkingDayTest.mockReset(); // no calendar → Mon–Fri
    service = new ResourceLevelingService();
  });

  // Bookings as the Workload Heatmap counts them: hours per week per task and person
  const booking = (taskId: string, resourceId: string, hoursPerWeek: number, startDate: string, endDate: string, scheduleId = 'sch-1') =>
    ({ id: `task:${taskId}:${resourceId}`, taskId, resourceId, scheduleId, hoursPerWeek, startDate, endDate, source: 'task' });
  /** First call = this schedule's bookings, second = everyone's in the date range */
  function bookings(here: any[], elsewhere: any[] = []) {
    mockFindEffective.mockImplementation(async (f: any) => (f?.scheduleIds ? here : [...here, ...elsewhere]));
  }

  // ── getResourceHistogram ──────────────────────────────────────────

  describe('getResourceHistogram', () => {
    beforeEach(() => {
      mockFindTasksByScheduleId.mockResolvedValue([]);
      mockFindAllResources.mockResolvedValue([makeResource('alice', 'Alice'), makeResource('bob', 'Bob')]);
      mockCapacityBatch.mockResolvedValue(new Map());
    });

    it('is empty when nobody is booked on the schedule', async () => {
      bookings([]);
      expect(await service.getResourceHistogram('sch-1')).toEqual({ resources: [], overAllocations: [] });
    });

    it('counts working days only, at weekly hours ÷ 5, named by the person (not an id)', async () => {
      bookings([booking('t1', 'alice', 20, '2026-01-09', '2026-01-12')]); // Fri → Mon
      const h = await service.getResourceHistogram('sch-1');
      expect(h.resources).toEqual([{
        resourceName: 'Alice', resourceId: 'alice', capacityPerDay: 8,
        demand: [{ date: '2026-01-09', hours: 4, capacity: 8 }, { date: '2026-01-12', hours: 4, capacity: 8 }],
      }]);
      expect(h.overAllocations).toEqual([]);
    });

    it('adds their other projects and flags days over that day\'s capacity', async () => {
      bookings(
        [booking('t1', 'alice', 40, '2026-01-05', '2026-01-06')],
        [booking('x', 'alice', 20, '2026-01-06', '2026-01-06', 'other-sch'), booking('y', 'bob', 40, '2026-01-05', '2026-01-06', 'other-sch')],
      );
      const h = await service.getResourceHistogram('sch-1');
      expect(h.resources.map(r => r.resourceName)).toEqual(['Alice']); // Bob isn't on this schedule
      expect(h.overAllocations).toEqual([{ resourceName: 'Alice', date: '2026-01-06', demand: 12, capacity: 8 }]);
    });

    it('a week with time off lowers the day capacity', async () => {
      bookings([booking('t1', 'alice', 40, '2026-01-05', '2026-01-05')]);
      mockCapacityBatch.mockResolvedValue(new Map([['alice', new Map([['2026-01-05', 20]])]]));
      const h = await service.getResourceHistogram('sch-1');
      expect(h.overAllocations).toEqual([{ resourceName: 'Alice', date: '2026-01-05', demand: 8, capacity: 4 }]);
    });
  });

  // ── levelResources ────────────────────────────────────────────────

  describe('levelResources', () => {
    beforeEach(() => {
      mockFindAllResources.mockResolvedValue([
        makeResource('alice', 'Alice'),
        makeResource('bob', 'Bob', { skills: [{ name: 'testing', level: 4 }] }),
        makeResource('carl', 'Carl', { skills: [{ name: 'testing', level: 5 }], isActive: false }),
      ]);
      mockCapacityBatch.mockResolvedValue(new Map());
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a', 'Build API', { startDate: '2026-01-05', endDate: '2026-01-06' }),
        makeTask('b', 'Write testing plan', { startDate: '2026-01-05', endDate: '2026-01-06' }),
      ]);
    });

    it('does nothing when nobody is over capacity', async () => {
      bookings([booking('a', 'alice', 40, '2026-01-05', '2026-01-06')]);
      mockCalculateCriticalPath.mockResolvedValue({ tasks: [makeCPMTask('a', { totalFloat: 5 })], criticalPathTaskIds: [] });
      const r = await service.levelResources('sch-1');
      expect(r.adjustedTasks).toEqual([]);
      expect(r.overAllocations).toEqual([]);
    });

    it('delays the non-critical task with float until its person has room', async () => {
      bookings([booking('a', 'alice', 40, '2026-01-05', '2026-01-06'), booking('b', 'alice', 40, '2026-01-05', '2026-01-06')]);
      mockCalculateCriticalPath.mockResolvedValue({ tasks: [makeCPMTask('a'), makeCPMTask('b', { totalFloat: 5 })], criticalPathTaskIds: ['a'] });
      const r = await service.levelResources('sch-1');
      expect(r.adjustedTasks).toEqual([expect.objectContaining({ taskId: 'b', originalStart: '2026-01-05', newStart: '2026-01-07', newEnd: '2026-01-08' })]);
      expect(r.adjustedTasks[0].reason).toContain('Alice');
      expect(r.overAllocations).toEqual([]);
      expect(r.leveledDemand[0].demand.map(d => [d.date, d.hours])).toEqual([['2026-01-05', 8], ['2026-01-06', 8], ['2026-01-07', 8], ['2026-01-08', 8]]);
    });

    it('never moves critical or zero-float tasks, and suggests an active person with skills and room', async () => {
      bookings([booking('a', 'alice', 40, '2026-01-05', '2026-01-06'), booking('b', 'alice', 40, '2026-01-05', '2026-01-06')]);
      mockCalculateCriticalPath.mockResolvedValue({ tasks: [makeCPMTask('a'), makeCPMTask('b')], criticalPathTaskIds: ['a'] });
      const r = await service.levelResources('sch-1');
      expect(r.adjustedTasks).toEqual([]);
      expect(r.overAllocations.length).toBe(2);
      expect(r.reassignmentSuggestions).toEqual([expect.objectContaining({ taskId: 'b', currentResource: 'Alice', suggestedResource: 'Bob', suggestedResourceId: 'bob' })]);
    });

    it('does not suggest someone who is full themselves', async () => {
      bookings(
        [booking('a', 'alice', 40, '2026-01-05', '2026-01-06'), booking('b', 'alice', 40, '2026-01-05', '2026-01-06')],
        [booking('z', 'bob', 40, '2026-01-05', '2026-01-06', 'other-sch')],
      );
      mockCalculateCriticalPath.mockResolvedValue({ tasks: [makeCPMTask('a'), makeCPMTask('b')], criticalPathTaskIds: ['a'] });
      const r = await service.levelResources('sch-1');
      expect(r.reassignmentSuggestions).toEqual([]);
    });

    it('delays in working days on the project calendar: over the weekend and a holiday, length kept', async () => {
      // Mon 12 Jan 2026 is a project holiday
      mockWorkingDayTest.mockResolvedValue((d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && d.toISOString().slice(0, 10) !== '2026-01-12');
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a', 'Build API', { startDate: '2026-01-08', endDate: '2026-01-09' }),
        makeTask('b', 'Write testing plan', { startDate: '2026-01-08', endDate: '2026-01-09' }),
      ]);
      bookings([booking('a', 'alice', 40, '2026-01-08', '2026-01-09'), booking('b', 'alice', 40, '2026-01-08', '2026-01-09')]);
      mockCalculateCriticalPath.mockResolvedValue({ tasks: [makeCPMTask('a'), makeCPMTask('b', { totalFloat: 10 })], criticalPathTaskIds: ['a'] });
      const r = await service.levelResources('sch-1');
      // Thu–Fri → skips Sat, Sun and the Monday holiday → Tue 13 – Wed 14 (two working days)
      expect(r.adjustedTasks).toEqual([expect.objectContaining({ taskId: 'b', newStart: '2026-01-13', newEnd: '2026-01-14' })]);
      expect(r.adjustedTasks[0].reason).toContain('2 working days');
      expect(r.leveledDemand[0].demand.map(d => d.date)).toEqual(['2026-01-08', '2026-01-09', '2026-01-13', '2026-01-14']);
    });

    it('does not delay past the float (float is in calendar days)', async () => {
      // Float of 3 calendar days after Fri 9 Jan reaches Mon 12 only → 1 working day, not enough
      mockWorkingDayTest.mockResolvedValue((d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6);
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a', 'Build API', { startDate: '2026-01-08', endDate: '2026-01-09' }),
        makeTask('b', 'Write testing plan', { startDate: '2026-01-08', endDate: '2026-01-09' }),
      ]);
      bookings([booking('a', 'alice', 40, '2026-01-08', '2026-01-09'), booking('b', 'alice', 40, '2026-01-08', '2026-01-09')]);
      mockCalculateCriticalPath.mockResolvedValue({ tasks: [makeCPMTask('a'), makeCPMTask('b', { totalFloat: 3 })], criticalPathTaskIds: ['a'] });
      const r = await service.levelResources('sch-1');
      // One working day later (Fri 9 – Mon 12) halves the overload; that's as far as the float allows
      expect(r.adjustedTasks).toEqual([expect.objectContaining({ taskId: 'b', newStart: '2026-01-09', newEnd: '2026-01-12' })]);
    });
  });

  describe('getResourceHistogram on the project calendar', () => {
    it('leaves out the project\'s holidays and counts its extra working days', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([]);
      mockFindAllResources.mockResolvedValue([makeResource('alice', 'Alice')]);
      mockCapacityBatch.mockResolvedValue(new Map());
      // Mon 12 Jan off, Sat 10 Jan worked
      mockWorkingDayTest.mockResolvedValue((d: Date) => {
        const ymd = d.toISOString().slice(0, 10);
        if (ymd === '2026-01-10') return true;
        return d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && ymd !== '2026-01-12';
      });
      bookings([booking('t1', 'alice', 20, '2026-01-09', '2026-01-13')]);
      const h = await service.getResourceHistogram('sch-1');
      expect(h.resources[0].demand.map(d => d.date)).toEqual(['2026-01-09', '2026-01-10', '2026-01-13']);
    });
  });

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
      mockFindTasksByIds.mockResolvedValue([{ id: 't1', scheduleId: 'sch-1' }, { id: 't2', scheduleId: 'sch-1' }]);
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
      mockFindTasksByIds.mockResolvedValue([]);

      const result = await service.applyLeveledDates('sch-1', [adjustments[0]]);

      expect(result.applied).toBe(0);
      expect(result.errors).toEqual(['Task t1 not found']);
    });

    it('records error when task belongs to different schedule', async () => {
      mockFindTasksByIds.mockResolvedValue([{ id: 't1', scheduleId: 'sch-other' }]);

      const result = await service.applyLeveledDates('sch-1', [adjustments[0]]);

      expect(result.applied).toBe(0);
      expect(result.errors).toEqual(['Task t1 does not belong to schedule sch-1']);
    });

    it('records error when updateTask throws', async () => {
      mockFindTasksByIds.mockResolvedValue([{ id: 't1', scheduleId: 'sch-1' }]);
      mockUpdateTask.mockRejectedValue(new Error('DB write error'));

      const result = await service.applyLeveledDates('sch-1', [adjustments[0]]);

      expect(result.applied).toBe(0);
      expect(result.errors).toEqual(['Failed to update task t1: DB write error']);
    });

    it('records the read failure against every task when the tasks cannot be read', async () => {
      mockFindTasksByIds.mockRejectedValue(new Error('db down'));

      const result = await service.applyLeveledDates('sch-1', adjustments);

      expect(result.applied).toBe(0);
      expect(result.errors).toEqual(['Failed to update task t1: db down', 'Failed to update task t2: db down']);
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    it('handles empty adjustments array', async () => {
      const result = await service.applyLeveledDates('sch-1', []);

      expect(result.applied).toBe(0);
      expect(result.errors).toEqual([]);
      expect(mockFindTasksByIds).not.toHaveBeenCalled();
      expect(mockFindTaskById).not.toHaveBeenCalled();
    });

    it('continues processing after individual task errors', async () => {
      // t1 not found, t2 succeeds
      mockFindTasksByIds.mockResolvedValue([{ id: 't2', scheduleId: 'sch-1' }]);
      mockUpdateTask.mockResolvedValue({});

      const result = await service.applyLeveledDates('sch-1', adjustments);

      expect(result.applied).toBe(1);
      expect(result.errors).toEqual(['Task t1 not found']);
      expect(mockUpdateTask).toHaveBeenCalledWith('t2', { startDate: '2026-01-08', endDate: '2026-01-10' });
    });

    it('reads the tasks in one call however many move; saves stay one per task, in order', async () => {
      for (const n of [1, 10, 80]) {
        mockFindTasksByIds.mockReset();
        mockUpdateTask.mockReset();
        mockFindTaskById.mockReset();
        const many = Array.from({ length: n }, (_, i) => ({
          taskId: `t${i}`, taskName: `T${i}`, originalStart: '2026-01-05', originalEnd: '2026-01-06',
          newStart: '2026-01-07', newEnd: '2026-01-08', reason: 'R',
        }));
        // every 5th task is in another plan; returned in reverse order
        mockFindTasksByIds.mockResolvedValue(many.map((a, i) => ({ id: a.taskId, scheduleId: i % 5 === 4 ? 'sch-x' : 'sch-1' })).reverse());
        mockUpdateTask.mockResolvedValue({});

        const result = await service.applyLeveledDates('sch-1', many);

        expect(mockFindTasksByIds).toHaveBeenCalledTimes(1);
        expect(mockFindTaskById).not.toHaveBeenCalled();
        const moved = many.filter((_, i) => i % 5 !== 4);
        expect(mockUpdateTask.mock.calls.map(c => c[0])).toEqual(moved.map(a => a.taskId));
        expect(result.applied).toBe(moved.length);
        expect(result.errors).toEqual(many.filter((_, i) => i % 5 === 4).map(a => `Task ${a.taskId} does not belong to schedule sch-1`));
      }
    });
  });
});
