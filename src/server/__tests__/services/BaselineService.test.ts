import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockFindTasks = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { findTasksByScheduleId: (...args: any[]) => mockFindTasks(...args) },
}));

const mockRepoCreate = vi.fn();
const mockRepoFindByScheduleId = vi.fn();
const mockRepoFindById = vi.fn();
const mockRepoDeleteById = vi.fn();
vi.mock('../../database/BaselineRepository', () => ({
  baselineRepository: {
    create: (...args: any[]) => mockRepoCreate(...args),
    findByScheduleId: (...args: any[]) => mockRepoFindByScheduleId(...args),
    findById: (...args: any[]) => mockRepoFindById(...args),
    deleteById: (...args: any[]) => mockRepoDeleteById(...args),
  },
}));

const mockQuery = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: { query: (...args: any[]) => mockQuery(...args) },
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'test-uuid-1234') });

import { BaselineService } from '../../services/BaselineService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeTask(id: string, name: string, opts: {
  startDate?: string | null;
  endDate?: string | null;
  estimatedDays?: number | null;
  progressPercentage?: number | null;
  status?: string;
  budgetAllocated?: number | null;
} = {}) {
  return {
    id,
    name,
    startDate: opts.startDate !== undefined ? opts.startDate : '2026-01-01',
    endDate: opts.endDate !== undefined ? opts.endDate : '2026-01-10',
    estimatedDays: opts.estimatedDays !== undefined ? opts.estimatedDays : 10,
    progressPercentage: opts.progressPercentage !== undefined ? opts.progressPercentage : 0,
    status: opts.status ?? 'not_started',
    budgetAllocated: opts.budgetAllocated !== undefined ? opts.budgetAllocated : null,
  };
}

function makeBaseline(overrides: Partial<{
  id: string;
  scheduleId: string;
  name: string;
  createdAt: string;
  createdBy: string;
  tasks: any[];
}> = {}) {
  return {
    id: overrides.id ?? 'bl-1',
    scheduleId: overrides.scheduleId ?? 'sch-1',
    name: overrides.name ?? 'Baseline 1',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    createdBy: overrides.createdBy ?? 'user-1',
    tasks: overrides.tasks ?? [],
  };
}

function makeBaselineTask(taskId: string, opts: {
  name?: string;
  startDate?: string;
  endDate?: string;
  estimatedDays?: number;
  progressPercentage?: number;
  status?: string;
} = {}) {
  return {
    taskId,
    name: opts.name ?? `Task ${taskId}`,
    startDate: opts.startDate ?? '2026-01-01T00:00:00.000Z',
    endDate: opts.endDate ?? '2026-01-10T00:00:00.000Z',
    estimatedDays: opts.estimatedDays ?? 10,
    progressPercentage: opts.progressPercentage ?? 0,
    status: opts.status ?? 'not_started',
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('BaselineService', () => {
  let service: BaselineService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BaselineService();
  });

  // ── create ─────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates a baseline from current schedule tasks', async () => {
      const tasks = [
        makeTask('t1', 'Design', { startDate: '2026-02-01', endDate: '2026-02-05', estimatedDays: 5, progressPercentage: 50, status: 'in_progress' }),
        makeTask('t2', 'Build', { startDate: '2026-02-06', endDate: '2026-02-15', estimatedDays: 10, progressPercentage: 0, status: 'not_started' }),
      ];
      mockFindTasks.mockResolvedValue(tasks);
      mockRepoCreate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue(undefined);

      const result = await service.create('sch-1', 'Sprint 1 Baseline', 'user-1');

      expect(mockFindTasks).toHaveBeenCalledWith('sch-1');
      expect(mockRepoCreate).toHaveBeenCalledTimes(1);
      expect(result.scheduleId).toBe('sch-1');
      expect(result.name).toBe('Sprint 1 Baseline');
      expect(result.createdBy).toBe('user-1');
      expect(result.id).toBe('test-uuid-1234');
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].taskId).toBe('t1');
      expect(result.tasks[0].progressPercentage).toBe(50);
      expect(result.tasks[1].taskId).toBe('t2');
    });

    it('stamps baseline fields on each task via UPDATE query', async () => {
      const tasks = [
        makeTask('t1', 'Task 1', { startDate: '2026-03-01', endDate: '2026-03-10', estimatedDays: 10, budgetAllocated: 5000 }),
      ];
      mockFindTasks.mockResolvedValue(tasks);
      mockRepoCreate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue(undefined);

      await service.create('sch-1', 'BL', 'user-1');

      // One UPDATE per task
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks SET baseline_start_date'),
        ['2026-03-01', '2026-03-10', 10, 5000, 't1'],
      );
    });

    it('handles tasks with null dates and no budget', async () => {
      const tasks = [
        makeTask('t1', 'No dates', { startDate: null, endDate: null, estimatedDays: null, budgetAllocated: null }),
      ];
      mockFindTasks.mockResolvedValue(tasks);
      mockRepoCreate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue(undefined);

      const result = await service.create('sch-1', 'BL', 'user-1');

      expect(result.tasks[0].startDate).toBe('');
      expect(result.tasks[0].endDate).toBe('');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks'),
        [null, null, null, null, 't1'],
      );
    });

    it('creates baseline with empty task list', async () => {
      mockFindTasks.mockResolvedValue([]);
      mockRepoCreate.mockResolvedValue(undefined);

      const result = await service.create('sch-1', 'Empty BL', 'user-1');

      expect(result.tasks).toHaveLength(0);
      expect(mockRepoCreate).toHaveBeenCalledTimes(1);
      // No UPDATE queries when there are no tasks
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('handles null progressPercentage by defaulting to 0', async () => {
      const tasks = [makeTask('t1', 'T', { progressPercentage: undefined } as any)];
      // Simulate null from DB
      tasks[0].progressPercentage = null as any;
      mockFindTasks.mockResolvedValue(tasks);
      mockRepoCreate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue(undefined);

      const result = await service.create('sch-1', 'BL', 'user-1');

      expect(result.tasks[0].progressPercentage).toBe(0);
    });
  });

  // ── findByScheduleId ──────────────────────────────────────────────
  describe('findByScheduleId', () => {
    it('delegates to repository', async () => {
      const baselines = [makeBaseline()];
      mockRepoFindByScheduleId.mockResolvedValue(baselines);

      const result = await service.findByScheduleId('sch-1');

      expect(mockRepoFindByScheduleId).toHaveBeenCalledWith('sch-1');
      expect(result).toBe(baselines);
    });

    it('returns empty array when no baselines exist', async () => {
      mockRepoFindByScheduleId.mockResolvedValue([]);

      const result = await service.findByScheduleId('sch-999');

      expect(result).toEqual([]);
    });
  });

  // ── findById ──────────────────────────────────────────────────────
  describe('findById', () => {
    it('returns baseline when found', async () => {
      const baseline = makeBaseline({ id: 'bl-42' });
      mockRepoFindById.mockResolvedValue(baseline);

      const result = await service.findById('bl-42');

      expect(mockRepoFindById).toHaveBeenCalledWith('bl-42');
      expect(result).toBe(baseline);
    });

    it('returns null when not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── delete ────────────────────────────────────────────────────────
  describe('delete', () => {
    it('returns true when baseline deleted', async () => {
      mockRepoDeleteById.mockResolvedValue(true);

      const result = await service.delete('bl-1');

      expect(mockRepoDeleteById).toHaveBeenCalledWith('bl-1');
      expect(result).toBe(true);
    });

    it('returns false when baseline not found', async () => {
      mockRepoDeleteById.mockResolvedValue(false);

      const result = await service.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ── compareBaseline ───────────────────────────────────────────────
  describe('compareBaseline', () => {
    it('returns null when baseline not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      const result = await service.compareBaseline('nonexistent');

      expect(result).toBeNull();
    });

    it('computes correct variances for on-track tasks (no changes)', async () => {
      const baseline = makeBaseline({
        id: 'bl-1',
        scheduleId: 'sch-1',
        tasks: [
          makeBaselineTask('t1', { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z', progressPercentage: 50, status: 'in_progress' }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      const currentTasks = [
        makeTask('t1', 'Task t1', { startDate: '2026-01-01', endDate: '2026-01-10', progressPercentage: 50, status: 'in_progress' }),
      ];
      mockFindTasks.mockResolvedValue(currentTasks);

      const result = await service.compareBaseline('bl-1');

      expect(result).not.toBeNull();
      expect(result!.baselineId).toBe('bl-1');
      expect(result!.taskVariances).toHaveLength(1);

      const tv = result!.taskVariances[0];
      expect(tv.startVarianceDays).toBe(0);
      expect(tv.endVarianceDays).toBe(0);
      expect(tv.progressVariancePct).toBe(0);
      expect(tv.statusChanged).toBe(false);

      expect(result!.summary.tasksOnTrack).toBe(1);
      expect(result!.summary.tasksSlipped).toBe(0);
      expect(result!.summary.tasksAhead).toBe(0);
      expect(result!.summary.scheduleHealthPct).toBe(100);
    });

    it('detects slipped tasks (end variance > 1 day)', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1', { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z', status: 'not_started' }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      // Task ended 5 days late
      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'Task t1', { startDate: '2026-01-01', endDate: '2026-01-15', status: 'not_started' }),
      ]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.taskVariances[0].endVarianceDays).toBe(5);
      expect(result!.summary.tasksSlipped).toBe(1);
      expect(result!.summary.tasksOnTrack).toBe(0);
    });

    it('detects ahead tasks (end variance < -1 day)', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1', { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z', status: 'in_progress' }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      // Task ending 3 days early
      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'Task t1', { startDate: '2026-01-01', endDate: '2026-01-07', status: 'in_progress' }),
      ]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.taskVariances[0].endVarianceDays).toBe(-3);
      expect(result!.summary.tasksAhead).toBe(1);
      expect(result!.summary.tasksOnTrack).toBe(0);
    });

    it('on-track threshold: variance of exactly 1 day is on-track, not slipped', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1', { endDate: '2026-01-10T00:00:00.000Z' }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      // 1 day late — still on-track (> 1 required for slipped)
      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'Task t1', { startDate: '2026-01-01', endDate: '2026-01-11' }),
      ]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.taskVariances[0].endVarianceDays).toBe(1);
      expect(result!.summary.tasksOnTrack).toBe(1);
      expect(result!.summary.tasksSlipped).toBe(0);
    });

    it('detects new tasks not in baseline', async () => {
      const baseline = makeBaseline({
        tasks: [makeBaselineTask('t1')],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'Task t1'),
        makeTask('t2', 'New Task'),
        makeTask('t3', 'Another New'),
      ]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.summary.newTasks).toBe(2);
    });

    it('detects removed tasks that were in baseline but not current', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1'),
          makeBaselineTask('t2'),
          makeBaselineTask('t3'),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      // Only t1 remains
      mockFindTasks.mockResolvedValue([makeTask('t1', 'Task t1')]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.summary.removedTasks).toBe(2);
      // Removed tasks are not in variances
      expect(result!.taskVariances).toHaveLength(1);
    });

    it('computes duration variance correctly', async () => {
      const baseline = makeBaseline({
        tasks: [
          // 9 day duration baseline
          makeBaselineTask('t1', { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z' }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      // 19 day duration actual
      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'Task t1', { startDate: '2026-01-01', endDate: '2026-01-20' }),
      ]);

      const result = await service.compareBaseline('bl-1');
      const tv = result!.taskVariances[0];

      expect(tv.baselineDurationDays).toBe(9);
      expect(tv.actualDurationDays).toBe(19);
      expect(tv.durationVarianceDays).toBe(10);
    });

    it('detects status changes', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1', { status: 'not_started' }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'Task t1', { status: 'completed' }),
      ]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.taskVariances[0].statusChanged).toBe(true);
      expect(result!.taskVariances[0].baselineStatus).toBe('not_started');
      expect(result!.taskVariances[0].actualStatus).toBe('completed');
    });

    it('computes progress variance correctly', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1', { progressPercentage: 30 }),
          makeBaselineTask('t2', { progressPercentage: 60 }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'Task t1', { progressPercentage: 50 }), // +20
        makeTask('t2', 'Task t2', { progressPercentage: 40 }), // -20
      ]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.taskVariances[0].progressVariancePct).toBe(20);
      expect(result!.taskVariances[1].progressVariancePct).toBe(-20);
      expect(result!.summary.avgProgressVariancePct).toBe(0);
    });

    it('computes schedule health as percentage of on-track + ahead', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1', { endDate: '2026-01-10T00:00:00.000Z' }),
          makeBaselineTask('t2', { endDate: '2026-01-10T00:00:00.000Z' }),
          makeBaselineTask('t3', { endDate: '2026-01-10T00:00:00.000Z' }),
          makeBaselineTask('t4', { endDate: '2026-01-10T00:00:00.000Z' }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'T1', { endDate: '2026-01-10' }),  // on track (0 variance)
        makeTask('t2', 'T2', { endDate: '2026-01-05' }),  // ahead (-5)
        makeTask('t3', 'T3', { endDate: '2026-01-20' }),  // slipped (+10)
        makeTask('t4', 'T4', { endDate: '2026-01-10' }),  // on track (0)
      ]);

      const result = await service.compareBaseline('bl-1');

      // 2 on track + 1 ahead = 3 out of 4 => 75%
      expect(result!.summary.tasksOnTrack).toBe(2);
      expect(result!.summary.tasksAhead).toBe(1);
      expect(result!.summary.tasksSlipped).toBe(1);
      expect(result!.summary.scheduleHealthPct).toBe(75);
    });

    it('returns 100% health when no tasks to compare (all removed)', async () => {
      const baseline = makeBaseline({
        tasks: [makeBaselineTask('t1')],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      // No current tasks match baseline tasks
      mockFindTasks.mockResolvedValue([makeTask('t99', 'Different Task')]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.summary.totalTasks).toBe(0);
      expect(result!.summary.scheduleHealthPct).toBe(100);
      expect(result!.summary.avgStartVarianceDays).toBe(0);
      expect(result!.summary.avgEndVarianceDays).toBe(0);
      expect(result!.summary.avgProgressVariancePct).toBe(0);
    });

    it('handles tasks with empty/null date strings gracefully', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1', { startDate: '', endDate: '' }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      // Current task also has null dates → actualStart/actualEnd become ''
      const task = makeTask('t1', 'Task t1', { startDate: null, endDate: null });
      mockFindTasks.mockResolvedValue([task]);

      const result = await service.compareBaseline('bl-1');

      const tv = result!.taskVariances[0];
      // Empty/null dates → 0 variance for start/end
      expect(tv.startVarianceDays).toBe(0);
      expect(tv.endVarianceDays).toBe(0);
      // daysDuration('','') returns 0 because empty string is falsy
      expect(tv.baselineDurationDays).toBe(0);
      expect(tv.actualDurationDays).toBe(0);
    });

    it('computes averages rounded to 1 decimal place', async () => {
      const baseline = makeBaseline({
        tasks: [
          makeBaselineTask('t1', { endDate: '2026-01-10T00:00:00.000Z', progressPercentage: 0 }),
          makeBaselineTask('t2', { endDate: '2026-01-10T00:00:00.000Z', progressPercentage: 0 }),
          makeBaselineTask('t3', { endDate: '2026-01-10T00:00:00.000Z', progressPercentage: 0 }),
        ],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      mockFindTasks.mockResolvedValue([
        makeTask('t1', 'T1', { endDate: '2026-01-12', progressPercentage: 10 }), // +2
        makeTask('t2', 'T2', { endDate: '2026-01-13', progressPercentage: 20 }), // +3
        makeTask('t3', 'T3', { endDate: '2026-01-14', progressPercentage: 30 }), // +4
      ]);

      const result = await service.compareBaseline('bl-1');

      // Average end variance: (2+3+4)/3 = 3.0
      expect(result!.summary.avgEndVarianceDays).toBe(3);
      // Average progress: (10+20+30)/3 = 20.0
      expect(result!.summary.avgProgressVariancePct).toBe(20);
    });

    it('populates metadata fields correctly', async () => {
      const baseline = makeBaseline({
        id: 'bl-meta',
        scheduleId: 'sch-meta',
        name: 'Meta Test',
        createdAt: '2026-06-15T12:00:00.000Z',
        tasks: [makeBaselineTask('t1')],
      });
      mockRepoFindById.mockResolvedValue(baseline);
      mockFindTasks.mockResolvedValue([makeTask('t1', 'Task t1')]);

      const result = await service.compareBaseline('bl-meta');

      expect(result!.baselineId).toBe('bl-meta');
      expect(result!.baselineName).toBe('Meta Test');
      expect(result!.baselineDate).toBe('2026-06-15T12:00:00.000Z');
      expect(result!.scheduleId).toBe('sch-meta');
    });

    it('handles null progressPercentage on current tasks', async () => {
      const baseline = makeBaseline({
        tasks: [makeBaselineTask('t1', { progressPercentage: 40 })],
      });
      mockRepoFindById.mockResolvedValue(baseline);

      const task = makeTask('t1', 'Task t1');
      task.progressPercentage = null as any;
      mockFindTasks.mockResolvedValue([task]);

      const result = await service.compareBaseline('bl-1');

      expect(result!.taskVariances[0].actualProgress).toBe(0);
      expect(result!.taskVariances[0].progressVariancePct).toBe(-40);
    });
  });
});
