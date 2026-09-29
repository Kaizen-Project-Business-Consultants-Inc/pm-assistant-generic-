import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindTasks = vi.fn();
const mockWorkingDayTest = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: (...args: any[]) => mockFindTasks(...args),
    workingDayTest: (...args: any[]) => mockWorkingDayTest(...args),
  },
}));

import { CriticalPathService } from '../../services/CriticalPathService';

function makeTask(id: string, name: string, opts: {
  estimatedDays?: number;
  startDate?: string;
  endDate?: string;
  isMilestone?: boolean;
  constraintType?: string;
  constraintDate?: string;
  dependencies?: Array<{ dependencyId: string; dependencyType?: string; lagDays?: number }>;
} = {}) {
  return {
    id,
    name,
    estimatedDays: opts.estimatedDays ?? 0,
    startDate: opts.startDate ?? null,
    endDate: opts.endDate ?? null,
    isMilestone: opts.isMilestone ?? false,
    constraintType: opts.constraintType,
    constraintDate: opts.constraintDate,
    dependencies: opts.dependencies ?? [],
    status: 'not_started',
  };
}

describe('CriticalPathService', () => {
  let service: CriticalPathService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkingDayTest.mockRejectedValue(new Error('no calendar')); // falls back to Mon–Fri
    service = new CriticalPathService();
  });

  it('returns empty result for no tasks', async () => {
    mockFindTasks.mockResolvedValue([]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.criticalPathTaskIds).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.projectDuration).toBe(0);
  });

  it('single task is always critical', async () => {
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { estimatedDays: 5 }),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.criticalPathTaskIds).toEqual(['t1']);
    expect(result.projectDuration).toBe(5);
    expect(result.tasks[0].isCritical).toBe(true);
    expect(result.tasks[0].totalFloat).toBe(0);
  });

  it('two sequential tasks (FS dependency)', async () => {
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { estimatedDays: 3 }),
      makeTask('t2', 'Task 2', { estimatedDays: 4, dependencies: [{ dependencyId: 't1', dependencyType: 'FS' }] }),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.projectDuration).toBe(7); // 3 + 4
    expect(result.criticalPathTaskIds).toContain('t1');
    expect(result.criticalPathTaskIds).toContain('t2');
    // t1: ES=0, EF=3; t2: ES=3, EF=7
    const t1 = result.tasks.find(t => t.taskId === 't1')!;
    const t2 = result.tasks.find(t => t.taskId === 't2')!;
    expect(t1.ES).toBe(0);
    expect(t1.EF).toBe(3);
    expect(t2.ES).toBe(3);
    expect(t2.EF).toBe(7);
  });

  it('parallel tasks — shorter path has float', async () => {
    // t1(3) -> t3(2) = 5 days (critical)
    // t2(2) -> t3(2) = 4 days (t2 has float)
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { estimatedDays: 3 }),
      makeTask('t2', 'Task 2', { estimatedDays: 2 }),
      makeTask('t3', 'Task 3', { estimatedDays: 2, dependencies: [
        { dependencyId: 't1', dependencyType: 'FS' },
        { dependencyId: 't2', dependencyType: 'FS' },
      ]}),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.projectDuration).toBe(5);

    const t1 = result.tasks.find(t => t.taskId === 't1')!;
    const t2 = result.tasks.find(t => t.taskId === 't2')!;
    const t3 = result.tasks.find(t => t.taskId === 't3')!;

    expect(t1.isCritical).toBe(true);
    expect(t3.isCritical).toBe(true);
    expect(t2.isCritical).toBe(false);
    expect(t2.totalFloat).toBe(1); // can slip 1 day
  });

  it('handles FS dependency with lag', async () => {
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { estimatedDays: 3 }),
      makeTask('t2', 'Task 2', { estimatedDays: 2, dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 2 }] }),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.projectDuration).toBe(7); // 3 + 2(lag) + 2
    const t2 = result.tasks.find(t => t.taskId === 't2')!;
    expect(t2.ES).toBe(5); // EF of t1 (3) + lag (2)
    expect(t2.EF).toBe(7);
  });

  it('handles SS (Start-to-Start) dependency', async () => {
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { estimatedDays: 5 }),
      makeTask('t2', 'Task 2', { estimatedDays: 3, dependencies: [{ dependencyId: 't1', dependencyType: 'SS', lagDays: 1 }] }),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    const t2 = result.tasks.find(t => t.taskId === 't2')!;
    expect(t2.ES).toBe(1); // SS: ES of t1 (0) + lag (1)
    expect(t2.EF).toBe(4);
  });

  it('defaults to 1-day duration when no estimate or dates', async () => {
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1'),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.tasks[0].duration).toBe(1);
    expect(result.projectDuration).toBe(1);
  });

  it('calculates duration from start/end dates in working days (start day counted)', async () => {
    // Thu 1 Jan .. Sun 4 Jan 2026 = Thu + Fri = 2 working days
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { startDate: '2026-01-01', endDate: '2026-01-04' }),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.tasks[0].duration).toBe(2);
  });

  it('dates win over a stale estimate, a milestone is 0 days', async () => {
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { estimatedDays: 9, startDate: '2026-01-05', endDate: '2026-01-09' }), // Mon–Fri
      makeTask('m1', 'Done', { estimatedDays: 1, isMilestone: true, startDate: '2026-01-09', endDate: '2026-01-09', dependencies: [{ dependencyId: 't1' }] }),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.tasks.find(t => t.taskId === 't1')!.duration).toBe(5);
    expect(result.tasks.find(t => t.taskId === 'm1')!.duration).toBe(0);
    expect(result.projectDuration).toBe(5);
  });

  it('uses the project calendar: a holiday is not a working day', async () => {
    // Mon 5 .. Fri 9 Jan with Wed 7 Jan a holiday = 4 working days
    mockWorkingDayTest.mockResolvedValue((d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && d.toISOString().slice(0, 10) !== '2026-01-07');
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { startDate: '2026-01-05', endDate: '2026-01-09' }),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.tasks[0].duration).toBe(4);
  });

  it('constraint dates become working-day offsets from the first working day', async () => {
    // Origin Mon 5 Jan. SNET Mon 12 Jan = 5 working days later (weekend skipped, not 7).
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Task 1', { startDate: '2026-01-05', endDate: '2026-01-06' }),
      makeTask('t2', 'Task 2', { startDate: '2026-01-12', endDate: '2026-01-12', constraintType: 'SNET', constraintDate: '2026-01-12' }),
      // SNET on a Saturday snaps to the Monday after
      makeTask('t3', 'Task 3', { startDate: '2026-01-12', endDate: '2026-01-12', constraintType: 'SNET', constraintDate: '2026-01-10' }),
      // Must finish Fri 9 Jan, 2 days long: EF = 5 (day after Fri), ES = 3 (Thu)
      makeTask('t4', 'Task 4', { startDate: '2026-01-08', endDate: '2026-01-09', constraintType: 'MFO', constraintDate: '2026-01-09' }),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.tasks.find(t => t.taskId === 't2')!.ES).toBe(5);
    expect(result.tasks.find(t => t.taskId === 't3')!.ES).toBe(5);
    const t4 = result.tasks.find(t => t.taskId === 't4')!;
    expect(t4.ES).toBe(3);
    expect(t4.EF).toBe(5);
  });

  it('handles diamond dependency pattern', async () => {
    //   t1
    //  / \
    // t2   t3
    //  \ /
    //   t4
    mockFindTasks.mockResolvedValue([
      makeTask('t1', 'Start', { estimatedDays: 2 }),
      makeTask('t2', 'Path A', { estimatedDays: 5, dependencies: [{ dependencyId: 't1' }] }),
      makeTask('t3', 'Path B', { estimatedDays: 3, dependencies: [{ dependencyId: 't1' }] }),
      makeTask('t4', 'End', { estimatedDays: 1, dependencies: [
        { dependencyId: 't2' },
        { dependencyId: 't3' },
      ]}),
    ]);
    const result = await service.calculateCriticalPath('sch-1');
    expect(result.projectDuration).toBe(8); // t1(2) + t2(5) + t4(1)

    const t2 = result.tasks.find(t => t.taskId === 't2')!;
    const t3 = result.tasks.find(t => t.taskId === 't3')!;
    expect(t2.isCritical).toBe(true);
    expect(t3.isCritical).toBe(false);
    expect(t3.totalFloat).toBe(2);
  });
});
