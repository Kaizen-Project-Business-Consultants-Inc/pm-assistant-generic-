import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before import
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: vi.fn(),
    completeWithJsonSchema: vi.fn(),
  },
  promptTemplates: {
    projectInsights: {
      render: vi.fn().mockReturnValue('rendered project insights prompt'),
    },
  },
  PromptTemplate: vi.fn().mockImplementation((template: string) => ({
    render: vi.fn().mockImplementation((vars: Record<string, string>) => {
      let result = template;
      for (const [key, value] of Object.entries(vars)) {
        result = result.replace(`{{${key}}}`, value);
      }
      return result;
    }),
  })),
}));

vi.mock('../../services/aiUsageLogger', () => ({
  logAIUsage: vi.fn(),
}));

vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: vi.fn().mockImplementation(() => ({
    buildProjectContext: vi.fn(),
    toPromptString: vi.fn(),
  })),
}));

vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: vi.fn(),
  },
}));

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn() },
}));

vi.mock('../../config', () => ({
  config: { AI_ENABLED: true },
}));

import {
  suggestDependenciesClaude,
  optimizeScheduleClaude,
  generateProjectInsightsClaude,
  schedulingPromptTemplates,
} from '../../services/aiSchedulingClaude';
import { claudeService } from '../../services/claudeService';
import { logAIUsage } from '../../services/aiUsageLogger';
import { AIContextBuilder } from '../../services/aiContextBuilder';
import { scheduleService } from '../../services/ScheduleService';

const mockIsAvailable = claudeService.isAvailable as ReturnType<typeof vi.fn>;
const mockComplete = claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>;
const mockLogAIUsage = logAIUsage as ReturnType<typeof vi.fn>;

const mockFastify = {
  log: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
} as any;

describe('aiSchedulingClaude', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── suggestDependenciesClaude ──────────────────────────────────────

  describe('suggestDependenciesClaude', () => {
    const sampleTasks = [
      { id: '1', name: 'Requirements gathering', category: 'planning' },
      { id: '2', name: 'UI design', category: 'design' },
      { id: '3', name: 'Backend development', category: 'development' },
      { id: '4', name: 'Integration testing', category: 'testing' },
    ];

    it('returns AI-powered dependencies when Claude is available', async () => {
      mockIsAvailable.mockReturnValue(true);
      const aiDeps = [
        { fromTask: '1', toTask: '2', type: 'finish-to-start', confidence: 0.95, reason: 'Design follows planning' },
        { fromTask: '2', toTask: '3', type: 'finish-to-start', confidence: 0.9, reason: 'Dev follows design' },
      ];
      mockComplete.mockResolvedValue({
        data: { dependencies: aiDeps },
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 500,
      });

      const result = await suggestDependenciesClaude(sampleTasks, 'Software project', mockFastify, 'user-1');

      expect(result.aiPowered).toBe(true);
      expect(result.dependencies).toEqual(aiDeps);
      expect(mockComplete).toHaveBeenCalledOnce();
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'dependency-suggestion',
          model: 'claude',
          success: true,
          userId: 'user-1',
        }),
      );
    });

    it('returns fallback dependencies when Claude is not available', async () => {
      mockIsAvailable.mockReturnValue(false);

      const result = await suggestDependenciesClaude(sampleTasks);

      expect(result.aiPowered).toBe(false);
      expect(result.dependencies.length).toBeGreaterThan(0);
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns fallback dependencies when Claude throws an error', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue(new Error('API timeout'));

      const result = await suggestDependenciesClaude(sampleTasks, undefined, mockFastify, 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(result.dependencies.length).toBeGreaterThan(0);
      expect(mockFastify.log.warn).toHaveBeenCalled();
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'dependency-suggestion',
          success: false,
          errorMessage: 'API timeout',
        }),
      );
    });

    it('logs usage with fastify when provided', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({
        data: { dependencies: [] },
        usage: { inputTokens: 200, outputTokens: 100 },
        latencyMs: 300,
      });

      await suggestDependenciesClaude(sampleTasks, undefined, mockFastify, 'user-2');

      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-2',
          usage: { inputTokens: 200, outputTokens: 100 },
          latencyMs: 300,
        }),
      );
    });

    it('does not log usage when fastify is not provided', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({
        data: { dependencies: [] },
        usage: { inputTokens: 50, outputTokens: 25 },
        latencyMs: 100,
      });

      await suggestDependenciesClaude(sampleTasks);

      expect(mockLogAIUsage).not.toHaveBeenCalled();
    });

    it('does not log usage on error when fastify is not provided', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue(new Error('Fail'));

      await suggestDependenciesClaude(sampleTasks);

      expect(mockLogAIUsage).not.toHaveBeenCalled();
      expect(mockFastify.log.warn).not.toHaveBeenCalled();
    });

    it('includes project context in the prompt when provided', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({
        data: { dependencies: [] },
        usage: { inputTokens: 50, outputTokens: 25 },
        latencyMs: 100,
      });

      await suggestDependenciesClaude(sampleTasks, 'Construction project');

      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('Construction project'),
        }),
      );
    });

    it('handles non-Error exception objects in catch block', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue('string error');

      const result = await suggestDependenciesClaude(sampleTasks, undefined, mockFastify, 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'string error',
        }),
      );
    });
  });

  // ─── fallbackDependencies (tested indirectly) ──────────────────────

  describe('fallbackDependencies (indirect)', () => {
    it('creates planning -> design dependencies', async () => {
      mockIsAvailable.mockReturnValue(false);
      const tasks = [
        { id: 'p1', name: 'Requirements', category: 'planning' },
        { id: 'd1', name: 'Wireframes', category: 'design' },
      ];

      const result = await suggestDependenciesClaude(tasks);

      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ fromTask: 'p1', toTask: 'd1', type: 'finish-to-start' }),
      );
    });

    it('creates design -> development dependencies', async () => {
      mockIsAvailable.mockReturnValue(false);
      const tasks = [
        { id: 'd1', name: 'UI design', category: 'design' },
        { id: 'dev1', name: 'Frontend development', category: 'development' },
      ];

      const result = await suggestDependenciesClaude(tasks);

      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ fromTask: 'd1', toTask: 'dev1' }),
      );
    });

    it('creates development -> testing dependencies', async () => {
      mockIsAvailable.mockReturnValue(false);
      const tasks = [
        { id: 'dev1', name: 'Backend development', category: 'development' },
        { id: 't1', name: 'QA testing', category: 'testing' },
      ];

      const result = await suggestDependenciesClaude(tasks);

      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ fromTask: 'dev1', toTask: 't1' }),
      );
    });

    it('matches tasks by name when category is absent', async () => {
      mockIsAvailable.mockReturnValue(false);
      const tasks = [
        { id: '1', name: 'Gather requirements' },
        { id: '2', name: 'System design' },
      ];

      const result = await suggestDependenciesClaude(tasks);

      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ fromTask: '1', toTask: '2' }),
      );
    });

    it('returns empty array when no tasks match known categories', async () => {
      mockIsAvailable.mockReturnValue(false);
      const tasks = [
        { id: '1', name: 'Buy groceries' },
        { id: '2', name: 'Cook dinner' },
      ];

      const result = await suggestDependenciesClaude(tasks);

      expect(result.dependencies).toEqual([]);
    });

    it('creates cross-product of dependencies for multiple tasks in each category', async () => {
      mockIsAvailable.mockReturnValue(false);
      const tasks = [
        { id: 'p1', name: 'Phase 1 planning', category: 'planning' },
        { id: 'p2', name: 'Phase 2 planning', category: 'planning' },
        { id: 'd1', name: 'Design A', category: 'design' },
        { id: 'd2', name: 'Design B', category: 'design' },
      ];

      const result = await suggestDependenciesClaude(tasks);

      // 2 planning x 2 design = 4 dependencies
      expect(result.dependencies).toHaveLength(4);
    });
  });

  // ─── optimizeScheduleClaude ─────────────────────────────────────────

  describe('optimizeScheduleClaude', () => {
    const mockScheduleService = scheduleService.findTasksByScheduleId as ReturnType<typeof vi.fn>;

    it('returns AI-powered optimization when Claude is available and tasks exist', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockScheduleService.mockResolvedValue([
        { name: 'Task A', status: 'in-progress', priority: 'high', estimatedDays: 5, dueDate: '2026-10-01' },
        { name: 'Task B', status: 'not-started', priority: 'medium', estimatedDays: 3, dueDate: '2026-10-15' },
      ]);

      const aiResult = {
        tasks: [{ taskId: '1', suggestedStart: '2026-09-15', suggestedEnd: '2026-09-20', reasoning: 'Parallel' }],
        improvements: { durationReduction: 15, riskReduction: 10, resourceUtilization: 85 },
      };
      mockComplete.mockResolvedValue({
        data: aiResult,
        usage: { inputTokens: 300, outputTokens: 150 },
        latencyMs: 800,
      });

      const result = await optimizeScheduleClaude('sched-1', ['minimize-duration'], {}, mockFastify, 'user-1');

      expect(result.aiPowered).toBe(true);
      expect(result.optimizedSchedule).toEqual(aiResult);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'schedule-optimization',
          success: true,
          requestContext: { scheduleId: 'sched-1', goals: ['minimize-duration'] },
        }),
      );
    });

    it('returns fallback when Claude is not available', async () => {
      mockIsAvailable.mockReturnValue(false);
      mockScheduleService.mockResolvedValue([
        { name: 'Task A', status: 'in-progress', priority: 'high', estimatedDays: 5 },
      ]);

      const result = await optimizeScheduleClaude('sched-1', [], {}, mockFastify);

      expect(result.aiPowered).toBe(false);
      expect(result.optimizedSchedule.tasks).toEqual([]);
      expect(result.optimizedSchedule.improvements).toEqual({
        durationReduction: 0, riskReduction: 0, resourceUtilization: 0,
      });
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns fallback when schedule has no tasks', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockScheduleService.mockResolvedValue([]);

      const result = await optimizeScheduleClaude('sched-1', ['balance-resources'], {}, mockFastify);

      expect(result.aiPowered).toBe(false);
      expect(result.optimizedSchedule.tasks).toEqual([]);
    });

    it('returns fallback when schedule service throws', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockScheduleService.mockRejectedValue(new Error('DB error'));

      const result = await optimizeScheduleClaude('sched-1', [], {}, mockFastify);

      // scheduleData will be empty string, so fallback
      expect(result.aiPowered).toBe(false);
    });

    it('returns fallback when Claude call throws', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockScheduleService.mockResolvedValue([
        { name: 'Task A', status: 'done', priority: 'low', estimatedDays: 2 },
      ]);
      mockComplete.mockRejectedValue(new Error('Rate limited'));

      const result = await optimizeScheduleClaude('sched-1', ['minimize-duration'], {}, mockFastify, 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(mockFastify.log.warn).toHaveBeenCalled();
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'schedule-optimization',
          success: false,
          errorMessage: 'Rate limited',
        }),
      );
    });

    it('uses default goals when none provided', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockScheduleService.mockResolvedValue([
        { name: 'Task A', status: 'not-started', priority: 'medium', estimatedDays: 4 },
      ]);
      mockComplete.mockResolvedValue({
        data: { tasks: [], improvements: { durationReduction: 0, riskReduction: 0, resourceUtilization: 0 } },
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 200,
      });

      await optimizeScheduleClaude('sched-1', [], {}, mockFastify);

      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('minimize-duration, balance-resources'),
        }),
      );
    });

    it('handles non-Error exception in catch block', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockScheduleService.mockResolvedValue([
        { name: 'Task A', status: 'done', priority: 'low', estimatedDays: 1 },
      ]);
      mockComplete.mockRejectedValue(42);

      const result = await optimizeScheduleClaude('sched-1', [], {}, mockFastify, 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: '42',
        }),
      );
    });
  });

  // ─── generateProjectInsightsClaude ──────────────────────────────────

  describe('generateProjectInsightsClaude', () => {
    let mockContextBuilder: { buildProjectContext: ReturnType<typeof vi.fn>; toPromptString: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockContextBuilder = {
        buildProjectContext: vi.fn(),
        toPromptString: vi.fn(),
      };
      (AIContextBuilder as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockContextBuilder);
    });

    it('returns AI-powered insights when Claude is available', async () => {
      mockContextBuilder.buildProjectContext.mockResolvedValue({ project: { name: 'Test' } });
      mockContextBuilder.toPromptString.mockReturnValue('Project: Test');
      mockIsAvailable.mockReturnValue(true);

      const aiInsights = {
        performanceMetrics: { spiValue: 0.95 },
        riskIndicators: [{ severity: 'high', description: 'Deadline risk' }],
        recommendations: ['Add buffer time'],
        trends: { velocity: 'improving' },
      };
      mockComplete.mockResolvedValue({
        data: aiInsights,
        usage: { inputTokens: 500, outputTokens: 200 },
        latencyMs: 1200,
      });

      const result = await generateProjectInsightsClaude('proj-1', mockFastify, 'user-1');

      expect(result.aiPowered).toBe(true);
      expect(result.insights).toEqual(aiInsights);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'project-insights',
          success: true,
          requestContext: { projectId: 'proj-1' },
        }),
      );
    });

    it('returns fallback when context building fails', async () => {
      mockContextBuilder.buildProjectContext.mockRejectedValue(new Error('Project not found'));

      const result = await generateProjectInsightsClaude('proj-bad', mockFastify);

      expect(result.aiPowered).toBe(false);
      expect(result.insights).toEqual({
        performanceMetrics: {},
        riskIndicators: [],
        recommendations: [],
        trends: {},
      });
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns fallback when Claude is not available', async () => {
      mockContextBuilder.buildProjectContext.mockResolvedValue({ project: { name: 'Test' } });
      mockContextBuilder.toPromptString.mockReturnValue('Project: Test');
      mockIsAvailable.mockReturnValue(false);

      const result = await generateProjectInsightsClaude('proj-1', mockFastify);

      expect(result.aiPowered).toBe(false);
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns fallback when Claude call throws', async () => {
      mockContextBuilder.buildProjectContext.mockResolvedValue({ project: { name: 'Test' } });
      mockContextBuilder.toPromptString.mockReturnValue('Project: Test');
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue(new Error('Service unavailable'));

      const result = await generateProjectInsightsClaude('proj-1', mockFastify, 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(mockFastify.log.warn).toHaveBeenCalled();
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'project-insights',
          success: false,
          errorMessage: 'Service unavailable',
        }),
      );
    });

    it('handles non-Error exception in catch block', async () => {
      mockContextBuilder.buildProjectContext.mockResolvedValue({ project: { name: 'Test' } });
      mockContextBuilder.toPromptString.mockReturnValue('Project: Test');
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue({ code: 500 });

      const result = await generateProjectInsightsClaude('proj-1', mockFastify, 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: '[object Object]',
        }),
      );
    });
  });

  // ─── schedulingPromptTemplates ──────────────────────────────────────

  describe('schedulingPromptTemplates', () => {
    it('exports dependencyDetection template', () => {
      expect(schedulingPromptTemplates.dependencyDetection).toBeDefined();
      expect(schedulingPromptTemplates.dependencyDetection.render).toBeDefined();
    });

    it('exports scheduleOptimization template', () => {
      expect(schedulingPromptTemplates.scheduleOptimization).toBeDefined();
      expect(schedulingPromptTemplates.scheduleOptimization.render).toBeDefined();
    });
  });
});
