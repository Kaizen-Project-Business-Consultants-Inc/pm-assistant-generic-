import { describe, it, expect, vi } from 'vitest';

// Mock dependencies to avoid config validation
vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn() },
}));
vi.mock('../../config', () => ({
  config: { AI_ENABLED: false, JWT_SECRET: 'test', JWT_REFRESH_SECRET: 'test', COOKIE_SECRET: 'test', DB_PASSWORD: 'test' },
}));
vi.mock('../../services/claudeService', () => ({
  claudeService: { isAvailable: () => false, complete: vi.fn() },
  PromptTemplate: class { constructor() {} render() { return ''; } },
}));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { _detectors, StructuralRisk } from '../../services/StrategicRiskAnalysisService';
import type { Task } from '../../services/ScheduleService';
import type { CriticalPathResult, CPMTaskResult } from '../../services/CriticalPathService';
import type { TaskAssignment } from '../../services/TaskAssignmentService';
import type { Resource } from '../../services/ResourceService';
import type { Project } from '../../services/ProjectService';

const { detectScheduleRisks, detectResourceRisks, detectDependencyRisks, detectMilestoneRisks, detectBudgetRisks } = _detectors;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> & { id: string; name: string }): Task {
  return {
    scheduleId: 'sched-1',
    status: 'pending',
    priority: 'medium',
    sortOrder: 0,
    createdBy: 'user-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    dependencies: [],
    ...overrides,
  } as Task;
}

function makeCPMTask(taskId: string, overrides: Partial<CPMTaskResult> = {}): CPMTaskResult {
  return {
    taskId,
    name: taskId,
    duration: 5,
    ES: 0, EF: 5, LS: 0, LF: 5,
    totalFloat: 0,
    freeFloat: 0,
    isCritical: true,
    ...overrides,
  };
}

function makeCPM(tasks: CPMTaskResult[]): CriticalPathResult {
  return {
    criticalPathTaskIds: tasks.filter(t => t.isCritical).map(t => t.taskId),
    tasks,
    projectDuration: 30,
  };
}

// ---------------------------------------------------------------------------
// Schedule Risks
// ---------------------------------------------------------------------------

describe('detectScheduleRisks', () => {
  it('returns no risks for a clean schedule', () => {
    const tasks = [
      makeTask({ id: 't1', name: 'Task 1', status: 'completed' }),
      makeTask({ id: 't2', name: 'Task 2', status: 'pending', endDate: '2027-12-31' }),
    ];
    const cpm = makeCPM([makeCPMTask('t2', { isCritical: false, totalFloat: 10 })]);
    const risks = detectScheduleRisks(tasks, cpm);
    expect(risks).toHaveLength(0);
  });

  it('detects past-due critical tasks', () => {
    const tasks = [
      makeTask({ id: 't1', name: 'Overdue Task', status: 'in_progress', endDate: '2025-01-01' }),
    ];
    const cpm = makeCPM([makeCPMTask('t1')]);
    const risks = detectScheduleRisks(tasks, cpm);
    expect(risks.length).toBeGreaterThanOrEqual(1);
    expect(risks[0].category).toBe('schedule');
    expect(risks[0].riskStatement).toContain('past due or stalled');
  });

  it('detects long-duration tasks', () => {
    const tasks = [
      makeTask({ id: 't1', name: 'Long Task', status: 'pending', estimatedDays: 20 }),
    ];
    const cpm = makeCPM([makeCPMTask('t1', { isCritical: false, totalFloat: 5 })]);
    const risks = detectScheduleRisks(tasks, cpm);
    const longRisk = risks.find(r => r.riskStatement.includes('15-day'));
    expect(longRisk).toBeDefined();
  });

  it('returns empty when CPM is null', () => {
    const tasks = [makeTask({ id: 't1', name: 'Task', status: 'pending' })];
    expect(detectScheduleRisks(tasks, null)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Resource Risks
// ---------------------------------------------------------------------------

describe('detectResourceRisks', () => {
  const resources: Resource[] = [
    { id: 'r1', name: 'Alice', role: 'Dev', email: '', capacityHoursPerWeek: 40, skills: [], isActive: true, costRateHourly: null, overtimeRateHourly: null, resourceGroup: null, userId: null, calendarTemplateId: null },
    { id: 'r2', name: 'Bob', role: 'Dev', email: '', capacityHoursPerWeek: 40, skills: [], isActive: true, costRateHourly: null, overtimeRateHourly: null, resourceGroup: null, userId: null, calendarTemplateId: null },
  ];

  it('detects unassigned critical tasks', () => {
    const tasks = [makeTask({ id: 't1', name: 'Critical Unassigned', status: 'pending' })];
    const cpm = makeCPM([makeCPMTask('t1')]);
    const assignmentMap = new Map<string, TaskAssignment[]>();
    const risks = detectResourceRisks(tasks, assignmentMap, resources, cpm);
    const unassigned = risks.find(r => r.riskStatement.includes('no resource assigned'));
    expect(unassigned).toBeDefined();
    expect(unassigned!.severity).toBe('critical');
  });

  it('detects single-resource critical tasks', () => {
    const tasks = [makeTask({ id: 't1', name: 'Single Resource', status: 'pending' })];
    const cpm = makeCPM([makeCPMTask('t1')]);
    const assignmentMap = new Map([
      ['t1', [{ id: 'a1', taskId: 't1', resourceId: 'r1', allocationPct: 100, createdAt: '' }]],
    ]);
    const risks = detectResourceRisks(tasks, assignmentMap, resources, cpm);
    const singleRes = risks.find(r => r.riskStatement.includes('single resource'));
    expect(singleRes).toBeDefined();
    expect(singleRes!.severity).toBe('high');
  });

  it('detects over-allocated resources', () => {
    const tasks = [
      makeTask({ id: 't1', name: 'Task 1', status: 'pending' }),
      makeTask({ id: 't2', name: 'Task 2', status: 'pending' }),
    ];
    const cpm = makeCPM([
      makeCPMTask('t1', { isCritical: false }),
      makeCPMTask('t2', { isCritical: false }),
    ]);
    const assignmentMap = new Map([
      ['t1', [{ id: 'a1', taskId: 't1', resourceId: 'r1', allocationPct: 80, createdAt: '' }]],
      ['t2', [{ id: 'a2', taskId: 't2', resourceId: 'r1', allocationPct: 80, createdAt: '' }]],
    ]);
    const risks = detectResourceRisks(tasks, assignmentMap, resources, cpm);
    const overAlloc = risks.find(r => r.riskStatement.includes('120%'));
    expect(overAlloc).toBeDefined();
  });

  it('returns no risks for a well-staffed project', () => {
    const tasks = [makeTask({ id: 't1', name: 'Task', status: 'completed' })];
    const cpm = makeCPM([makeCPMTask('t1', { isCritical: false })]);
    const assignmentMap = new Map([
      ['t1', [
        { id: 'a1', taskId: 't1', resourceId: 'r1', allocationPct: 50, createdAt: '' },
        { id: 'a2', taskId: 't1', resourceId: 'r2', allocationPct: 50, createdAt: '' },
      ]],
    ]);
    const risks = detectResourceRisks(tasks, assignmentMap, resources, cpm);
    expect(risks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dependency Risks
// ---------------------------------------------------------------------------

describe('detectDependencyRisks', () => {
  it('detects bottleneck tasks with 3+ dependents', () => {
    const tasks = [
      makeTask({ id: 't1', name: 'Bottleneck', status: 'pending' }),
      makeTask({ id: 't2', name: 'Dep 1', status: 'pending', dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 0 }] }),
      makeTask({ id: 't3', name: 'Dep 2', status: 'pending', dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 0 }] }),
      makeTask({ id: 't4', name: 'Dep 3', status: 'pending', dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 0 }] }),
    ];
    const cpm = makeCPM(tasks.map(t => makeCPMTask(t.id)));
    const risks = detectDependencyRisks(tasks, cpm);
    const bottleneck = risks.find(r => r.riskStatement.includes('bottleneck'));
    expect(bottleneck).toBeDefined();
  });

  it('detects deep dependency chains', () => {
    // Chain: t1 -> t2 -> t3 -> t4 -> t5 (depth 4) -> t6 (depth 5)
    const tasks = [
      makeTask({ id: 't1', name: 'Start', status: 'pending' }),
      makeTask({ id: 't2', name: 'Step 2', status: 'pending', dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 0 }] }),
      makeTask({ id: 't3', name: 'Step 3', status: 'pending', dependencies: [{ dependencyId: 't2', dependencyType: 'FS', lagDays: 0 }] }),
      makeTask({ id: 't4', name: 'Step 4', status: 'pending', dependencies: [{ dependencyId: 't3', dependencyType: 'FS', lagDays: 0 }] }),
      makeTask({ id: 't5', name: 'Step 5', status: 'pending', dependencies: [{ dependencyId: 't4', dependencyType: 'FS', lagDays: 0 }] }),
      makeTask({ id: 't6', name: 'Step 6', status: 'pending', dependencies: [{ dependencyId: 't5', dependencyType: 'FS', lagDays: 0 }] }),
    ];
    const cpm = makeCPM(tasks.map(t => makeCPMTask(t.id)));
    const risks = detectDependencyRisks(tasks, cpm);
    const deepChain = risks.find(r => r.riskStatement.includes('depth'));
    expect(deepChain).toBeDefined();
    expect(deepChain!.severity).toBe('high');
  });

  it('returns no risks for independent tasks', () => {
    const tasks = [
      makeTask({ id: 't1', name: 'Indep 1', status: 'pending' }),
      makeTask({ id: 't2', name: 'Indep 2', status: 'pending' }),
    ];
    const cpm = makeCPM(tasks.map(t => makeCPMTask(t.id, { isCritical: false })));
    expect(detectDependencyRisks(tasks, cpm)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Milestone Risks
// ---------------------------------------------------------------------------

describe('detectMilestoneRisks', () => {
  it('detects zero-float milestones', () => {
    const tasks = [
      makeTask({ id: 'm1', name: 'Milestone 1', status: 'pending', isMilestone: true, endDate: '2027-06-01' }),
    ];
    const cpm = makeCPM([makeCPMTask('m1', { totalFloat: 0 })]);
    const risks = detectMilestoneRisks(tasks, cpm);
    const zeroFloat = risks.find(r => r.riskStatement.includes('zero float'));
    expect(zeroFloat).toBeDefined();
    expect(zeroFloat!.severity).toBe('high');
  });

  it('detects back-loaded milestones', () => {
    // 4 milestones, 3 in last 25% of timeline
    const tasks = [
      makeTask({ id: 'm1', name: 'MS 1', status: 'pending', isMilestone: true, endDate: '2027-01-01' }),
      makeTask({ id: 'm2', name: 'MS 2', status: 'pending', isMilestone: true, endDate: '2027-11-20' }),
      makeTask({ id: 'm3', name: 'MS 3', status: 'pending', isMilestone: true, endDate: '2027-11-25' }),
      makeTask({ id: 'm4', name: 'MS 4', status: 'pending', isMilestone: true, endDate: '2027-12-01' }),
    ];
    const cpm = makeCPM(tasks.map(t => makeCPMTask(t.id, { totalFloat: 5, isCritical: false })));
    const risks = detectMilestoneRisks(tasks, cpm);
    const backLoaded = risks.find(r => r.riskStatement.includes('back-loaded'));
    expect(backLoaded).toBeDefined();
  });

  it('returns no risks when no milestones exist', () => {
    const tasks = [makeTask({ id: 't1', name: 'Regular', status: 'pending' })];
    expect(detectMilestoneRisks(tasks, null)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Budget Risks
// ---------------------------------------------------------------------------

describe('detectBudgetRisks', () => {
  const baseProject: Project = {
    id: 'p1', name: 'Test Project', status: 'active', priority: 'medium',
    projectType: 'it', methodology: 'waterfall',
    budgetAllocated: 100000, budgetSpent: 0, currency: 'CAD',
    createdBy: 'u1', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  };

  it('detects no-budget-allocated risk', () => {
    const project = { ...baseProject, budgetAllocated: 0 };
    const risks = detectBudgetRisks(project, [], null);
    expect(risks.length).toBe(1);
    expect(risks[0].riskStatement).toContain('No budget');
  });

  it('detects burn rate ahead of progress', () => {
    const project = { ...baseProject, budgetSpent: 60000 }; // 60% burned
    const tasks = [
      makeTask({ id: 't1', name: 'Done', status: 'completed' }),
      makeTask({ id: 't2', name: 'Pending', status: 'pending' }),
      makeTask({ id: 't3', name: 'Pending 2', status: 'pending' }),
      makeTask({ id: 't4', name: 'Pending 3', status: 'pending' }),
    ]; // 25% progress vs 60% burned
    const risks = detectBudgetRisks(project, tasks, null);
    const burnRisk = risks.find(r => r.riskStatement.includes('burn'));
    expect(burnRisk).toBeDefined();
  });

  it('detects low CPI from EVM', () => {
    const evm = { currentMetrics: { cpi: 0.75 } };
    const risks = detectBudgetRisks(baseProject, [], evm);
    const cpiRisk = risks.find(r => r.riskStatement.includes('CPI'));
    expect(cpiRisk).toBeDefined();
    expect(cpiRisk!.severity).toBe('critical');
  });

  it('detects tasks over budget', () => {
    const tasks = [
      makeTask({ id: 't1', name: 'Over Budget', status: 'in_progress', budgetAllocated: 1000, actualCost: 1500 }),
    ];
    const risks = detectBudgetRisks(baseProject, tasks, null);
    const overBudget = risks.find(r => r.riskStatement.includes('exceeded'));
    expect(overBudget).toBeDefined();
  });

  it('returns no risks for healthy budget', () => {
    const project = { ...baseProject, budgetSpent: 10000 };
    const tasks = [
      makeTask({ id: 't1', name: 'Task', status: 'completed' }),
      makeTask({ id: 't2', name: 'Task 2', status: 'in_progress' }),
    ];
    const risks = detectBudgetRisks(project, tasks, { currentMetrics: { cpi: 1.05 } });
    expect(risks).toHaveLength(0);
  });
});
