import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockClaudeComplete = vi.fn();
const mockClaudeIsAvailable = vi.fn();
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    complete: (...args: any[]) => mockClaudeComplete(...args),
    isAvailable: (...args: any[]) => mockClaudeIsAvailable(...args),
  },
}));

const mockProjectFindById = vi.fn();
const mockProjectFindAll = vi.fn();
vi.mock('../../services/ProjectService', () => ({
  projectService: {
    findById: (...args: any[]) => mockProjectFindById(...args),
    findAll: (...args: any[]) => mockProjectFindAll(...args),
  },
}));

const mockScheduleFindByProjectId = vi.fn();
const mockScheduleFindTasksByScheduleIds = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: (...args: any[]) => mockScheduleFindByProjectId(...args),
    findTasksByScheduleIds: (...args: any[]) => mockScheduleFindTasksByScheduleIds(...args),
  },
}));

const mockComputeWorkload = vi.fn();
vi.mock('../../services/ResourceService', () => ({
  resourceService: {
    computeWorkload: (...args: any[]) => mockComputeWorkload(...args),
  },
}));

const mockAssembleForProject = vi.fn();
vi.mock('../../services/agents/InsightAssemblyService', () => ({
  insightAssemblyService: {
    assembleForProject: (...args: any[]) => mockAssembleForProject(...args),
  },
}));

vi.mock('../../utils/promptSanitizer', () => ({
  sanitizeForPrompt: (s: string) => s,
}));

import { NarrativeService } from '../../services/NarrativeService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeProject(overrides: Record<string, any> = {}) {
  return {
    id: 'proj-1',
    name: 'Test Project',
    status: 'active',
    budgetAllocated: 100000,
    budgetSpent: 50000,
    ...overrides,
  };
}

function makeInsights(overrides: Record<string, any> = {}) {
  return {
    overallHealth: 'good',
    agentFindings: [],
    ...overrides,
  };
}

function makeTask(id: string, status: string = 'not_started') {
  return { id, status };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('NarrativeService', () => {
  let service: NarrativeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NarrativeService();
  });

  // ── generateProjectNarrative ─────────────────────────────────────
  describe('generateProjectNarrative', () => {
    it('returns "Project not found." when project does not exist', async () => {
      mockProjectFindById.mockResolvedValue(null);

      const result = await service.generateProjectNarrative('missing-id', 'project_manager');

      expect(result).toBe('Project not found.');
      expect(mockProjectFindById).toHaveBeenCalledWith('missing-id');
    });

    it('returns fallback narrative when Claude is not available', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(false);

      const result = await service.generateProjectNarrative('proj-1', 'project_manager');

      expect(result).toBe('Test Project is currently active. Budget utilization is at 50%.');
      expect(mockClaudeComplete).not.toHaveBeenCalled();
    });

    it('generates AI narrative when Claude is available', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights());
      mockScheduleFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', 'completed'),
        makeTask('t2', 'in_progress'),
        makeTask('t3', 'not_started'),
      ]);
      mockComputeWorkload.mockResolvedValue([]);
      mockClaudeComplete.mockResolvedValue({ content: '  AI generated summary.  ' });

      const result = await service.generateProjectNarrative('proj-1', 'project_manager');

      expect(result).toBe('AI generated summary.');
      expect(mockClaudeComplete).toHaveBeenCalledTimes(1);
      const callArgs = mockClaudeComplete.mock.calls[0][0];
      expect(callArgs.maxTokens).toBe(300);
      expect(callArgs.temperature).toBe(0.4);
      expect(callArgs.userMessage).toContain('1/3 complete');
      expect(callArgs.userMessage).toContain('$50000 of $100000 spent');
      expect(callArgs.userMessage).toContain('schedule adherence');
    });

    it('includes resource summary when workload data exists', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights());
      mockScheduleFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([
        { isOverAllocated: true, averageUtilization: 120 },
        { isOverAllocated: false, averageUtilization: 80 },
      ]);
      mockClaudeComplete.mockResolvedValue({ content: 'Summary with resources.' });

      const result = await service.generateProjectNarrative('proj-1', 'project_manager');

      expect(result).toBe('Summary with resources.');
      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).toContain('Resources: 2 assigned, 1 over-allocated, 100% avg utilization');
    });

    it('handles resource workload errors gracefully (non-critical)', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights());
      mockScheduleFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);
      mockComputeWorkload.mockRejectedValue(new Error('Resource service down'));
      mockClaudeComplete.mockResolvedValue({ content: 'Summary without resources.' });

      const result = await service.generateProjectNarrative('proj-1', 'project_manager');

      expect(result).toBe('Summary without resources.');
      // Prompt should NOT contain resource summary
      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).not.toContain('Resources:');
    });

    it('falls back to non-AI narrative when Claude.complete throws', async () => {
      mockProjectFindById.mockResolvedValue(makeProject({ budgetAllocated: 200000, budgetSpent: 100000 }));
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights());
      mockScheduleFindByProjectId.mockResolvedValue([]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([]);
      mockClaudeComplete.mockRejectedValue(new Error('API timeout'));

      const result = await service.generateProjectNarrative('proj-1', 'project_manager');

      expect(result).toBe('Test Project is currently active. Budget utilization is at 50%.');
    });

    it('includes agent findings in the prompt', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights({
        agentFindings: [
          { agent: 'RiskAgent', finding: '2 high risks' },
          { agent: 'ScheduleAgent', finding: 'behind schedule' },
        ],
      }));
      mockScheduleFindByProjectId.mockResolvedValue([]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([]);
      mockClaudeComplete.mockResolvedValue({ content: 'Summary with findings.' });

      await service.generateProjectNarrative('proj-1', 'project_manager');

      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).toContain('RiskAgent: 2 high risks; ScheduleAgent: behind schedule');
    });

    it('handles zero budget gracefully in fallback', async () => {
      mockProjectFindById.mockResolvedValue(makeProject({ budgetAllocated: 0, budgetSpent: 0 }));
      mockClaudeIsAvailable.mockReturnValue(false);

      const result = await service.generateProjectNarrative('proj-1', 'project_manager');

      expect(result).toBe('Test Project is currently active. Budget utilization is at 0%.');
    });

    it('handles null budget values in fallback', async () => {
      mockProjectFindById.mockResolvedValue(makeProject({ budgetAllocated: null, budgetSpent: null }));
      mockClaudeIsAvailable.mockReturnValue(false);

      const result = await service.generateProjectNarrative('proj-1', 'project_manager');

      expect(result).toBe('Test Project is currently active. Budget utilization is at 0%.');
    });

    it('passes correct role focus for different roles', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights());
      mockScheduleFindByProjectId.mockResolvedValue([]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([]);
      mockClaudeComplete.mockResolvedValue({ content: 'OK' });

      await service.generateProjectNarrative('proj-1', 'finance_officer');
      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).toContain('budget utilization, cost variances, and financial risks');
    });

    it('uses default role focus for unknown roles', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights());
      mockScheduleFindByProjectId.mockResolvedValue([]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([]);
      mockClaudeComplete.mockResolvedValue({ content: 'OK' });

      // viewer, qa, tester, etc. hit the default case
      await service.generateProjectNarrative('proj-1', 'viewer');
      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).toContain('overall project health and key action items');
    });

    it('passes multiple schedule IDs for task lookup', async () => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights());
      mockScheduleFindByProjectId.mockResolvedValue([{ id: 'sch-1' }, { id: 'sch-2' }, { id: 'sch-3' }]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([]);
      mockClaudeComplete.mockResolvedValue({ content: 'OK' });

      await service.generateProjectNarrative('proj-1', 'project_manager');

      expect(mockScheduleFindTasksByScheduleIds).toHaveBeenCalledWith(['sch-1', 'sch-2', 'sch-3']);
    });
  });

  // ── generatePortfolioNarrative ────────────────────────────────────
  describe('generatePortfolioNarrative', () => {
    it('returns fallback when Claude is not available', async () => {
      mockProjectFindAll.mockResolvedValue([
        makeProject({ status: 'active' }),
        makeProject({ status: 'active' }),
        makeProject({ status: 'completed' }),
      ]);
      mockClaudeIsAvailable.mockReturnValue(false);

      const result = await service.generatePortfolioNarrative('executive');

      expect(result).toBe('You have 2 active project(s) in your portfolio.');
      expect(mockClaudeComplete).not.toHaveBeenCalled();
    });

    it('generates AI narrative for portfolio', async () => {
      mockProjectFindAll.mockResolvedValue([
        makeProject({ name: 'Alpha', status: 'active', budgetAllocated: 100000, budgetSpent: 30000 }),
        makeProject({ name: 'Beta', status: 'planning', budgetAllocated: 50000, budgetSpent: 0 }),
        makeProject({ name: 'Done', status: 'completed' }),
      ]);
      mockClaudeIsAvailable.mockReturnValue(true);
      mockClaudeComplete.mockResolvedValue({ content: '  Portfolio looks healthy.  ' });

      const result = await service.generatePortfolioNarrative('executive');

      expect(result).toBe('Portfolio looks healthy.');
      const callArgs = mockClaudeComplete.mock.calls[0][0];
      expect(callArgs.userMessage).toContain('Active projects (2)');
      expect(callArgs.userMessage).toContain('Alpha');
      expect(callArgs.userMessage).toContain('Beta');
      expect(callArgs.userMessage).not.toContain('Done');
      expect(callArgs.userMessage).toContain('high-level status, strategic risks, and portfolio health');
    });

    it('falls back when Claude.complete throws', async () => {
      mockProjectFindAll.mockResolvedValue([
        makeProject({ status: 'active' }),
      ]);
      mockClaudeIsAvailable.mockReturnValue(true);
      mockClaudeComplete.mockRejectedValue(new Error('rate limited'));

      const result = await service.generatePortfolioNarrative('project_manager');

      expect(result).toBe('You have 1 active project(s) in your portfolio.');
    });

    it('limits project summaries to 10 in prompt', async () => {
      const projects = Array.from({ length: 15 }, (_, i) =>
        makeProject({ name: `Project ${i}`, status: 'active', budgetAllocated: 100, budgetSpent: 50 })
      );
      mockProjectFindAll.mockResolvedValue(projects);
      mockClaudeIsAvailable.mockReturnValue(true);
      mockClaudeComplete.mockResolvedValue({ content: 'Large portfolio summary.' });

      await service.generatePortfolioNarrative('pmo');

      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).toContain('Active projects (15)');
      // Only first 10 listed in the prompt details
      expect(prompt).toContain('Project 0');
      expect(prompt).toContain('Project 9');
      expect(prompt).not.toContain('Project 10');
    });

    it('filters to only active and planning projects', async () => {
      mockProjectFindAll.mockResolvedValue([
        makeProject({ status: 'active' }),
        makeProject({ status: 'planning' }),
        makeProject({ status: 'completed' }),
        makeProject({ status: 'on_hold' }),
        makeProject({ status: 'cancelled' }),
      ]);
      mockClaudeIsAvailable.mockReturnValue(false);

      const result = await service.generatePortfolioNarrative('executive');

      expect(result).toBe('You have 2 active project(s) in your portfolio.');
    });

    it('handles empty portfolio', async () => {
      mockProjectFindAll.mockResolvedValue([]);
      mockClaudeIsAvailable.mockReturnValue(false);

      const result = await service.generatePortfolioNarrative('executive');

      expect(result).toBe('You have 0 active project(s) in your portfolio.');
    });

    it('computes budget percentage correctly in prompt', async () => {
      mockProjectFindAll.mockResolvedValue([
        makeProject({ name: 'BigBudget', status: 'active', budgetAllocated: 200000, budgetSpent: 150000 }),
      ]);
      mockClaudeIsAvailable.mockReturnValue(true);
      mockClaudeComplete.mockResolvedValue({ content: 'OK' });

      await service.generatePortfolioNarrative('finance_officer');

      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).toContain('budget 75% spent');
    });

    it('handles zero budgetAllocated (0% spent)', async () => {
      mockProjectFindAll.mockResolvedValue([
        makeProject({ name: 'NoBudget', status: 'active', budgetAllocated: 0, budgetSpent: 0 }),
      ]);
      mockClaudeIsAvailable.mockReturnValue(true);
      mockClaudeComplete.mockResolvedValue({ content: 'OK' });

      await service.generatePortfolioNarrative('executive');

      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).toContain('budget 0% spent');
    });
  });

  // ── getRoleFocus (tested indirectly) ─────────────────────────────
  describe('role focus mapping', () => {
    beforeEach(() => {
      mockProjectFindById.mockResolvedValue(makeProject());
      mockClaudeIsAvailable.mockReturnValue(true);
      mockAssembleForProject.mockResolvedValue(makeInsights());
      mockScheduleFindByProjectId.mockResolvedValue([]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);
      mockComputeWorkload.mockResolvedValue([]);
      mockClaudeComplete.mockResolvedValue({ content: 'OK' });
    });

    const roleFocusCases: Array<[string, string]> = [
      ['finance_officer', 'budget utilization, cost variances, and financial risks'],
      ['scrum_master', 'sprint progress, velocity trends, and team blockers'],
      ['executive', 'high-level status, strategic risks, and portfolio health'],
      ['admin', 'system health, resource allocation, and cross-project dependencies'],
      ['project_manager', 'schedule adherence, task completion, resource capacity and bottlenecks, and immediate risks'],
      ['pmo', 'portfolio health, resource capacity and bottlenecks, cross-project dependencies, and governance'],
      ['team_member', 'upcoming deadlines, assigned work, and blockers'],
      ['ba', 'overall project health and key action items'],
      ['qa', 'overall project health and key action items'],
      ['viewer', 'overall project health and key action items'],
    ];

    it.each(roleFocusCases)('role "%s" produces focus: "%s"', async (role, expectedFocus) => {
      await service.generateProjectNarrative('proj-1', role as any);
      const prompt = mockClaudeComplete.mock.calls[0][0].userMessage;
      expect(prompt).toContain(expectedFocus);
    });
  });
});
