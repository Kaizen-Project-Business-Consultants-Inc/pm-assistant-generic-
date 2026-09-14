import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockFindTasksByScheduleId = vi.fn();
const mockFindAllDownstreamTasks = vi.fn();
const mockUpdateTask = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: (...args: any[]) => mockFindTasksByScheduleId(...args),
    findAllDownstreamTasks: (...args: any[]) => mockFindAllDownstreamTasks(...args),
    updateTask: (...args: any[]) => mockUpdateTask(...args),
  },
}));

const mockCalculateCriticalPath = vi.fn();
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: {
    calculateCriticalPath: (...args: any[]) => mockCalculateCriticalPath(...args),
  },
}));

const mockDetectDelays = vi.fn();
vi.mock('../../services/AutoRescheduleService', () => ({
  autoRescheduleService: {
    detectDelays: (...args: any[]) => mockDetectDelays(...args),
  },
}));

const mockIsAvailable = vi.fn();
const mockCompleteWithJsonSchema = vi.fn();
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: (...args: any[]) => mockIsAvailable(...args),
    completeWithJsonSchema: (...args: any[]) => mockCompleteWithJsonSchema(...args),
  },
}));

vi.mock('../../config', () => ({
  config: { AI_ENABLED: false },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { TaskPrioritizationService } from '../../services/TaskPrioritizationService';
import { config } from '../../config';

// ── Helpers ──────────────────────────────────────────────────────────
function makeTask(
  id: string,
  name: string,
  opts: {
    status?: string;
    priority?: string;
    startDate?: string | null;
    endDate?: string | null;
    progressPercentage?: number | null;
    dependency?: string | null;
    dependencies?: any[];
    estimatedDays?: number | null;
  } = {},
) {
  return {
    id,
    name,
    status: opts.status ?? 'pending',
    priority: opts.priority ?? 'medium',
    startDate: opts.startDate !== undefined ? opts.startDate : '2026-01-01',
    endDate: opts.endDate !== undefined ? opts.endDate : '2026-01-31',
    progressPercentage: opts.progressPercentage !== undefined ? opts.progressPercentage : 0,
    dependency: opts.dependency ?? null,
    dependencies: opts.dependencies ?? [],
    estimatedDays: opts.estimatedDays !== undefined ? opts.estimatedDays : 30,
  };
}

function makeCriticalPathResult(
  criticalPathTaskIds: string[] = [],
  tasks: Array<{ taskId: string; totalFloat: number }> = [],
) {
  return {
    criticalPathTaskIds,
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      name: `Task ${t.taskId}`,
      duration: 10,
      ES: 0,
      EF: 10,
      LS: t.totalFloat,
      LF: 10 + t.totalFloat,
      totalFloat: t.totalFloat,
      freeFloat: 0,
      isCritical: t.totalFloat === 0,
    })),
    projectDuration: 30,
  };
}

function makeDelayedTask(taskId: string, severity: string) {
  return {
    taskId,
    taskName: `Task ${taskId}`,
    expectedEndDate: '2026-01-31',
    currentProgress: 20,
    estimatedEndDate: '2026-02-10',
    delayDays: 10,
    isOnCriticalPath: false,
    severity,
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('TaskPrioritizationService', () => {
  let service: TaskPrioritizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TaskPrioritizationService();
    // Default: no downstream tasks
    mockFindAllDownstreamTasks.mockResolvedValue([]);
    // Default: AI disabled
    (config as any).AI_ENABLED = false;
    mockIsAvailable.mockReturnValue(false);
  });

  // ── prioritizeTasks ─────────────────────────────────────────────────
  describe('prioritizeTasks', () => {
    it('returns empty result when no active tasks exist', async () => {
      const tasks = [
        makeTask('t1', 'Done', { status: 'completed', startDate: '2026-01-01', endDate: '2026-01-10' }),
        makeTask('t2', 'Cancelled', { status: 'cancelled', startDate: '2026-01-01', endDate: '2026-01-10' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.tasks).toHaveLength(0);
      expect(result.summary.totalTasks).toBe(2);
      expect(result.summary.tasksAnalyzed).toBe(0);
      expect(result.summary.averageScore).toBe(0);
      expect(result.aiPowered).toBe(false);
    });

    it('filters out tasks without start or end dates', async () => {
      const tasks = [
        makeTask('t1', 'No dates', { status: 'pending', startDate: null, endDate: null }),
        makeTask('t2', 'Has dates', { status: 'pending', startDate: '2026-01-01', endDate: '2026-01-10' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].taskId).toBe('t2');
      expect(result.summary.tasksAnalyzed).toBe(1);
    });

    it('includes both pending and in_progress tasks', async () => {
      const tasks = [
        makeTask('t1', 'Pending', { status: 'pending', startDate: '2026-01-01', endDate: '2026-01-31' }),
        makeTask('t2', 'In Progress', { status: 'in_progress', startDate: '2026-01-01', endDate: '2026-01-31' }),
        makeTask('t3', 'Blocked', { status: 'blocked', startDate: '2026-01-01', endDate: '2026-01-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.tasks).toHaveLength(2);
      const ids = result.tasks.map((t) => t.taskId);
      expect(ids).toContain('t1');
      expect(ids).toContain('t2');
      expect(ids).not.toContain('t3');
    });

    it('assigns higher score to critical path tasks', async () => {
      const tasks = [
        makeTask('t1', 'Critical', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t2', 'Non-Critical', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(
        makeCriticalPathResult(['t1'], [
          { taskId: 't1', totalFloat: 0 },
          { taskId: 't2', totalFloat: 20 },
        ]),
      );
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      const critical = result.tasks.find((t) => t.taskId === 't1')!;
      const nonCritical = result.tasks.find((t) => t.taskId === 't2')!;
      expect(critical.priorityScore).toBeGreaterThan(nonCritical.priorityScore);
      expect(critical.factors.some((f) => f.factor === 'Critical Path')).toBe(true);
    });

    it('assigns higher score to tasks with low float', async () => {
      const tasks = [
        makeTask('t1', 'Low Float', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t2', 'High Float', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(
        makeCriticalPathResult([], [
          { taskId: 't1', totalFloat: 2 },
          { taskId: 't2', totalFloat: 50 },
        ]),
      );
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      const lowFloat = result.tasks.find((t) => t.taskId === 't1')!;
      const highFloat = result.tasks.find((t) => t.taskId === 't2')!;
      expect(lowFloat.priorityScore).toBeGreaterThan(highFloat.priorityScore);
      expect(lowFloat.factors.some((f) => f.factor === 'Low Float')).toBe(true);
    });

    it('assigns higher score to delayed tasks', async () => {
      const tasks = [
        makeTask('t1', 'Delayed', { status: 'in_progress', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t2', 'On Track', { status: 'in_progress', startDate: '2026-06-01', endDate: '2026-12-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([makeDelayedTask('t1', 'critical')]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      const delayed = result.tasks.find((t) => t.taskId === 't1')!;
      const onTrack = result.tasks.find((t) => t.taskId === 't2')!;
      expect(delayed.priorityScore).toBeGreaterThan(onTrack.priorityScore);
      expect(delayed.factors.some((f) => f.factor === 'Schedule Delay')).toBe(true);
    });

    it('assigns higher score to tasks with more downstream dependents', async () => {
      const tasks = [
        makeTask('t1', 'Many Deps', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t2', 'No Deps', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);
      // t1 has 5 downstream tasks, t2 has 0
      mockFindAllDownstreamTasks.mockImplementation((taskId: string) => {
        if (taskId === 't1') return Promise.resolve([{}, {}, {}, {}, {}]);
        return Promise.resolve([]);
      });

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      const manyDeps = result.tasks.find((t) => t.taskId === 't1')!;
      const noDeps = result.tasks.find((t) => t.taskId === 't2')!;
      expect(manyDeps.priorityScore).toBeGreaterThan(noDeps.priorityScore);
      expect(manyDeps.factors.some((f) => f.factor === 'Downstream Impact')).toBe(true);
    });

    it('assigns higher score to tasks with near due dates', async () => {
      // Use dates relative to "now" — one task due tomorrow, one due in 6 months
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
      const sixMonths = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const tasks = [
        makeTask('t1', 'Due Soon', {
          status: 'pending',
          startDate: oneMonthAgo.toISOString().split('T')[0],
          endDate: tomorrow.toISOString().split('T')[0],
        }),
        makeTask('t2', 'Due Later', {
          status: 'pending',
          startDate: oneMonthAgo.toISOString().split('T')[0],
          endDate: sixMonths.toISOString().split('T')[0],
        }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      const dueSoon = result.tasks.find((t) => t.taskId === 't1')!;
      const dueLater = result.tasks.find((t) => t.taskId === 't2')!;
      expect(dueSoon.priorityScore).toBeGreaterThan(dueLater.priorityScore);
    });

    it('detects progress gap and adds factor', async () => {
      // Task that is halfway through its duration but 0% complete
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const tasks = [
        makeTask('t1', 'Behind', {
          status: 'in_progress',
          startDate: thirtyDaysAgo.toISOString().split('T')[0],
          endDate: thirtyDaysAhead.toISOString().split('T')[0],
          progressPercentage: 0,
        }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      const behind = result.tasks.find((t) => t.taskId === 't1')!;
      // Expected progress ~50%, actual 0%, gap ~50% => should have Progress Gap factor
      expect(behind.factors.some((f) => f.factor === 'Progress Gap')).toBe(true);
    });

    it('sorts tasks by score descending and assigns ranks', async () => {
      const now = new Date();
      const soon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const later = new Date(now.getTime() + 200 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const tasks = [
        makeTask('t1', 'Low Priority', {
          status: 'pending',
          startDate: monthAgo.toISOString().split('T')[0],
          endDate: later.toISOString().split('T')[0],
        }),
        makeTask('t2', 'High Priority', {
          status: 'pending',
          startDate: monthAgo.toISOString().split('T')[0],
          endDate: soon.toISOString().split('T')[0],
        }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      // t2 is on critical path to make it high priority
      mockCalculateCriticalPath.mockResolvedValue(
        makeCriticalPathResult(['t2'], [
          { taskId: 't1', totalFloat: 100 },
          { taskId: 't2', totalFloat: 0 },
        ]),
      );
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.tasks[0].taskId).toBe('t2');
      expect(result.tasks[0].rank).toBe(1);
      expect(result.tasks[1].taskId).toBe('t1');
      expect(result.tasks[1].rank).toBe(2);
      expect(result.tasks[0].priorityScore).toBeGreaterThanOrEqual(result.tasks[1].priorityScore);
    });

    it('maps scores to correct priority labels via scoreToPriority', async () => {
      // Create tasks that will get different scores by varying factors
      const now = new Date();
      const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      const tasks = [
        makeTask('t1', 'Urgent Task', {
          status: 'in_progress',
          startDate: yesterday.toISOString().split('T')[0],
          endDate: yesterday.toISOString().split('T')[0],
          progressPercentage: 0,
        }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      // Put it on critical path with zero float, delayed critically, many downstream
      mockCalculateCriticalPath.mockResolvedValue(
        makeCriticalPathResult(['t1'], [{ taskId: 't1', totalFloat: 0 }]),
      );
      mockDetectDelays.mockResolvedValue([makeDelayedTask('t1', 'critical')]);
      mockFindAllDownstreamTasks.mockResolvedValue([{}, {}, {}, {}, {}, {}]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      // With critical path (25), zero float (15), critical delay (20), downstream (15), overdue (15), progress gap (10)
      // Should produce a very high score => urgent
      expect(result.tasks[0].suggestedPriority).toBe('urgent');
    });

    it('counts priority changes in summary', async () => {
      const now = new Date();
      const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      const tasks = [
        // This task has urgent current priority but will get a low score (far future, no issues)
        makeTask('t1', 'Overrated', {
          status: 'pending',
          priority: 'urgent',
          startDate: now.toISOString().split('T')[0],
          endDate: farFuture.toISOString().split('T')[0],
        }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult([], [{ taskId: 't1', totalFloat: 100 }]));
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      // Current is 'urgent', suggested should be 'low' due to no factors
      expect(result.summary.priorityChanges).toBe(1);
    });

    it('computes averageScore in summary', async () => {
      const now = new Date();
      const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      const tasks = [
        makeTask('t1', 'Task 1', { status: 'pending', startDate: now.toISOString().split('T')[0], endDate: farFuture.toISOString().split('T')[0] }),
        makeTask('t2', 'Task 2', { status: 'pending', startDate: now.toISOString().split('T')[0], endDate: farFuture.toISOString().split('T')[0] }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      const expectedAvg = Math.round(
        result.tasks.reduce((sum, t) => sum + t.priorityScore, 0) / result.tasks.length,
      );
      expect(result.summary.averageScore).toBe(expectedAvg);
    });

    it('populates summary.criticalPathTasks and summary.delayedTasks', async () => {
      const tasks = [
        makeTask('t1', 'A', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(
        makeCriticalPathResult(['t1', 't99'], [{ taskId: 't1', totalFloat: 0 }]),
      );
      mockDetectDelays.mockResolvedValue([
        makeDelayedTask('t1', 'high'),
        makeDelayedTask('t2', 'low'),
        makeDelayedTask('t3', 'medium'),
      ]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.summary.criticalPathTasks).toBe(2);
      expect(result.summary.delayedTasks).toBe(3);
    });

    it('caps priorityScore at 100', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

      const tasks = [
        makeTask('t1', 'Maxed Out', {
          status: 'in_progress',
          startDate: yesterday.toISOString().split('T')[0],
          endDate: yesterday.toISOString().split('T')[0],
          progressPercentage: 0,
        }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(
        makeCriticalPathResult(['t1'], [{ taskId: 't1', totalFloat: 0 }]),
      );
      mockDetectDelays.mockResolvedValue([makeDelayedTask('t1', 'critical')]);
      mockFindAllDownstreamTasks.mockResolvedValue([{}, {}, {}, {}, {}, {}, {}, {}, {}]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.tasks[0].priorityScore).toBeLessThanOrEqual(100);
    });

    it('generates templated explanation with high factors', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

      const tasks = [
        makeTask('t1', 'Important Task', {
          status: 'in_progress',
          startDate: yesterday.toISOString().split('T')[0],
          endDate: yesterday.toISOString().split('T')[0],
          progressPercentage: 0,
        }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(
        makeCriticalPathResult(['t1'], [{ taskId: 't1', totalFloat: 0 }]),
      );
      mockDetectDelays.mockResolvedValue([makeDelayedTask('t1', 'critical')]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.tasks[0].explanation).toContain('Important Task');
      expect(result.tasks[0].explanation).toContain('requires');
      expect(result.tasks[0].explanation).toContain('due to');
    });

    it('generates templated explanation with no high factors', async () => {
      const now = new Date();
      const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      const tasks = [
        makeTask('t1', 'Calm Task', {
          status: 'pending',
          startDate: now.toISOString().split('T')[0],
          endDate: farFuture.toISOString().split('T')[0],
        }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult([], [{ taskId: 't1', totalFloat: 100 }]));
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.tasks[0].explanation).toContain('Calm Task');
      expect(result.tasks[0].explanation).toContain('no critical factors');
    });

    it('sets aiPowered=false when AI is disabled', async () => {
      const tasks = [makeTask('t1', 'T', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' })];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.aiPowered).toBe(false);
      expect(mockCompleteWithJsonSchema).not.toHaveBeenCalled();
    });

    it('enhances with AI when enabled and available', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);

      const tasks = [makeTask('t1', 'T', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' })];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      mockCompleteWithJsonSchema.mockResolvedValue({
        data: {
          tasks: [
            {
              taskId: 't1',
              rank: 1,
              priorityScore: 60,
              suggestedPriority: 'high',
              factors: [{ factor: 'AI Insight', impact: 'high', description: 'AI says important' }],
              explanation: 'AI-generated explanation',
            },
          ],
        },
      });

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.aiPowered).toBe(true);
      expect(mockCompleteWithJsonSchema).toHaveBeenCalledTimes(1);
      // AI results should be merged
      expect(result.tasks[0].explanation).toBe('AI-generated explanation');
      expect(result.tasks[0].factors[0].factor).toBe('AI Insight');
    });

    it('falls back to algorithmic results when AI returns null', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);

      const tasks = [makeTask('t1', 'T', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' })];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      mockCompleteWithJsonSchema.mockResolvedValue({ data: null });

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.aiPowered).toBe(false);
    });

    it('falls back to algorithmic results when AI throws', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);

      const tasks = [makeTask('t1', 'T', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' })];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      mockCompleteWithJsonSchema.mockRejectedValue(new Error('AI unavailable'));

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.aiPowered).toBe(false);
      // Should still return valid algorithmic results
      expect(result.tasks).toHaveLength(1);
    });

    it('does not call AI when AI_ENABLED but claudeService not available', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(false);

      const tasks = [makeTask('t1', 'T', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' })];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.aiPowered).toBe(false);
      expect(mockCompleteWithJsonSchema).not.toHaveBeenCalled();
    });

    it('AI merge clamps priorityScore to 0-100 and sorts by rank', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);

      const tasks = [
        makeTask('t1', 'A', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t2', 'B', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      mockCompleteWithJsonSchema.mockResolvedValue({
        data: {
          tasks: [
            {
              taskId: 't1',
              rank: 2,
              priorityScore: 150, // over 100
              suggestedPriority: 'urgent',
              factors: [],
              explanation: 'Clamped',
            },
            {
              taskId: 't2',
              rank: 1,
              priorityScore: -10, // under 0
              suggestedPriority: 'low',
              factors: [],
              explanation: 'Clamped low',
            },
          ],
        },
      });

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.aiPowered).toBe(true);
      // Scores should be clamped
      const t1 = result.tasks.find((t) => t.taskId === 't1')!;
      const t2 = result.tasks.find((t) => t.taskId === 't2')!;
      expect(t1.priorityScore).toBe(100);
      expect(t2.priorityScore).toBe(0);
      // Sorted by rank: t2 (rank 1) before t1 (rank 2)
      expect(result.tasks[0].taskId).toBe('t2');
      expect(result.tasks[1].taskId).toBe('t1');
    });

    it('AI merge preserves algorithmic task when AI does not include it', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);

      const tasks = [
        makeTask('t1', 'A', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t2', 'B', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([]);

      // AI only returns t1, not t2
      mockCompleteWithJsonSchema.mockResolvedValue({
        data: {
          tasks: [
            {
              taskId: 't1',
              rank: 1,
              priorityScore: 80,
              suggestedPriority: 'urgent',
              factors: [],
              explanation: 'AI result',
            },
          ],
        },
      });

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      expect(result.tasks).toHaveLength(2);
      // t2 should still be present with original algorithmic values
      const t2 = result.tasks.find((t) => t.taskId === 't2')!;
      expect(t2).toBeDefined();
      expect(t2.explanation).not.toBe('AI result');
    });

    it('handles delay severity values correctly', async () => {
      const tasks = [
        makeTask('t1', 'Low Delay', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t2', 'Medium Delay', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t3', 'High Delay', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
        makeTask('t4', 'Critical Delay', { status: 'pending', startDate: '2026-06-01', endDate: '2026-12-31' }),
      ];
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockDetectDelays.mockResolvedValue([
        makeDelayedTask('t1', 'low'),
        makeDelayedTask('t2', 'medium'),
        makeDelayedTask('t3', 'high'),
        makeDelayedTask('t4', 'critical'),
      ]);

      const result = await service.prioritizeTasks('proj-1', 'sch-1');

      // All delayed tasks should have Schedule Delay factor
      for (const task of result.tasks) {
        expect(task.factors.some((f) => f.factor === 'Schedule Delay')).toBe(true);
      }
      // Critical delay task should score higher than low delay task
      const critical = result.tasks.find((t) => t.taskId === 't4')!;
      const low = result.tasks.find((t) => t.taskId === 't1')!;
      expect(critical.priorityScore).toBeGreaterThan(low.priorityScore);
    });
  });

  // ── applyPriorityChange ─────────────────────────────────────────────
  describe('applyPriorityChange', () => {
    it('returns true when update succeeds', async () => {
      mockUpdateTask.mockResolvedValue({ id: 't1', priority: 'high' });

      const result = await service.applyPriorityChange('t1', 'high');

      expect(result).toBe(true);
      expect(mockUpdateTask).toHaveBeenCalledWith('t1', { priority: 'high' });
    });

    it('returns false when task not found', async () => {
      mockUpdateTask.mockResolvedValue(null);

      const result = await service.applyPriorityChange('nonexistent', 'medium');

      expect(result).toBe(false);
      expect(mockUpdateTask).toHaveBeenCalledWith('nonexistent', { priority: 'medium' });
    });
  });

  // ── applyAllPriorityChanges ─────────────────────────────────────────
  describe('applyAllPriorityChanges', () => {
    it('applies all changes and returns count of successful updates', async () => {
      mockUpdateTask
        .mockResolvedValueOnce({ id: 't1', priority: 'high' })
        .mockResolvedValueOnce({ id: 't2', priority: 'low' })
        .mockResolvedValueOnce(null); // t3 fails

      const changes = [
        { taskId: 't1', priority: 'high' as const },
        { taskId: 't2', priority: 'low' as const },
        { taskId: 't3', priority: 'urgent' as const },
      ];

      const result = await service.applyAllPriorityChanges(changes);

      expect(result).toBe(2);
      expect(mockUpdateTask).toHaveBeenCalledTimes(3);
    });

    it('returns 0 when all updates fail', async () => {
      mockUpdateTask.mockResolvedValue(null);

      const changes = [
        { taskId: 't1', priority: 'high' as const },
        { taskId: 't2', priority: 'low' as const },
      ];

      const result = await service.applyAllPriorityChanges(changes);

      expect(result).toBe(0);
    });

    it('returns 0 for empty changes array', async () => {
      const result = await service.applyAllPriorityChanges([]);

      expect(result).toBe(0);
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });
  });
});
