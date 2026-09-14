import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before import
// ---------------------------------------------------------------------------
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: vi.fn(),
    completeToolLoop: vi.fn(),
    completeWithJsonSchema: vi.fn(),
  },
}));
vi.mock('../../config', () => ({
  config: { AI_ENABLED: true },
}));
vi.mock('../../services/ProjectService', () => ({
  projectService: {
    findAll: vi.fn(),
    findById: vi.fn(),
  },
}));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: vi.fn(),
    findTasksByScheduleIds: vi.fn(),
    findTasksByScheduleId: vi.fn(),
    findAllTasks: vi.fn(),
  },
}));
vi.mock('../../services/ResourceService', () => ({
  resourceService: {
    computeWorkload: vi.fn(),
  },
}));
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: {
    calculateCriticalPath: vi.fn(),
  },
}));
vi.mock('../../services/SCurveService', () => ({
  sCurveService: {
    computeSCurveData: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { NLQueryService } from '../../services/NLQueryService';
import { claudeService } from '../../services/claudeService';
import { config } from '../../config';
import { projectService } from '../../services/ProjectService';
import { scheduleService } from '../../services/ScheduleService';
import { resourceService } from '../../services/ResourceService';
import { criticalPathService } from '../../services/CriticalPathService';
import { sCurveService } from '../../services/SCurveService';

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------
const mockIsAvailable = claudeService.isAvailable as ReturnType<typeof vi.fn>;
const mockCompleteToolLoop = claudeService.completeToolLoop as ReturnType<typeof vi.fn>;
const mockCompleteWithJsonSchema = claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>;

const mockFindAll = projectService.findAll as ReturnType<typeof vi.fn>;
const mockFindById = projectService.findById as ReturnType<typeof vi.fn>;
const mockFindByProjectId = scheduleService.findByProjectId as ReturnType<typeof vi.fn>;
const mockFindTasksByScheduleIds = scheduleService.findTasksByScheduleIds as ReturnType<typeof vi.fn>;
const mockFindTasksByScheduleId = scheduleService.findTasksByScheduleId as ReturnType<typeof vi.fn>;
const mockFindAllTasks = scheduleService.findAllTasks as ReturnType<typeof vi.fn>;
const mockComputeWorkload = resourceService.computeWorkload as ReturnType<typeof vi.fn>;
const mockCalculateCriticalPath = criticalPathService.calculateCriticalPath as ReturnType<typeof vi.fn>;
const mockComputeSCurveData = sCurveService.computeSCurveData as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolLoopResult(overrides: Partial<{
  finalText: string;
  toolResults: Array<{ toolName: string; result: string }>;
}> = {}) {
  return {
    finalText: overrides.finalText ?? 'Here is your answer with 100 items and 50% progress.',
    toolResults: overrides.toolResults ?? [{ toolName: 'list_projects', result: '[]' }],
    totalUsage: { inputTokens: 100, outputTokens: 200 },
    totalLatencyMs: 500,
  };
}

function makeStructuredResult(overrides: Partial<{
  answer: string;
  charts: any[];
  suggestedFollowUps: string[];
}> = {}) {
  return {
    data: {
      answer: overrides.answer ?? 'Formatted answer',
      charts: overrides.charts ?? [],
      suggestedFollowUps: overrides.suggestedFollowUps ?? ['Follow-up 1', 'Follow-up 2'],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NLQueryService', () => {
  let service: NLQueryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NLQueryService();
    (config as any).AI_ENABLED = true;
    mockIsAvailable.mockReturnValue(true);
  });

  // -----------------------------------------------------------------------
  // processQuery — precondition checks
  // -----------------------------------------------------------------------

  describe('processQuery — precondition checks', () => {
    it('throws when AI_ENABLED is false', async () => {
      (config as any).AI_ENABLED = false;
      await expect(service.processQuery('show me projects')).rejects.toThrow(
        'AI features are disabled',
      );
      expect(mockCompleteToolLoop).not.toHaveBeenCalled();
    });

    it('throws when Claude service is unavailable', async () => {
      mockIsAvailable.mockReturnValue(false);
      await expect(service.processQuery('show me projects')).rejects.toThrow(
        'AI service is unavailable',
      );
      expect(mockCompleteToolLoop).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // processQuery — happy path
  // -----------------------------------------------------------------------

  describe('processQuery — happy path', () => {
    it('calls tool loop then structuring call and returns NLQueryResult', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult());
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      const result = await service.processQuery('How are my projects doing?');

      expect(mockCompleteToolLoop).toHaveBeenCalledOnce();
      expect(mockCompleteWithJsonSchema).toHaveBeenCalledOnce();

      expect(result.answer).toBe('Formatted answer');
      expect(result.charts).toEqual([]);
      expect(result.dataSources).toEqual(['list_projects']);
      expect(result.suggestedFollowUps).toEqual(['Follow-up 1', 'Follow-up 2']);
      expect(result.confidence).toBeGreaterThanOrEqual(40);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });

    it('passes project context to user message when projectId provided', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult());
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      await service.processQuery('Show budget', { projectId: 'proj-123' });

      const toolLoopCall = mockCompleteToolLoop.mock.calls[0][0];
      expect(toolLoopCall.userMessage).toContain('proj-123');
      expect(toolLoopCall.userMessage).toContain('currently viewing project');
    });

    it('does not append context when no projectId', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult());
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      await service.processQuery('Show all projects');

      const toolLoopCall = mockCompleteToolLoop.mock.calls[0][0];
      expect(toolLoopCall.userMessage).toBe('Show all projects');
    });

    it('passes correct tool loop options', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult());
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      await service.processQuery('test query');

      const toolLoopCall = mockCompleteToolLoop.mock.calls[0][0];
      expect(toolLoopCall.maxIterations).toBe(6);
      expect(toolLoopCall.temperature).toBe(0.2);
      expect(toolLoopCall.tools).toBeInstanceOf(Array);
      expect(toolLoopCall.tools.length).toBe(7);
      expect(typeof toolLoopCall.executeToolFn).toBe('function');
    });

    it('passes structuring options correctly', async () => {
      const toolResult = makeToolLoopResult({ finalText: 'Raw AI answer' });
      mockCompleteToolLoop.mockResolvedValue(toolResult);
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      await service.processQuery('test');

      const structCall = mockCompleteWithJsonSchema.mock.calls[0][0];
      expect(structCall.userMessage).toContain('Raw AI answer');
      expect(structCall.maxTokens).toBe(4096);
      expect(structCall.temperature).toBe(0.1);
    });

    it('deduplicates data sources', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult({
        toolResults: [
          { toolName: 'list_projects', result: '[]' },
          { toolName: 'list_projects', result: '[]' },
          { toolName: 'get_evm_metrics', result: '{}' },
        ],
      }));
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      const result = await service.processQuery('overview');

      expect(result.dataSources).toEqual(['list_projects', 'get_evm_metrics']);
    });

    it('returns charts from structured result', async () => {
      const charts = [
        {
          type: 'bar' as const,
          title: 'Budget by Project',
          data: [{ label: 'Project A', value: 50000 }],
        },
      ];
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult());
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult({ charts }));

      const result = await service.processQuery('budget breakdown');

      expect(result.charts).toEqual(charts);
    });
  });

  // -----------------------------------------------------------------------
  // processQuery — error propagation
  // -----------------------------------------------------------------------

  describe('processQuery — error propagation', () => {
    it('propagates error when tool loop fails', async () => {
      mockCompleteToolLoop.mockRejectedValue(new Error('API timeout'));

      await expect(service.processQuery('test')).rejects.toThrow('API timeout');
    });

    it('propagates error when structuring call fails', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult());
      mockCompleteWithJsonSchema.mockRejectedValue(new Error('Parse error'));

      await expect(service.processQuery('test')).rejects.toThrow('Parse error');
    });
  });

  // -----------------------------------------------------------------------
  // computeConfidence — heuristic scoring
  // -----------------------------------------------------------------------

  describe('computeConfidence (via processQuery)', () => {
    it('gives baseline 50 for 1 data source + short text', async () => {
      // 40 base + 10 (1 tool) = 50; text < 500 and few numbers
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult({
        finalText: 'Short answer.',
        toolResults: [{ toolName: 'list_projects', result: '[]' }],
      }));
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      const result = await service.processQuery('test');
      expect(result.confidence).toBe(50);
    });

    it('increases confidence with more data sources', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult({
        finalText: 'Short answer.',
        toolResults: [
          { toolName: 'list_projects', result: '[]' },
          { toolName: 'get_evm_metrics', result: '{}' },
          { toolName: 'get_critical_path', result: '{}' },
        ],
      }));
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      const result = await service.processQuery('test');
      // 40 base + 30 (3 tools) = 70
      expect(result.confidence).toBe(70);
    });

    it('increases confidence for longer answers', async () => {
      const longText = 'a'.repeat(600);
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult({
        finalText: longText,
        toolResults: [{ toolName: 'list_projects', result: '[]' }],
      }));
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      const result = await service.processQuery('test');
      // 40 base + 10 (1 tool) + 10 (>500 chars) = 60
      expect(result.confidence).toBe(60);
    });

    it('increases confidence for very long answers', async () => {
      const veryLongText = 'a'.repeat(1600);
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult({
        finalText: veryLongText,
        toolResults: [{ toolName: 'list_projects', result: '[]' }],
      }));
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      const result = await service.processQuery('test');
      // 40 base + 10 (1 tool) + 10 (>500) + 10 (>1500) = 70
      expect(result.confidence).toBe(70);
    });

    it('increases confidence when numbers appear in text', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult({
        finalText: 'Budget is 50000, spent 30000, progress 60%.',
        toolResults: [{ toolName: 'list_projects', result: '[]' }],
      }));
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      const result = await service.processQuery('test');
      // 40 base + 10 (1 tool) + 10 (3+ numbers) = 60
      expect(result.confidence).toBe(60);
    });

    it('caps confidence at 100', async () => {
      // 4+ tools (capped at 30) + >1500 chars (+20) + numbers (+10) = 40+30+20+10 = 100
      const longTextWithNumbers = 'Budget 50000, spent 30000, progress 60%. ' + 'x'.repeat(1600);
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult({
        finalText: longTextWithNumbers,
        toolResults: [
          { toolName: 'list_projects', result: '[]' },
          { toolName: 'get_evm_metrics', result: '{}' },
          { toolName: 'get_critical_path', result: '{}' },
          { toolName: 'get_resource_workload', result: '{}' },
        ],
      }));
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      const result = await service.processQuery('test');
      expect(result.confidence).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // executeToolFn — tool dispatch (tested via the tool loop callback)
  // -----------------------------------------------------------------------

  describe('executeToolFn — tool dispatch', () => {
    // To test executeToolFn, we capture it from the completeToolLoop call
    // and invoke it directly.

    let executeToolFn: (toolName: string, toolInput: Record<string, any>) => Promise<string>;

    beforeEach(async () => {
      mockCompleteToolLoop.mockImplementation(async (opts: any) => {
        executeToolFn = opts.executeToolFn;
        return makeToolLoopResult();
      });
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());
      await service.processQuery('trigger');
    });

    it('list_projects — returns project summaries', async () => {
      mockFindAll.mockResolvedValue([
        {
          id: 'p1', name: 'Alpha', status: 'active', priority: 'high',
          projectType: 'software', budgetAllocated: 100000, budgetSpent: 50000,
          currency: 'USD', startDate: '2026-01-01', endDate: '2026-12-31',
        },
      ]);

      const result = JSON.parse(await executeToolFn('list_projects', {}));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
      expect(result[0].name).toBe('Alpha');
      expect(result[0].budgetAllocated).toBe(100000);
    });

    it('get_project_details — returns project with schedules and tasks', async () => {
      mockFindById.mockResolvedValue({
        id: 'p1', name: 'Alpha', description: 'Desc', status: 'active',
        priority: 'high', projectType: 'software', budgetAllocated: 100000,
        budgetSpent: 50000, currency: 'USD', location: 'Remote',
        startDate: '2026-01-01', endDate: '2026-12-31',
      });
      mockFindByProjectId.mockResolvedValue([
        { id: 's1', name: 'Schedule 1', status: 'active', startDate: '2026-01-01', endDate: '2026-06-30' },
      ]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        {
          id: 't1', scheduleId: 's1', name: 'Task 1', status: 'in_progress', priority: 'high',
          progressPercentage: 50, startDate: '2026-01-01', endDate: '2026-03-01',
          dependency: null, dependencies: [], assignedTo: 'user1',
        },
      ]);

      const result = JSON.parse(await executeToolFn('get_project_details', { projectId: 'p1' }));

      expect(result.id).toBe('p1');
      expect(result.schedules).toHaveLength(1);
      expect(result.schedules[0].tasks).toHaveLength(1);
      expect(result.schedules[0].tasks[0].name).toBe('Task 1');
    });

    it('get_project_details — returns error for unknown project', async () => {
      mockFindById.mockResolvedValue(null);

      const result = JSON.parse(await executeToolFn('get_project_details', { projectId: 'unknown' }));

      expect(result.error).toContain('not found');
    });

    it('list_tasks — returns tasks for schedule', async () => {
      mockFindTasksByScheduleId.mockResolvedValue([
        {
          id: 't1', name: 'Task 1', status: 'completed', priority: 'medium',
          progressPercentage: 100, startDate: '2026-01-01', endDate: '2026-02-01',
          dependency: null, dependencies: [{ dependencyId: 't0', dependencyType: 'FS', lagDays: 0 }],
          parentTaskId: null, assignedTo: 'user1',
        },
      ]);

      const result = JSON.parse(await executeToolFn('list_tasks', { scheduleId: 's1' }));

      expect(result).toHaveLength(1);
      expect(result[0].dependencies).toHaveLength(1);
      expect(result[0].dependencies[0].type).toBe('FS');
    });

    it('get_resource_workload — delegates to resourceService', async () => {
      const workloadData = [{ resourceId: 'r1', utilization: 85 }];
      mockComputeWorkload.mockResolvedValue(workloadData);

      const result = JSON.parse(await executeToolFn('get_resource_workload', { projectId: 'p1' }));

      expect(mockComputeWorkload).toHaveBeenCalledWith('p1');
      expect(result).toEqual(workloadData);
    });

    it('get_evm_metrics — computes CPI, SPI, EAC from S-curve data', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      mockComputeSCurveData.mockResolvedValue([
        { date: pastDate.toISOString(), pv: 1000, ev: 900, ac: 800 },
      ]);
      mockFindById.mockResolvedValue({ budgetAllocated: 10000 });

      const result = JSON.parse(await executeToolFn('get_evm_metrics', { projectId: 'p1' }));

      expect(result.currentMetrics).toBeDefined();
      expect(result.currentMetrics.cpi).toBeCloseTo(1.125, 2); // 900/800
      expect(result.currentMetrics.spi).toBeCloseTo(0.9, 2);   // 900/1000
      expect(result.currentMetrics.eac).toBeDefined();
    });

    it('get_evm_metrics — returns null metrics when no data points', async () => {
      mockComputeSCurveData.mockResolvedValue([]);

      const result = JSON.parse(await executeToolFn('get_evm_metrics', { projectId: 'p1' }));

      expect(result.currentMetrics).toBeNull();
    });

    it('get_evm_metrics — handles zero ac (cpi null)', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      mockComputeSCurveData.mockResolvedValue([
        { date: pastDate.toISOString(), pv: 1000, ev: 500, ac: 0 },
      ]);
      mockFindById.mockResolvedValue({ budgetAllocated: 10000 });

      const result = JSON.parse(await executeToolFn('get_evm_metrics', { projectId: 'p1' }));

      expect(result.currentMetrics.cpi).toBeNull();
      expect(result.currentMetrics.eac).toBeNull();
    });

    it('get_critical_path — delegates to criticalPathService', async () => {
      const cpResult = { criticalTasks: ['t1', 't2'], totalDuration: 30 };
      mockCalculateCriticalPath.mockResolvedValue(cpResult);

      const result = JSON.parse(await executeToolFn('get_critical_path', { scheduleId: 's1' }));

      expect(mockCalculateCriticalPath).toHaveBeenCalledWith('s1');
      expect(result).toEqual(cpResult);
    });

    it('aggregate_portfolio_stats — computes breakdowns', async () => {
      mockFindAll.mockResolvedValue([
        { status: 'active', priority: 'high', projectType: 'software', budgetAllocated: 50000, budgetSpent: 20000 },
        { status: 'active', priority: 'low', projectType: 'marketing', budgetAllocated: 30000, budgetSpent: 10000 },
        { status: 'completed', priority: 'high', projectType: 'software', budgetAllocated: 20000, budgetSpent: 20000 },
      ]);
      mockFindAllTasks.mockResolvedValue([
        { status: 'completed', progressPercentage: 100 },
        { status: 'in_progress', progressPercentage: 50 },
      ]);

      const result = JSON.parse(await executeToolFn('aggregate_portfolio_stats', {}));

      expect(result.totalProjects).toBe(3);
      expect(result.totalTasks).toBe(2);
      expect(result.totalBudgetAllocated).toBe(100000);
      expect(result.totalBudgetSpent).toBe(50000);
      expect(result.budgetUtilization).toBe(50);
      expect(result.projectStatusBreakdown.active).toBe(2);
      expect(result.projectStatusBreakdown.completed).toBe(1);
      expect(result.projectPriorityBreakdown.high).toBe(2);
      expect(result.projectPriorityBreakdown.low).toBe(1);
      expect(result.projectTypeBreakdown.software).toBe(2);
      expect(result.taskStatusBreakdown.completed).toBe(1);
      expect(result.taskStatusBreakdown.in_progress).toBe(1);
      expect(result.averageTaskProgress).toBe(75);
    });

    it('aggregate_portfolio_stats — handles empty portfolio', async () => {
      mockFindAll.mockResolvedValue([]);
      mockFindAllTasks.mockResolvedValue([]);

      const result = JSON.parse(await executeToolFn('aggregate_portfolio_stats', {}));

      expect(result.totalProjects).toBe(0);
      expect(result.totalTasks).toBe(0);
      expect(result.totalBudgetAllocated).toBe(0);
      expect(result.budgetUtilization).toBe(0);
      expect(result.averageTaskProgress).toBe(0);
    });

    it('unknown tool — returns error JSON', async () => {
      const result = JSON.parse(await executeToolFn('nonexistent_tool', {}));

      expect(result.error).toContain('Unknown tool');
      expect(result.error).toContain('nonexistent_tool');
    });
  });

  // -----------------------------------------------------------------------
  // Tool definitions
  // -----------------------------------------------------------------------

  describe('tool definitions', () => {
    it('provides 7 tool definitions to the tool loop', async () => {
      mockCompleteToolLoop.mockResolvedValue(makeToolLoopResult());
      mockCompleteWithJsonSchema.mockResolvedValue(makeStructuredResult());

      await service.processQuery('test');

      const tools = mockCompleteToolLoop.mock.calls[0][0].tools;
      expect(tools).toHaveLength(7);

      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('list_projects');
      expect(toolNames).toContain('get_project_details');
      expect(toolNames).toContain('list_tasks');
      expect(toolNames).toContain('get_resource_workload');
      expect(toolNames).toContain('get_evm_metrics');
      expect(toolNames).toContain('get_critical_path');
      expect(toolNames).toContain('aggregate_portfolio_stats');
    });
  });
});
