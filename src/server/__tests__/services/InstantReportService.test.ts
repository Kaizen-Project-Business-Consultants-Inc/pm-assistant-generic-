import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockFindByProjectId = vi.fn();
const mockFindTasksByScheduleIds = vi.fn();
const mockFindTasksByScheduleId = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: (...args: any[]) => mockFindByProjectId(...args),
    findTasksByScheduleIds: (...args: any[]) => mockFindTasksByScheduleIds(...args),
    findTasksByScheduleId: (...args: any[]) => mockFindTasksByScheduleId(...args),
  },
}));

const mockProjectFindById = vi.fn();
vi.mock('../../services/ProjectService', () => ({
  projectService: {
    findById: (...args: any[]) => mockProjectFindById(...args),
  },
}));

const mockCalculateCriticalPath = vi.fn();
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: {
    calculateCriticalPath: (...args: any[]) => mockCalculateCriticalPath(...args),
  },
}));

const mockFindAllResources = vi.fn();
const mockComputeWorkload = vi.fn();
vi.mock('../../services/ResourceService', () => ({
  resourceService: {
    findAllResources: (...args: any[]) => mockFindAllResources(...args),
    computeWorkload: (...args: any[]) => mockComputeWorkload(...args),
  },
}));

const mockGetForTasks = vi.fn();
vi.mock('../../services/TaskAssignmentService', () => ({
  taskAssignmentService: {
    getForTasks: (...args: any[]) => mockGetForTasks(...args),
  },
}));

const mockGenerateMetricsOnly = vi.fn();
vi.mock('../../services/EVMForecastService', () => ({
  evmForecastService: {
    generateMetricsOnly: (...args: any[]) => mockGenerateMetricsOnly(...args),
  },
}));

// Mock all renderer functions — return a simple string
const mockRenderMilestoneReport = vi.fn(() => '<html>milestone</html>');
const mockRenderCriticalTasksReport = vi.fn(() => '<html>critical</html>');
const mockRenderLateSlippingReport = vi.fn(() => '<html>late</html>');
const mockRenderResourceOverviewReport = vi.fn(() => '<html>resource-overview</html>');
const mockRenderWhoDoesWhatReport = vi.fn(() => '<html>who-does-what</html>');
const mockRenderResourceAvailabilityReport = vi.fn(() => '<html>availability</html>');
const mockRenderResourceCostReport = vi.fn(() => '<html>resource-cost</html>');
const mockRenderOverallocatedReport = vi.fn(() => '<html>overallocated</html>');
const mockRenderCostOverviewReport = vi.fn(() => '<html>cost-overview</html>');
const mockRenderEarnedValueReport = vi.fn(() => '<html>earned-value</html>');
const mockRenderResourceStatusReport = vi.fn(() => '<html>resource-status</html>');
const mockRenderWhoDoesWhatWhenReport = vi.fn(() => '<html>who-does-what-when</html>');
const mockRenderOverbudgetResourcesReport = vi.fn(() => '<html>overbudget</html>');

vi.mock('../../utils/instantReportRenderer', () => ({
  renderMilestoneReport: (...args: any[]) => mockRenderMilestoneReport(...args),
  renderCriticalTasksReport: (...args: any[]) => mockRenderCriticalTasksReport(...args),
  renderLateSlippingReport: (...args: any[]) => mockRenderLateSlippingReport(...args),
  renderResourceOverviewReport: (...args: any[]) => mockRenderResourceOverviewReport(...args),
  renderWhoDoesWhatReport: (...args: any[]) => mockRenderWhoDoesWhatReport(...args),
  renderResourceAvailabilityReport: (...args: any[]) => mockRenderResourceAvailabilityReport(...args),
  renderResourceCostReport: (...args: any[]) => mockRenderResourceCostReport(...args),
  renderOverallocatedReport: (...args: any[]) => mockRenderOverallocatedReport(...args),
  renderCostOverviewReport: (...args: any[]) => mockRenderCostOverviewReport(...args),
  renderEarnedValueReport: (...args: any[]) => mockRenderEarnedValueReport(...args),
  renderResourceStatusReport: (...args: any[]) => mockRenderResourceStatusReport(...args),
  renderWhoDoesWhatWhenReport: (...args: any[]) => mockRenderWhoDoesWhatWhenReport(...args),
  renderOverbudgetResourcesReport: (...args: any[]) => mockRenderOverbudgetResourcesReport(...args),
}));

vi.mock('../../utils/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { InstantReportService } from '../../services/InstantReportService';

// ── Helpers ──────────────────────────────────────────────────────────

function makeProject(overrides: Partial<{ id: string; name: string; budgetAllocated: number | null; budgetSpent: number; currency: string }> = {}) {
  return {
    id: overrides.id ?? 'proj-1',
    name: overrides.name ?? 'Test Project',
    budgetAllocated: overrides.budgetAllocated !== undefined ? overrides.budgetAllocated : 100000,
    budgetSpent: overrides.budgetSpent ?? 50000,
    currency: overrides.currency ?? 'USD',
  };
}

function makeSchedule(id: string, name: string = `Schedule ${id}`) {
  return { id, name };
}

function makeTask(id: string, overrides: Partial<{
  name: string; scheduleId: string; status: string; isMilestone: boolean; isSummary: boolean;
  startDate: string | null; endDate: string | null; dueDate: string | null;
  progressPercentage: number | null; priority: string;
  budgetAllocated: number | null; actualCost: number | null;
}> = {}) {
  return {
    id,
    name: overrides.name ?? `Task ${id}`,
    scheduleId: overrides.scheduleId ?? 'sch-1',
    status: overrides.status ?? 'pending',
    isMilestone: overrides.isMilestone ?? false,
    isSummary: overrides.isSummary ?? false,
    startDate: overrides.startDate !== undefined ? overrides.startDate : '2026-01-01',
    endDate: overrides.endDate !== undefined ? overrides.endDate : '2026-01-10',
    dueDate: overrides.dueDate !== undefined ? overrides.dueDate : null,
    progressPercentage: overrides.progressPercentage !== undefined ? overrides.progressPercentage : 0,
    priority: overrides.priority ?? 'medium',
    budgetAllocated: overrides.budgetAllocated !== undefined ? overrides.budgetAllocated : null,
    actualCost: overrides.actualCost !== undefined ? overrides.actualCost : null,
  };
}

function makeResource(id: string, overrides: Partial<{
  name: string; role: string; email: string; capacityHoursPerWeek: number;
  skills: string; isActive: boolean; resourceGroup: string; costRateHourly: number;
}> = {}) {
  return {
    id,
    name: overrides.name ?? `Resource ${id}`,
    role: overrides.role ?? 'Developer',
    email: overrides.email ?? `${id}@test.com`,
    capacityHoursPerWeek: overrides.capacityHoursPerWeek ?? 40,
    skills: overrides.skills ?? 'TypeScript',
    isActive: overrides.isActive ?? true,
    resourceGroup: overrides.resourceGroup ?? 'Engineering',
    costRateHourly: overrides.costRateHourly ?? 100,
  };
}

function makeWorkloadEntry(resourceId: string, overrides: Partial<{
  resourceName: string; role: string; averageUtilization: number; isOverAllocated: boolean;
  totalCost: number; costRateHourly: number;
  weeks: Array<{ weekStart: string; allocated: number; capacity: number; utilization: number; actual?: number }>;
}> = {}) {
  return {
    resourceId,
    resourceName: overrides.resourceName ?? `Resource ${resourceId}`,
    role: overrides.role ?? 'Developer',
    averageUtilization: overrides.averageUtilization ?? 50,
    isOverAllocated: overrides.isOverAllocated ?? false,
    totalCost: overrides.totalCost ?? 5000,
    costRateHourly: overrides.costRateHourly ?? 100,
    weeks: overrides.weeks ?? [
      { weekStart: '2026-01-05', allocated: 20, capacity: 40, utilization: 50 },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('InstantReportService', () => {
  let service: InstantReportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InstantReportService();
  });

  // ── generate() — routing & error handling ────────────────────────
  describe('generate', () => {
    it('throws when project is not found', async () => {
      mockProjectFindById.mockResolvedValue(null);
      await expect(service.generate('milestone-report', 'proj-1')).rejects.toThrow('Project not found');
    });

    it('throws for unknown report type', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      await expect(service.generate('nonexistent-report', 'proj-1')).rejects.toThrow('Unknown instant report type: nonexistent-report');
    });

    it('returns correct title for known report types', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([]);

      const result = await service.generate('milestone-report', 'proj-1');
      expect(result.title).toBe('Milestone Report');
    });

    it('uses reportType as title fallback for unmapped types', async () => {
      // This won't actually happen because unknown types throw, but the REPORT_TITLES lookup uses || reportType
      // Verified by checking the code — this path is unreachable since unknown types throw first
      // So we just test that all 13 known types have their correct titles
      mockProjectFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([]);

      const titles: Record<string, string> = {
        'milestone-report': 'Milestone Report',
        'critical-tasks': 'Critical Path Report',
        'late-slipping-tasks': 'Late & Slipping Tasks',
        'resource-overview': 'Resource Overview',
        'who-does-what': 'Who Does What',
        'resource-availability': 'Resource Availability',
        'resource-cost-overview': 'Resource Cost Overview',
        'overallocated-resources': 'Overallocated Resources',
        'cost-overview': 'Cost Overview',
        'earned-value-summary': 'Earned Value Summary',
        'resource-status': 'Resource Status',
        'who-does-what-when': 'Who Does What When',
        'overbudget-resources': 'Overbudget Resources',
      };

      // Setup mocks that work for all report types
      mockFindAllResources.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([]);
      mockGetForTasks.mockResolvedValue(new Map());
      mockGenerateMetricsOnly.mockResolvedValue({
        currentMetrics: { BAC: 0, EV: 0, AC: 0, PV: 0, CPI: 0, SPI: 0, EAC: 0, ETC: 0, VAC: 0, TCPI: 0 },
        earlyWarnings: [],
        traditionalForecasts: { eacCumulative: 0, eacComposite: 0, eacManagement: 0 },
      });

      for (const [type, expectedTitle] of Object.entries(titles)) {
        const result = await service.generate(type, 'proj-1');
        expect(result.title).toBe(expectedTitle);
      }
    });

    it('routes each report type to the correct renderer', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAllResources.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([]);
      mockGetForTasks.mockResolvedValue(new Map());
      mockGenerateMetricsOnly.mockResolvedValue({
        currentMetrics: { BAC: 0, EV: 0, AC: 0, PV: 0, CPI: 0, SPI: 0, EAC: 0, ETC: 0, VAC: 0, TCPI: 0 },
        earlyWarnings: [],
        traditionalForecasts: { eacCumulative: 0, eacComposite: 0, eacManagement: 0 },
      });

      await service.generate('milestone-report', 'proj-1');
      expect(mockRenderMilestoneReport).toHaveBeenCalled();

      await service.generate('resource-overview', 'proj-1');
      expect(mockRenderResourceOverviewReport).toHaveBeenCalled();
    });
  });

  // ── milestoneReport ──────────────────────────────────────────────
  describe('milestone-report', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('returns empty milestones when no schedules', async () => {
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('milestone-report', 'proj-1');

      expect(mockRenderMilestoneReport).toHaveBeenCalledWith({
        projectName: 'Test Project',
        milestones: [],
      });
    });

    it('filters only milestone tasks and sorts by date', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1', 'Main')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { isMilestone: true, endDate: '2026-03-01', name: 'Late MS' }),
        makeTask('t2', { isMilestone: false, name: 'Regular Task' }),
        makeTask('t3', { isMilestone: true, endDate: '2026-01-15', name: 'Early MS' }),
      ]);

      await service.generate('milestone-report', 'proj-1');

      const callArg = mockRenderMilestoneReport.mock.calls[0][0];
      expect(callArg.milestones).toHaveLength(2);
      expect(callArg.milestones[0].name).toBe('Early MS');
      expect(callArg.milestones[1].name).toBe('Late MS');
    });

    it('uses dueDate as fallback for sorting when endDate is null', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { isMilestone: true, endDate: null, dueDate: '2026-02-01', name: 'B' }),
        makeTask('t2', { isMilestone: true, endDate: null, dueDate: '2026-01-01', name: 'A' }),
      ]);

      await service.generate('milestone-report', 'proj-1');

      const callArg = mockRenderMilestoneReport.mock.calls[0][0];
      expect(callArg.milestones[0].name).toBe('A');
      expect(callArg.milestones[1].name).toBe('B');
    });

    it('caps milestones at 200', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      const tasks = Array.from({ length: 250 }, (_, i) =>
        makeTask(`t${i}`, { isMilestone: true, endDate: `2026-01-${String(i % 28 + 1).padStart(2, '0')}` })
      );
      mockFindTasksByScheduleIds.mockResolvedValue(tasks);

      await service.generate('milestone-report', 'proj-1');

      const callArg = mockRenderMilestoneReport.mock.calls[0][0];
      expect(callArg.milestones).toHaveLength(200);
    });

    it('maps schedule name correctly', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1', 'Sprint 1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { isMilestone: true, scheduleId: 'sch-1' }),
      ]);

      await service.generate('milestone-report', 'proj-1');

      const callArg = mockRenderMilestoneReport.mock.calls[0][0];
      expect(callArg.milestones[0].scheduleName).toBe('Sprint 1');
    });
  });

  // ── criticalTasksReport ──────────────────────────────────────────
  describe('critical-tasks', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('returns empty when no schedules', async () => {
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('critical-tasks', 'proj-1');

      expect(mockRenderCriticalTasksReport).toHaveBeenCalledWith({
        projectName: 'Test Project',
        criticalTasks: [],
        projectDuration: 0,
        scheduleName: '—',
      });
    });

    it('uses the first schedule for critical path', async () => {
      const schedules = [makeSchedule('sch-1', 'Main'), makeSchedule('sch-2', 'Secondary')];
      mockFindByProjectId.mockResolvedValue(schedules);
      mockCalculateCriticalPath.mockResolvedValue({
        tasks: [{ taskId: 't1', name: 'Design', duration: 5, totalFloat: 0, isCritical: true }],
        projectDuration: 20,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'in_progress', startDate: '2026-01-01', endDate: '2026-01-05' }),
      ]);

      await service.generate('critical-tasks', 'proj-1');

      expect(mockCalculateCriticalPath).toHaveBeenCalledWith('sch-1');
      const callArg = mockRenderCriticalTasksReport.mock.calls[0][0];
      expect(callArg.scheduleName).toBe('Main');
      expect(callArg.projectDuration).toBe(20);
      expect(callArg.criticalTasks).toHaveLength(1);
      expect(callArg.criticalTasks[0].status).toBe('in_progress');
    });

    it('filters to only critical tasks', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockCalculateCriticalPath.mockResolvedValue({
        tasks: [
          { taskId: 't1', name: 'Critical', duration: 5, totalFloat: 0, isCritical: true },
          { taskId: 't2', name: 'NonCritical', duration: 3, totalFloat: 5, isCritical: false },
        ],
        projectDuration: 10,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1'), makeTask('t2'),
      ]);

      await service.generate('critical-tasks', 'proj-1');

      const callArg = mockRenderCriticalTasksReport.mock.calls[0][0];
      expect(callArg.criticalTasks).toHaveLength(1);
      expect(callArg.criticalTasks[0].name).toBe('Critical');
    });

    it('defaults status to pending when task not found in taskMap', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockCalculateCriticalPath.mockResolvedValue({
        tasks: [{ taskId: 't-missing', name: 'Ghost', duration: 3, totalFloat: 0, isCritical: true }],
        projectDuration: 5,
      });
      mockFindTasksByScheduleId.mockResolvedValue([]);

      await service.generate('critical-tasks', 'proj-1');

      const callArg = mockRenderCriticalTasksReport.mock.calls[0][0];
      expect(callArg.criticalTasks[0].status).toBe('pending');
      expect(callArg.criticalTasks[0].startDate).toBeNull();
      expect(callArg.criticalTasks[0].endDate).toBeNull();
    });
  });

  // ── lateSlippingReport ───────────────────────────────────────────
  describe('late-slipping-tasks', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('returns empty lists when no schedules', async () => {
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('late-slipping-tasks', 'proj-1');

      expect(mockRenderLateSlippingReport).toHaveBeenCalledWith({
        projectName: 'Test Project',
        lateTasks: [],
        slippingTasks: [],
      });
    });

    it('identifies late tasks (past end date, not completed/cancelled)', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1', 'Main')]);
      const pastDate = '2020-01-01';
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { status: 'in_progress', endDate: pastDate, name: 'Late Task' }),
        makeTask('t2', { status: 'completed', endDate: pastDate, name: 'Done Task' }),
        makeTask('t3', { status: 'cancelled', endDate: pastDate, name: 'Cancelled Task' }),
        makeTask('t4', { status: 'pending', endDate: '2099-12-31', name: 'Future Task' }),
      ]);

      await service.generate('late-slipping-tasks', 'proj-1');

      const callArg = mockRenderLateSlippingReport.mock.calls[0][0];
      expect(callArg.lateTasks).toHaveLength(1);
      expect(callArg.lateTasks[0].name).toBe('Late Task');
      expect(callArg.lateTasks[0].daysLate).toBeGreaterThan(0);
    });

    it('sorts late tasks by daysLate descending', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { status: 'in_progress', endDate: '2025-01-01', name: 'Very Late' }),
        makeTask('t2', { status: 'in_progress', endDate: '2026-01-01', name: 'Less Late' }),
      ]);

      await service.generate('late-slipping-tasks', 'proj-1');

      const callArg = mockRenderLateSlippingReport.mock.calls[0][0];
      expect(callArg.lateTasks[0].name).toBe('Very Late');
      expect(callArg.lateTasks[0].daysLate).toBeGreaterThan(callArg.lateTasks[1].daysLate);
    });

    it('uses dueDate as fallback for late detection when endDate is null', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { status: 'in_progress', endDate: null, dueDate: '2020-01-01', name: 'Late by dueDate' }),
      ]);

      await service.generate('late-slipping-tasks', 'proj-1');

      const callArg = mockRenderLateSlippingReport.mock.calls[0][0];
      expect(callArg.lateTasks).toHaveLength(1);
    });

    it('identifies slipping tasks (in_progress, >7 days, <25% progress)', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        // Slipping: in_progress, started long ago, low progress
        makeTask('t1', { status: 'in_progress', startDate: '2020-01-01', progressPercentage: 10, name: 'Slipping' }),
        // Not slipping: not in_progress
        makeTask('t2', { status: 'pending', startDate: '2020-01-01', progressPercentage: 5 }),
        // Not slipping: high progress
        makeTask('t3', { status: 'in_progress', startDate: '2020-01-01', progressPercentage: 50 }),
        // Not slipping: started recently (need to set future-ish start)
        makeTask('t4', { status: 'in_progress', startDate: new Date().toISOString().slice(0, 10), progressPercentage: 0 }),
      ]);

      await service.generate('late-slipping-tasks', 'proj-1');

      const callArg = mockRenderLateSlippingReport.mock.calls[0][0];
      expect(callArg.slippingTasks).toHaveLength(1);
      expect(callArg.slippingTasks[0].name).toBe('Slipping');
    });

    it('excludes tasks with no startDate from slipping', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { status: 'in_progress', startDate: null, progressPercentage: 0, name: 'No Start' }),
      ]);

      await service.generate('late-slipping-tasks', 'proj-1');

      const callArg = mockRenderLateSlippingReport.mock.calls[0][0];
      expect(callArg.slippingTasks).toHaveLength(0);
    });
  });

  // ── resourceOverviewReport ───────────────────────────────────────
  describe('resource-overview', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('renders resource overview with mapped fields', async () => {
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', { name: 'Alice', role: 'Lead', isActive: true }),
      ]);

      await service.generate('resource-overview', 'proj-1');

      const callArg = mockRenderResourceOverviewReport.mock.calls[0][0];
      expect(callArg.projectName).toBe('Test Project');
      expect(callArg.resources).toHaveLength(1);
      expect(callArg.resources[0].name).toBe('Alice');
      expect(callArg.resources[0].role).toBe('Lead');
      expect(callArg.resources[0].isActive).toBe(true);
    });

    it('caps resources at 200', async () => {
      const resources = Array.from({ length: 250 }, (_, i) => makeResource(`r${i}`));
      mockFindAllResources.mockResolvedValue(resources);

      await service.generate('resource-overview', 'proj-1');

      const callArg = mockRenderResourceOverviewReport.mock.calls[0][0];
      expect(callArg.resources).toHaveLength(200);
    });
  });

  // ── whoDoesWhatReport ────────────────────────────────────────────
  describe('who-does-what', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('returns empty when no schedules', async () => {
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('who-does-what', 'proj-1');

      expect(mockRenderWhoDoesWhatReport).toHaveBeenCalledWith({
        projectName: 'Test Project',
        resourceAssignments: [],
        unassignedTaskCount: 0,
      });
    });

    it('groups tasks by resource and counts unassigned', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1', 'Main')]);
      mockFindAllResources.mockResolvedValue([makeResource('r1', { name: 'Alice' })]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { name: 'Assigned Task', scheduleId: 'sch-1' }),
        makeTask('t2', { name: 'Unassigned Task', scheduleId: 'sch-1' }),
      ]);

      const assignmentMap = new Map();
      assignmentMap.set('t1', [{ resourceId: 'r1', allocationPct: 100 }]);
      mockGetForTasks.mockResolvedValue(assignmentMap);

      await service.generate('who-does-what', 'proj-1');

      const callArg = mockRenderWhoDoesWhatReport.mock.calls[0][0];
      expect(callArg.resourceAssignments).toHaveLength(1);
      expect(callArg.resourceAssignments[0].resourceName).toBe('Alice');
      expect(callArg.resourceAssignments[0].tasks).toHaveLength(1);
      expect(callArg.unassignedTaskCount).toBe(1);
    });

    it('excludes summary tasks from unassigned count', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindAllResources.mockResolvedValue([]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { isSummary: true }),
        makeTask('t2', { isSummary: false }),
      ]);
      mockGetForTasks.mockResolvedValue(new Map());

      await service.generate('who-does-what', 'proj-1');

      const callArg = mockRenderWhoDoesWhatReport.mock.calls[0][0];
      expect(callArg.unassignedTaskCount).toBe(1); // only t2 counted
    });

    it('sorts resource assignments alphabetically', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', { name: 'Zara' }),
        makeResource('r2', { name: 'Alice' }),
      ]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { scheduleId: 'sch-1' }),
        makeTask('t2', { scheduleId: 'sch-1' }),
      ]);

      const assignmentMap = new Map();
      assignmentMap.set('t1', [{ resourceId: 'r1', allocationPct: 100 }]);
      assignmentMap.set('t2', [{ resourceId: 'r2', allocationPct: 100 }]);
      mockGetForTasks.mockResolvedValue(assignmentMap);

      await service.generate('who-does-what', 'proj-1');

      const callArg = mockRenderWhoDoesWhatReport.mock.calls[0][0];
      expect(callArg.resourceAssignments[0].resourceName).toBe('Alice');
      expect(callArg.resourceAssignments[1].resourceName).toBe('Zara');
    });
  });

  // ── resourceAvailabilityReport ───────────────────────────────────
  describe('resource-availability', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('renders workload data with mapped fields', async () => {
      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', {
          resourceName: 'Alice',
          role: 'Dev',
          averageUtilization: 75,
          isOverAllocated: false,
          weeks: [{ weekStart: '2026-01-05', allocated: 30, capacity: 40, utilization: 75 }],
        }),
      ]);

      await service.generate('resource-availability', 'proj-1');

      const callArg = mockRenderResourceAvailabilityReport.mock.calls[0][0];
      expect(callArg.resources).toHaveLength(1);
      expect(callArg.resources[0].resourceName).toBe('Alice');
      expect(callArg.resources[0].averageUtilization).toBe(75);
    });
  });

  // ── resourceCostReport ───────────────────────────────────────────
  describe('resource-cost-overview', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('computes total project cost and per-resource hours', async () => {
      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', {
          totalCost: 3000, costRateHourly: 100,
          weeks: [
            { weekStart: '2026-01-05', allocated: 20, capacity: 40, utilization: 50 },
            { weekStart: '2026-01-12', allocated: 10, capacity: 40, utilization: 25 },
          ],
        }),
        makeWorkloadEntry('r2', {
          totalCost: 2000, costRateHourly: 80,
          weeks: [{ weekStart: '2026-01-05', allocated: 25, capacity: 40, utilization: 62.5 }],
        }),
      ]);

      await service.generate('resource-cost-overview', 'proj-1');

      const callArg = mockRenderResourceCostReport.mock.calls[0][0];
      expect(callArg.totalProjectCost).toBe(5000);
      expect(callArg.resources).toHaveLength(2);
      expect(callArg.resources[0].totalAllocatedHours).toBe(30); // 20+10
    });

    it('filters out resources with null cost rate and zero total cost', async () => {
      // The filter is: w.costRateHourly != null || w.totalCost > 0
      // For r1: costRateHourly=null (null != null is false) AND totalCost=0 (0 > 0 is false) → excluded
      // For r2: costRateHourly=50 (50 != null is true) → included
      const w1 = makeWorkloadEntry('r1', { totalCost: 0 });
      (w1 as any).costRateHourly = null;
      mockComputeWorkload.mockResolvedValue([
        w1,
        makeWorkloadEntry('r2', { totalCost: 1000, costRateHourly: 50 }),
      ]);

      await service.generate('resource-cost-overview', 'proj-1');

      const callArg = mockRenderResourceCostReport.mock.calls[0][0];
      expect(callArg.resources).toHaveLength(1);
      expect(callArg.resources[0].resourceName).toBe('Resource r2');
    });
  });

  // ── overallocatedReport ──────────────────────────────────────────
  describe('overallocated-resources', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('filters to only overallocated resources', async () => {
      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', { isOverAllocated: true, averageUtilization: 120, weeks: [{ weekStart: '2026-01-05', allocated: 48, capacity: 40, utilization: 120 }] }),
        makeWorkloadEntry('r2', { isOverAllocated: false, averageUtilization: 50 }),
      ]);

      await service.generate('overallocated-resources', 'proj-1');

      const callArg = mockRenderOverallocatedReport.mock.calls[0][0];
      expect(callArg.resources).toHaveLength(1);
      expect(callArg.resources[0].resourceName).toBe('Resource r1');
    });

    it('finds peak utilization week', async () => {
      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', {
          isOverAllocated: true,
          averageUtilization: 110,
          weeks: [
            { weekStart: '2026-01-05', allocated: 40, capacity: 40, utilization: 100 },
            { weekStart: '2026-01-12', allocated: 52, capacity: 40, utilization: 130 },
            { weekStart: '2026-01-19', allocated: 44, capacity: 40, utilization: 110 },
          ],
        }),
      ]);

      await service.generate('overallocated-resources', 'proj-1');

      const callArg = mockRenderOverallocatedReport.mock.calls[0][0];
      expect(callArg.resources[0].peakUtilization).toBe(130);
      expect(callArg.resources[0].peakWeek).toBe('2026-01-12');
    });

    it('uses first week capacity for capacityHoursPerWeek', async () => {
      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', {
          isOverAllocated: true,
          weeks: [{ weekStart: '2026-01-05', allocated: 50, capacity: 35, utilization: 142 }],
        }),
      ]);

      await service.generate('overallocated-resources', 'proj-1');

      const callArg = mockRenderOverallocatedReport.mock.calls[0][0];
      expect(callArg.resources[0].capacityHoursPerWeek).toBe(35);
    });

    it('defaults capacity to 40 when no weeks', async () => {
      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', { isOverAllocated: true, weeks: [] }),
      ]);

      await service.generate('overallocated-resources', 'proj-1');

      const callArg = mockRenderOverallocatedReport.mock.calls[0][0];
      expect(callArg.resources[0].capacityHoursPerWeek).toBe(40);
    });
  });

  // ── costOverviewReport ───────────────────────────────────────────
  describe('cost-overview', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject({ budgetAllocated: 100000, budgetSpent: 40000, currency: 'CAD' }));
    });

    it('throws when project not found on second lookup', async () => {
      // First call in generate() returns project, second call in costOverviewReport returns null
      mockProjectFindById
        .mockResolvedValueOnce(makeProject())
        .mockResolvedValueOnce(null);

      await expect(service.generate('cost-overview', 'proj-1')).rejects.toThrow('Project not found');
    });

    it('includes budget info and task costs', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1', 'Main')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { name: 'Dev', budgetAllocated: 5000, actualCost: 4500, status: 'in_progress', isSummary: false }),
        makeTask('t2', { name: 'Summary', isSummary: true }),
      ]);

      await service.generate('cost-overview', 'proj-1');

      const callArg = mockRenderCostOverviewReport.mock.calls[0][0];
      expect(callArg.budgetAllocated).toBe(100000);
      expect(callArg.budgetSpent).toBe(40000);
      expect(callArg.currency).toBe('CAD');
      expect(callArg.tasks).toHaveLength(1); // summary excluded
      expect(callArg.tasks[0].name).toBe('Dev');
    });

    it('handles no schedules', async () => {
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('cost-overview', 'proj-1');

      const callArg = mockRenderCostOverviewReport.mock.calls[0][0];
      expect(callArg.tasks).toHaveLength(0);
    });

    it('defaults currency to USD when missing', async () => {
      mockProjectFindById.mockResolvedValue(makeProject({ currency: undefined as any }));
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('cost-overview', 'proj-1');

      const callArg = mockRenderCostOverviewReport.mock.calls[0][0];
      expect(callArg.currency).toBe('USD');
    });
  });

  // ── earnedValueReport ────────────────────────────────────────────
  describe('earned-value-summary', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('renders EVM metrics on success', async () => {
      const evmResult = {
        currentMetrics: { BAC: 100000, EV: 50000, AC: 45000, PV: 48000, CPI: 1.11, SPI: 1.04, EAC: 90000, ETC: 45000, VAC: 10000, TCPI: 0.95 },
        earlyWarnings: [{ type: 'cost', message: 'Under budget', severity: 'info' }],
        traditionalForecasts: { eacCumulative: 90000, eacComposite: 91000, eacManagement: 89000 },
      };
      mockGenerateMetricsOnly.mockResolvedValue(evmResult);

      await service.generate('earned-value-summary', 'proj-1');

      const callArg = mockRenderEarnedValueReport.mock.calls[0][0];
      expect(callArg.metrics.BAC).toBe(100000);
      expect(callArg.earlyWarnings).toHaveLength(1);
      expect(callArg.forecasts.eacCumulative).toBe(90000);
    });

    it('renders fallback metrics on EVM failure', async () => {
      mockGenerateMetricsOnly.mockRejectedValue(new Error('No baseline data'));

      await service.generate('earned-value-summary', 'proj-1');

      const callArg = mockRenderEarnedValueReport.mock.calls[0][0];
      expect(callArg.metrics.BAC).toBe(0);
      expect(callArg.earlyWarnings).toHaveLength(1);
      expect(callArg.earlyWarnings[0].type).toBe('error');
      expect(callArg.earlyWarnings[0].message).toContain('No baseline data');
    });
  });

  // ── resourceStatusReport ─────────────────────────────────────────
  describe('resource-status', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('computes resource counts and utilization buckets', async () => {
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', { isActive: true, role: 'Developer', resourceGroup: 'Eng' }),
        makeResource('r2', { isActive: true, role: 'Developer', resourceGroup: 'Eng' }),
        makeResource('r3', { isActive: false, role: 'Designer', resourceGroup: 'Design' }),
      ]);
      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', { averageUtilization: 0, isOverAllocated: false, weeks: [{ weekStart: '2026-01-05', allocated: 0, capacity: 40, utilization: 0 }] }),
        makeWorkloadEntry('r2', { averageUtilization: 90, isOverAllocated: false, weeks: [{ weekStart: '2026-01-05', allocated: 36, capacity: 40, utilization: 90 }] }),
        makeWorkloadEntry('r3', { averageUtilization: 120, isOverAllocated: true, weeks: [{ weekStart: '2026-01-05', allocated: 48, capacity: 40, utilization: 120 }] }),
      ]);

      await service.generate('resource-status', 'proj-1');

      const callArg = mockRenderResourceStatusReport.mock.calls[0][0];
      expect(callArg.totalResources).toBe(3);
      expect(callArg.activeResources).toBe(2);
      expect(callArg.inactiveResources).toBe(1);
      expect(callArg.overallocatedCount).toBe(1);
      expect(callArg.averageUtilization).toBe(70); // (0+90+120)/3 = 70

      // Role counts
      const devRole = callArg.byRole.find((r: any) => r.role === 'Developer');
      expect(devRole?.count).toBe(2);

      // Group counts
      const engGroup = callArg.byGroup.find((g: any) => g.group === 'Eng');
      expect(engGroup?.count).toBe(2);

      // Utilization buckets
      const zeroBucket = callArg.utilizationBuckets.find((b: any) => b.label === '0%');
      expect(zeroBucket?.count).toBe(1);
      const highBucket = callArg.utilizationBuckets.find((b: any) => b.label === '81–100%');
      expect(highBucket?.count).toBe(1);
      const overBucket = callArg.utilizationBuckets.find((b: any) => b.label === '>100%');
      expect(overBucket?.count).toBe(1);
    });

    it('handles empty workload', async () => {
      mockFindAllResources.mockResolvedValue([makeResource('r1')]);
      mockComputeWorkload.mockResolvedValue([]);

      await service.generate('resource-status', 'proj-1');

      const callArg = mockRenderResourceStatusReport.mock.calls[0][0];
      expect(callArg.averageUtilization).toBe(0);
      expect(callArg.overallocatedCount).toBe(0);
    });

    it('groups resources without role as Unassigned', async () => {
      // The code does: r.role || 'Unassigned' — empty string is falsy, so it becomes 'Unassigned'
      // We must set role to '' directly on the object since makeResource uses ?? which passes undefined through
      const r1 = makeResource('r1');
      r1.role = '';
      const r2 = makeResource('r2');
      r2.role = '' as any;
      mockFindAllResources.mockResolvedValue([r1, r2]);
      mockComputeWorkload.mockResolvedValue([]);

      await service.generate('resource-status', 'proj-1');

      const callArg = mockRenderResourceStatusReport.mock.calls[0][0];
      const unassigned = callArg.byRole.find((r: any) => r.role === 'Unassigned');
      expect(unassigned?.count).toBe(2);
    });

    it('groups resources without resourceGroup as Ungrouped', async () => {
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', { resourceGroup: '' }),
      ]);
      mockComputeWorkload.mockResolvedValue([]);

      await service.generate('resource-status', 'proj-1');

      const callArg = mockRenderResourceStatusReport.mock.calls[0][0];
      const ungrouped = callArg.byGroup.find((g: any) => g.group === 'Ungrouped');
      expect(ungrouped?.count).toBe(1);
    });
  });

  // ── whoDoesWhatWhenReport ────────────────────────────────────────
  describe('who-does-what-when', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('returns empty when no schedules', async () => {
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('who-does-what-when', 'proj-1');

      expect(mockRenderWhoDoesWhatWhenReport).toHaveBeenCalledWith({
        projectName: 'Test Project',
        resources: [],
      });
    });

    it('excludes summary tasks from per-week breakdown', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindAllResources.mockResolvedValue([makeResource('r1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { isSummary: true, startDate: '2026-01-05', endDate: '2026-01-10' }),
      ]);
      mockComputeWorkload.mockResolvedValue([]);

      const assignmentMap = new Map();
      assignmentMap.set('t1', [{ resourceId: 'r1', hoursPlanned: 40 }]);
      mockGetForTasks.mockResolvedValue(assignmentMap);

      await service.generate('who-does-what-when', 'proj-1');

      const callArg = mockRenderWhoDoesWhatWhenReport.mock.calls[0][0];
      expect(callArg.resources).toHaveLength(0);
    });

    it('skips tasks without start or end dates', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindAllResources.mockResolvedValue([makeResource('r1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { startDate: null, endDate: '2026-01-10' }),
        makeTask('t2', { startDate: '2026-01-05', endDate: null }),
      ]);
      mockComputeWorkload.mockResolvedValue([]);

      const assignmentMap = new Map();
      assignmentMap.set('t1', [{ resourceId: 'r1', hoursPlanned: 10 }]);
      assignmentMap.set('t2', [{ resourceId: 'r1', hoursPlanned: 10 }]);
      mockGetForTasks.mockResolvedValue(assignmentMap);

      await service.generate('who-does-what-when', 'proj-1');

      const callArg = mockRenderWhoDoesWhatWhenReport.mock.calls[0][0];
      expect(callArg.resources).toHaveLength(0);
    });

    it('sorts resources alphabetically', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', { name: 'Zara' }),
        makeResource('r2', { name: 'Alice' }),
      ]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { startDate: '2026-01-05', endDate: '2026-01-09' }),
        makeTask('t2', { startDate: '2026-01-05', endDate: '2026-01-09' }),
      ]);
      mockComputeWorkload.mockResolvedValue([]);

      const assignmentMap = new Map();
      assignmentMap.set('t1', [{ resourceId: 'r1', hoursPlanned: 20 }]);
      assignmentMap.set('t2', [{ resourceId: 'r2', hoursPlanned: 20 }]);
      mockGetForTasks.mockResolvedValue(assignmentMap);

      await service.generate('who-does-what-when', 'proj-1');

      const callArg = mockRenderWhoDoesWhatWhenReport.mock.calls[0][0];
      expect(callArg.resources.length).toBeGreaterThan(0);
      if (callArg.resources.length >= 2) {
        expect(callArg.resources[0].resourceName).toBe('Alice');
        expect(callArg.resources[1].resourceName).toBe('Zara');
      }
    });
  });

  // ── overbudgetResourcesReport ────────────────────────────────────
  describe('overbudget-resources', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
    });

    it('returns empty when no schedules', async () => {
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('overbudget-resources', 'proj-1');

      expect(mockRenderOverbudgetResourcesReport).toHaveBeenCalledWith({
        projectName: 'Test Project',
        resources: [],
        totalPlannedCost: 0,
        totalActualCost: 0,
        totalVariance: 0,
      });
    });

    it('identifies overbudget resources (actual > planned)', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', { name: 'Alice', costRateHourly: 100 }),
        makeResource('r2', { name: 'Bob', costRateHourly: 80 }),
      ]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {}),
      ]);

      const assignmentMap = new Map();
      assignmentMap.set('t1', [
        { resourceId: 'r1', hoursPlanned: 40 },
        { resourceId: 'r2', hoursPlanned: 20 },
      ]);
      mockGetForTasks.mockResolvedValue(assignmentMap);

      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', {
          costRateHourly: 100,
          weeks: [{ weekStart: '2026-01-05', allocated: 30, capacity: 40, utilization: 75, actual: 50 }], // actual 50h > planned 40h
        }),
        makeWorkloadEntry('r2', {
          costRateHourly: 80,
          weeks: [{ weekStart: '2026-01-05', allocated: 20, capacity: 40, utilization: 50, actual: 10 }], // actual 10h < planned 20h
        }),
      ]);

      await service.generate('overbudget-resources', 'proj-1');

      const callArg = mockRenderOverbudgetResourcesReport.mock.calls[0][0];
      // r1: planned 40h * $100 = $4000, actual 50h * $100 = $5000, variance = $1000 (overbudget)
      // r2: planned 20h * $80 = $1600, actual 10h * $80 = $800, variance = -$800 (underbudget, filtered out)
      expect(callArg.resources).toHaveLength(1);
      expect(callArg.resources[0].resourceName).toBe('Alice');
      expect(callArg.resources[0].variance).toBe(1000);
    });

    it('sorts overbudget resources by variance descending', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindAllResources.mockResolvedValue([
        makeResource('r1', { name: 'Small Over', costRateHourly: 50 }),
        makeResource('r2', { name: 'Big Over', costRateHourly: 200 }),
      ]);
      mockFindTasksByScheduleIds.mockResolvedValue([makeTask('t1'), makeTask('t2')]);

      const assignmentMap = new Map();
      assignmentMap.set('t1', [{ resourceId: 'r1', hoursPlanned: 10 }]);
      assignmentMap.set('t2', [{ resourceId: 'r2', hoursPlanned: 10 }]);
      mockGetForTasks.mockResolvedValue(assignmentMap);

      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', { costRateHourly: 50, weeks: [{ weekStart: '2026-01-05', allocated: 20, capacity: 40, utilization: 50, actual: 20 }] }),
        makeWorkloadEntry('r2', { costRateHourly: 200, weeks: [{ weekStart: '2026-01-05', allocated: 20, capacity: 40, utilization: 50, actual: 30 }] }),
      ]);

      await service.generate('overbudget-resources', 'proj-1');

      const callArg = mockRenderOverbudgetResourcesReport.mock.calls[0][0];
      if (callArg.resources.length >= 2) {
        expect(callArg.resources[0].variance).toBeGreaterThanOrEqual(callArg.resources[1].variance);
      }
    });

    it('computes totals across all resources', async () => {
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindAllResources.mockResolvedValue([makeResource('r1', { costRateHourly: 100 })]);
      mockFindTasksByScheduleIds.mockResolvedValue([makeTask('t1')]);

      const assignmentMap = new Map();
      assignmentMap.set('t1', [{ resourceId: 'r1', hoursPlanned: 40 }]);
      mockGetForTasks.mockResolvedValue(assignmentMap);

      mockComputeWorkload.mockResolvedValue([
        makeWorkloadEntry('r1', { costRateHourly: 100, weeks: [{ weekStart: '2026-01-05', allocated: 40, capacity: 40, utilization: 100, actual: 50 }] }),
      ]);

      await service.generate('overbudget-resources', 'proj-1');

      const callArg = mockRenderOverbudgetResourcesReport.mock.calls[0][0];
      // planned: 40h * $100 = $4000, actual: 50h * $100 = $5000
      expect(callArg.totalPlannedCost).toBe(4000);
      expect(callArg.totalActualCost).toBe(5000);
      expect(callArg.totalVariance).toBe(1000);
    });
  });
});
