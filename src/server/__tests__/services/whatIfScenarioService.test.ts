import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockBuildProjectContext = vi.fn();
const mockToPromptString = vi.fn();
vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: vi.fn().mockImplementation(() => ({
    buildProjectContext: (...args: any[]) => mockBuildProjectContext(...args),
    toPromptString: (...args: any[]) => mockToPromptString(...args),
  })),
}));

const mockIsAvailable = vi.fn();
const mockCompleteWithJsonSchema = vi.fn();
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: (...args: any[]) => mockIsAvailable(...args),
    completeWithJsonSchema: (...args: any[]) => mockCompleteWithJsonSchema(...args),
  },
  PromptTemplate: vi.fn().mockImplementation(() => ({
    render: vi.fn().mockReturnValue('rendered prompt'),
  })),
}));

const mockLogAIUsage = vi.fn();
vi.mock('../../services/aiUsageLogger', () => ({
  logAIUsage: (...args: any[]) => mockLogAIUsage(...args),
}));

vi.mock('../../utils/promptSanitizer', () => ({
  sanitizeForPrompt: (s: string) => s,
}));

const mockComputeEVMMetrics = vi.fn();
const mockComputeDeterministicRiskScore = vi.fn();
vi.mock('../../services/predictiveIntelligence', () => ({
  computeEVMMetrics: (...args: any[]) => mockComputeEVMMetrics(...args),
  computeDeterministicRiskScore: (...args: any[]) => mockComputeDeterministicRiskScore(...args),
}));

const mockCalculateCriticalPath = vi.fn();
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: {
    calculateCriticalPath: (...args: any[]) => mockCalculateCriticalPath(...args),
  },
}));

const mockQuery = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: { query: (...args: any[]) => mockQuery(...args) },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

import { WhatIfScenarioService } from '../../services/whatIfScenarioService';
import type { ProjectContext } from '../../services/aiContextBuilder';

// ── Helpers ──────────────────────────────────────────────────────────

function makeFastify() {
  return {
    log: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
  } as any;
}

function makeProjectContext(overrides: Partial<{
  projectId: string;
  projectType: string;
  budgetAllocated: number;
  budgetSpent: number;
  startDate: string;
  endDate: string;
  tasks: Array<{
    id: string;
    name: string;
    status: string;
    priority: string;
    estimatedDays?: number;
    progressPercentage?: number;
    dueDate?: string;
  }>;
}> = {}): ProjectContext {
  const tasks = overrides.tasks ?? [
    { id: 't1', name: 'Task 1', status: 'in_progress', priority: 'high', estimatedDays: 5, progressPercentage: 50, dueDate: '2026-06-15' },
    { id: 't2', name: 'Task 2', status: 'not_started', priority: 'medium', estimatedDays: 10, progressPercentage: 0, dueDate: '2026-07-01' },
  ];

  return {
    project: {
      id: overrides.projectId ?? 'proj-1',
      name: 'Test Project',
      status: 'active',
      priority: 'high',
      projectType: overrides.projectType ?? 'software',
      budgetAllocated: overrides.budgetAllocated ?? 100000,
      budgetSpent: overrides.budgetSpent ?? 40000,
      startDate: overrides.startDate ?? '2026-01-01',
      endDate: overrides.endDate ?? '2026-12-31',
    },
    schedules: [
      {
        id: 'sch-1',
        name: 'Main Schedule',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        tasks,
      },
    ],
  };
}

function setupDefaultMocks(ctx?: ProjectContext) {
  const context = ctx ?? makeProjectContext();
  mockBuildProjectContext.mockResolvedValue(context);
  mockToPromptString.mockReturnValue('project prompt string');
  mockIsAvailable.mockReturnValue(false); // Default: no AI
  mockComputeEVMMetrics.mockReturnValue({
    CPI: 1.0, SPI: 1.0, EAC: 100000, ETC: 60000, VAC: 0, TCPI: 1.0,
  });
  mockComputeDeterministicRiskScore.mockReturnValue({
    score: 30, severity: 'medium', healthScore: 70,
  });
  // Worker count query: return 3 workers from task_assignments
  mockQuery.mockResolvedValue([{ cnt: 3 }]);
  // Critical path: no critical path by default
  mockCalculateCriticalPath.mockResolvedValue({
    criticalPathTaskIds: [],
    tasks: [],
    projectDuration: 0,
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('WhatIfScenarioService', () => {
  let service: WhatIfScenarioService;
  let fastify: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fastify = makeFastify();
    service = new WhatIfScenarioService(fastify);
  });

  // ── modelScenario ─────────────────────────────────────────────────
  describe('modelScenario', () => {
    it('returns a deterministic fallback result when AI is unavailable', async () => {
      setupDefaultMocks();

      const { result, aiPowered, id } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'What if we cut the budget by 20%?',
        parameters: { budgetChangePct: -20 },
      });

      expect(aiPowered).toBe(false);
      expect(id).toBe('test-uuid-1234');
      expect(result.confidence).toBe(0.35);
      expect(result.budgetImpact.originalBudget).toBe(100000);
      expect(result.budgetImpact.projectedBudget).toBe(80000);
      expect(result.budgetImpact.changePct).toBe(-20);
      expect(result.scheduleImpact.originalDays).toBeGreaterThan(0);
      expect(result.riskImpact.currentRiskScore).toBe(30);
      // Budget cut should increase risk
      expect(result.riskImpact.projectedRiskScore).toBeGreaterThan(30);
    });

    it('persists scenario to the database', async () => {
      setupDefaultMocks();

      await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Cut budget by 10%',
        parameters: { budgetChangePct: -10 },
      }, 'user-42');

      // The INSERT query should be called (after the worker-count queries)
      const insertCall = mockQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO scenario_analyses'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1][0]).toBe('test-uuid-1234'); // id
      expect(insertCall![1][1]).toBe('proj-1'); // project_id
      expect(insertCall![1][2]).toBe('user-42'); // user_id
      expect(insertCall![1][3]).toBe('Cut budget by 10%'); // scenario_text
    });

    it('uses AI when claudeService is available', async () => {
      setupDefaultMocks();
      mockIsAvailable.mockReturnValue(true);

      const aiResult = {
        scheduleImpact: { originalDays: 365, projectedDays: 350, changePct: -4.1, explanation: 'AI analysis' },
        budgetImpact: { originalBudget: 100000, projectedBudget: 90000, changePct: -10, explanation: 'AI budget' },
        resourceImpact: { currentWorkers: 3, projectedWorkers: 3, explanation: 'No change' },
        riskImpact: { currentRiskScore: 30, projectedRiskScore: 40, newRisks: ['Risk A'], explanation: 'AI risk' },
        affectedTasks: [{ taskName: 'Task 1', impact: 'delayed', severity: 'high' as const }],
        recommendations: ['Do X'],
        confidence: 0.75,
      };
      mockCompleteWithJsonSchema.mockResolvedValue({
        data: aiResult,
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 1200,
      });

      const { result, aiPowered } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'What if we cut budget by 10%?',
        parameters: { budgetChangePct: -10 },
      }, 'user-1');

      expect(aiPowered).toBe(true);
      expect(result).toBe(aiResult);
      expect(mockLogAIUsage).toHaveBeenCalledTimes(1);
      expect(mockLogAIUsage).toHaveBeenCalledWith(expect.objectContaining({
        feature: 'what_if_scenario',
        success: true,
      }));
    });

    it('falls back to deterministic when AI call fails', async () => {
      setupDefaultMocks();
      mockIsAvailable.mockReturnValue(true);
      mockCompleteWithJsonSchema.mockRejectedValue(new Error('AI timeout'));

      const { result, aiPowered } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Test scenario',
      });

      expect(aiPowered).toBe(false);
      expect(result.confidence).toBe(0.35);
      expect(fastify.log.warn).toHaveBeenCalled();
    });

    it('handles timeline extension (positive daysExtension)', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Extend by 30 days',
        parameters: { daysExtension: 30 },
      });

      expect(result.scheduleImpact.projectedDays).toBe(result.scheduleImpact.originalDays + 30);
      expect(result.scheduleImpact.changePct).toBeGreaterThan(0);
      // Timeline extension reduces risk
      expect(result.riskImpact.projectedRiskScore).toBeLessThan(30);
    });

    it('handles timeline compression (negative daysExtension)', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Compress by 20 days',
        parameters: { daysExtension: -20 },
      });

      expect(result.scheduleImpact.projectedDays).toBe(result.scheduleImpact.originalDays - 20);
      expect(result.scheduleImpact.changePct).toBeLessThan(0);
      // Timeline compression increases risk
      expect(result.riskImpact.projectedRiskScore).toBeGreaterThan(30);
    });

    it('handles worker reduction', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Remove 2 workers',
        parameters: { workerChange: -2 },
      });

      expect(result.resourceImpact.currentWorkers).toBe(3);
      expect(result.resourceImpact.projectedWorkers).toBe(1); // 3 - 2 = 1
    });

    it('ensures projected workers is at least 1', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Remove everyone',
        parameters: { workerChange: -10 },
      });

      expect(result.resourceImpact.projectedWorkers).toBe(1);
    });

    it('handles worker addition', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Add 5 workers',
        parameters: { workerChange: 5 },
      });

      expect(result.resourceImpact.projectedWorkers).toBe(8); // 3 + 5
    });

    it('handles scope increase with auto-timeline extension', async () => {
      const ctx = makeProjectContext({
        tasks: [
          { id: 't1', name: 'Task 1', status: 'completed', priority: 'high', estimatedDays: 5, progressPercentage: 100 },
          { id: 't2', name: 'Task 2', status: 'in_progress', priority: 'medium', estimatedDays: 10, progressPercentage: 50 },
        ],
      });
      setupDefaultMocks(ctx);

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Increase scope by 50%',
        parameters: { scopeChangePct: 50 },
      });

      // Scope increase should increase budget
      expect(result.budgetImpact.projectedBudget).toBeGreaterThan(100000);
      // Scope increase (>0) with no explicit daysExtension should auto-extend timeline
      expect(result.scheduleImpact.projectedDays).toBeGreaterThanOrEqual(result.scheduleImpact.originalDays);
      // Risk should increase
      expect(result.riskImpact.projectedRiskScore).toBeGreaterThan(30);
    });

    it('handles scope increase without auto-extending when daysExtension is set', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Scope +20%, same timeline',
        parameters: { scopeChangePct: 20, daysExtension: 0 },
      });

      // daysExtension is explicitly 0, so timeline should not auto-extend from scope
      expect(result.scheduleImpact.projectedDays).toBe(result.scheduleImpact.originalDays);
    });

    it('handles budget increase reducing risk', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Add 30% budget',
        parameters: { budgetChangePct: 30 },
      });

      expect(result.budgetImpact.projectedBudget).toBe(130000);
      expect(result.budgetImpact.changePct).toBe(30);
      // Budget increase reduces risk
      expect(result.riskImpact.projectedRiskScore).toBeLessThan(30);
    });

    it('handles no parameters gracefully', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Just a text scenario with no numbers',
      });

      expect(result.scheduleImpact.changePct).toBe(0);
      expect(result.budgetImpact.changePct).toBe(0);
      expect(result.resourceImpact.currentWorkers).toBe(result.resourceImpact.projectedWorkers);
      // With no parameters, params becomes {} (truthy), so buildRecommendations
      // gets an empty object — none of the specific conditions match, so the
      // generic "manageable" recommendation is returned.
      expect(result.recommendations).toContain('The proposed changes appear manageable. Monitor key metrics closely during implementation.');
    });

    it('handles empty parameters object', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Empty params',
        parameters: {},
      });

      expect(result.scheduleImpact.changePct).toBe(0);
      expect(result.budgetImpact.changePct).toBe(0);
    });

    it('uses project-type coefficients for construction', async () => {
      const ctx = makeProjectContext({ projectType: 'construction' });
      setupDefaultMocks(ctx);

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Cut budget 10%',
        parameters: { budgetChangePct: -10 },
      });

      // Construction has budgetCutRiskPerPct=0.7 vs software=0.4
      // So risk increase should be 10 * 0.7 = 7
      expect(result.riskImpact.projectedRiskScore).toBe(37); // 30 + 7
    });

    it('uses default coefficients for unknown project type', async () => {
      const ctx = makeProjectContext({ projectType: 'unknown_type' });
      setupDefaultMocks(ctx);

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Cut budget 10%',
        parameters: { budgetChangePct: -10 },
      });

      // Default budgetCutRiskPerPct=0.5, so 10 * 0.5 = 5
      expect(result.riskImpact.projectedRiskScore).toBe(35); // 30 + 5
    });

    it('clamps risk score to 100 maximum', async () => {
      setupDefaultMocks();
      mockComputeDeterministicRiskScore.mockReturnValue({
        score: 90, severity: 'critical', healthScore: 10,
      });

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Massive budget cut',
        parameters: { budgetChangePct: -50 },
      });

      expect(result.riskImpact.projectedRiskScore).toBeLessThanOrEqual(100);
    });

    it('clamps risk score to 0 minimum', async () => {
      setupDefaultMocks();
      mockComputeDeterministicRiskScore.mockReturnValue({
        score: 5, severity: 'low', healthScore: 95,
      });

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Big budget increase + timeline extension',
        parameters: { budgetChangePct: 100, daysExtension: 100 },
      });

      expect(result.riskImpact.projectedRiskScore).toBeGreaterThanOrEqual(0);
    });

    it('handles zero budget allocated', async () => {
      const ctx = makeProjectContext({ budgetAllocated: 0, budgetSpent: 0 });
      setupDefaultMocks(ctx);

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Cut budget 20%',
        parameters: { budgetChangePct: -20 },
      });

      expect(result.budgetImpact.originalBudget).toBe(0);
      expect(result.budgetImpact.changePct).toBe(0);
    });

    it('falls back to assigned_to count when task_assignments returns 0', async () => {
      setupDefaultMocks();
      // First query (task_assignments): 0 workers
      // Second query (assigned_to fallback): 2 workers
      // Third+ queries: INSERT
      mockQuery
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ cnt: 2 }])
        .mockResolvedValue(undefined);

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Test worker count fallback',
      });

      expect(result.resourceImpact.currentWorkers).toBe(2);
    });

    it('falls back to 1 worker when all queries fail', async () => {
      setupDefaultMocks();
      // Override the mockQuery to throw on the first call (worker count)
      mockQuery
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValue(undefined); // allow INSERT to work

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'DB error for workers',
      });

      expect(result.resourceImpact.currentWorkers).toBe(1);
    });

    it('logs warning when DB persist fails but still returns result', async () => {
      setupDefaultMocks();
      // Worker count succeeds, INSERT fails
      mockQuery
        .mockResolvedValueOnce([{ cnt: 3 }]) // worker count
        .mockRejectedValueOnce(new Error('INSERT failed')); // persist

      const { result, id } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Persist fail test',
      });

      expect(result).toBeDefined();
      expect(id).toBe('test-uuid-1234');
      expect(fastify.log.warn).toHaveBeenCalled();
    });

    it('includes affected tasks from critical path analysis', async () => {
      const ctx = makeProjectContext({
        tasks: [
          { id: 't1', name: 'Critical Task', status: 'in_progress', priority: 'high', estimatedDays: 10, progressPercentage: 20 },
          { id: 't2', name: 'Non-critical', status: 'not_started', priority: 'low', estimatedDays: 3, progressPercentage: 0 },
        ],
      });
      setupDefaultMocks(ctx);
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: [
          { taskId: 't1', name: 'Critical Task', duration: 10, ES: 0, EF: 10, LS: 0, LF: 10, totalFloat: 0, freeFloat: 0, isCritical: true },
          { taskId: 't2', name: 'Non-critical', duration: 3, ES: 0, EF: 3, LS: 7, LF: 10, totalFloat: 7, freeFloat: 7, isCritical: false },
        ],
        projectDuration: 10,
      });

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Compress timeline',
        parameters: { daysExtension: -10 },
      });

      expect(result.affectedTasks.length).toBeGreaterThan(0);
      // Critical task should appear first (higher score)
      const criticalTask = result.affectedTasks.find(t => t.taskName === 'Critical Task');
      expect(criticalTask).toBeDefined();
      expect(criticalTask!.severity).toBe('high');
    });

    it('returns empty affected tasks when all tasks are completed', async () => {
      const ctx = makeProjectContext({
        tasks: [
          { id: 't1', name: 'Done 1', status: 'completed', priority: 'high' },
          { id: 't2', name: 'Done 2', status: 'completed', priority: 'medium' },
        ],
      });
      setupDefaultMocks(ctx);

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'All done',
        parameters: { budgetChangePct: -10 },
      });

      expect(result.affectedTasks).toEqual([]);
    });

    it('limits affected tasks to 8', async () => {
      const tasks = Array.from({ length: 15 }, (_, i) => ({
        id: `t${i}`,
        name: `Task ${i}`,
        status: 'not_started',
        priority: 'medium',
        estimatedDays: 5,
        progressPercentage: 0,
        dueDate: '2026-06-15',
      }));
      const ctx = makeProjectContext({ tasks });
      setupDefaultMocks(ctx);

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Many tasks',
        parameters: { budgetChangePct: -20 },
      });

      expect(result.affectedTasks.length).toBeLessThanOrEqual(8);
    });

    it('handles combined parameters (budget + timeline + workers)', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Combined changes',
        parameters: { budgetChangePct: -15, daysExtension: 10, workerChange: 2 },
      });

      expect(result.budgetImpact.projectedBudget).toBe(85000);
      expect(result.scheduleImpact.projectedDays).toBe(result.scheduleImpact.originalDays + 10);
      expect(result.resourceImpact.projectedWorkers).toBe(5); // 3 + 2
    });
  });

  // ── inferNewRisks (tested indirectly through modelScenario) ─────
  describe('risk inference', () => {
    it('infers budget reduction risk for cuts > 10%', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Big budget cut',
        parameters: { budgetChangePct: -15 },
      });

      expect(result.riskImpact.newRisks).toContain('Budget reduction may force scope cuts or quality compromises.');
    });

    it('does not infer budget risk for small cuts', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Small budget cut',
        parameters: { budgetChangePct: -5 },
      });

      expect(result.riskImpact.newRisks).not.toContain('Budget reduction may force scope cuts or quality compromises.');
    });

    it('infers worker reduction risk', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Lose a worker',
        parameters: { workerChange: -1 },
      });

      expect(result.riskImpact.newRisks).toContain('Reduced workforce increases schedule pressure on remaining team.');
    });

    it('infers timeline compression risk', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Compress',
        parameters: { daysExtension: -10 },
      });

      expect(result.riskImpact.newRisks).toContain('Compressed timeline increases risk of quality issues and burnout.');
    });

    it('infers severe compression risk when coefficient threshold exceeded', async () => {
      setupDefaultMocks();
      // Software: timelineCompressRiskPerDay=0.5, need abs(days)*0.5 > 15 => days > 30
      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Extreme compression',
        parameters: { daysExtension: -35 },
      });

      expect(result.riskImpact.newRisks).toContain('Severe compression — consider fast-tracking or crashing only non-critical-path tasks.');
    });

    it('infers scope increase risk for > 10%', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Scope creep',
        parameters: { scopeChangePct: 15 },
      });

      expect(result.riskImpact.newRisks).toContain('Scope increase without proportional budget/time increase creates delivery risk.');
    });

    it('infers formal change control risk for scope > 25%', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Major scope change',
        parameters: { scopeChangePct: 30 },
      });

      expect(result.riskImpact.newRisks).toContain('Scope increase >25% typically requires formal change control and re-baselining.');
    });
  });

  // ── buildRecommendations (tested indirectly) ─────────────────────
  describe('recommendations', () => {
    it('recommends phased delivery for significant budget reduction', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Big cut',
        parameters: { budgetChangePct: -20 },
      });

      expect(result.recommendations).toContain('Significant budget reduction. Prioritize critical path tasks and consider phased delivery.');
    });

    it('recommends parallelization for timeline compression', async () => {
      setupDefaultMocks();
      // Need scheduleChangePct < -10, so compress enough relative to total days
      // totalDays is around 365, so -40 days gives ~-11%
      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Compress hard',
        parameters: { daysExtension: -40 },
      });

      expect(result.recommendations).toContain('Timeline compression detected. Identify parallelizable tasks and consider adding resources.');
    });

    it('adds construction-specific recommendation for physical projects under compression', async () => {
      const ctx = makeProjectContext({ projectType: 'construction' });
      setupDefaultMocks(ctx);

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Compress construction',
        parameters: { daysExtension: -40 },
      });

      expect(result.recommendations).toContain('For physical projects, consider overtime or additional shifts rather than fast-tracking dependent activities.');
    });

    it('recommends quality improvement for extended timeline', async () => {
      setupDefaultMocks();
      // Need scheduleChangePct > 20, so extend by >20% of totalDays
      // totalDays ~365, so 80 days gives ~22%
      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Big extension',
        parameters: { daysExtension: 80 },
      });

      expect(result.recommendations).toContain('Extended timeline provides buffer. Use this to improve quality and address backlog.');
    });

    it('recommends workload redistribution for reduced team', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Lose 2 workers',
        parameters: { workerChange: -2 },
      });

      expect(result.recommendations).toContain('With reduced team, consider redistributing workload and updating the resource assignment matrix.');
    });

    it('recommends change request for significant scope increase', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Scope up 20%',
        parameters: { scopeChangePct: 20 },
      });

      expect(result.recommendations).toContain('Scope increase warrants a formal change request. Update the project baseline and communicate to stakeholders.');
    });

    it('gives generic recommendation when changes are minor', async () => {
      setupDefaultMocks();

      const { result } = await service.modelScenario({
        projectId: 'proj-1',
        scenario: 'Small tweak',
        parameters: { budgetChangePct: 2 },
      });

      expect(result.recommendations).toContain('The proposed changes appear manageable. Monitor key metrics closely during implementation.');
    });
  });

  // ── getHistory ──────────────────────────────────────────────────
  describe('getHistory', () => {
    it('returns parsed scenario history', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'sc-1',
          project_id: 'proj-1',
          user_id: 42,
          scenario_text: 'Test scenario',
          parameters: JSON.stringify({ budgetChangePct: -10 }),
          result: JSON.stringify({ confidence: 0.5 }),
          ai_powered: 1,
          confidence: 0.5,
          created_at: new Date('2026-06-01T00:00:00Z'),
        },
      ]);

      const history = await service.getHistory('proj-1');

      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('sc-1');
      expect(history[0].projectId).toBe('proj-1');
      expect(history[0].userId).toBe(42);
      expect(history[0].scenarioText).toBe('Test scenario');
      expect(history[0].parameters).toEqual({ budgetChangePct: -10 });
      expect(history[0].result).toEqual({ confidence: 0.5 });
      expect(history[0].aiPowered).toBe(true);
      expect(history[0].confidence).toBe(0.5);
      expect(history[0].createdAt).toBe('2026-06-01T00:00:00.000Z');
    });

    it('handles already-parsed JSON fields (object instead of string)', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'sc-2',
          project_id: 'proj-1',
          user_id: 1,
          scenario_text: 'Test',
          parameters: { budgetChangePct: -5 }, // already parsed
          result: { confidence: 0.7 }, // already parsed
          ai_powered: 0,
          confidence: 0.7,
          created_at: '2026-06-01',
        },
      ]);

      const history = await service.getHistory('proj-1');

      expect(history[0].parameters).toEqual({ budgetChangePct: -5 });
      expect(history[0].result).toEqual({ confidence: 0.7 });
      expect(history[0].aiPowered).toBe(false);
    });

    it('returns empty array when no history exists', async () => {
      mockQuery.mockResolvedValue([]);

      const history = await service.getHistory('proj-1');

      expect(history).toEqual([]);
    });

    it('uses default limit of 10', async () => {
      mockQuery.mockResolvedValue([]);

      await service.getHistory('proj-1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        ['proj-1', 10],
      );
    });

    it('accepts custom limit', async () => {
      mockQuery.mockResolvedValue([]);

      await service.getHistory('proj-1', 5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        ['proj-1', 5],
      );
    });

    it('handles string created_at (non-Date)', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'sc-3',
          project_id: 'proj-1',
          user_id: 1,
          scenario_text: 'Test',
          parameters: '{}',
          result: '{}',
          ai_powered: 0,
          confidence: 0.3,
          created_at: '2026-06-15 12:00:00',
        },
      ]);

      const history = await service.getHistory('proj-1');

      expect(history[0].createdAt).toBe('2026-06-15 12:00:00');
    });
  });

  // ── deleteScenario ──────────────────────────────────────────────
  describe('deleteScenario', () => {
    it('returns true when a scenario is deleted', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 1 });

      const result = await service.deleteScenario('sc-1');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM scenario_analyses WHERE id = ?',
        ['sc-1'],
      );
    });

    it('returns false when no scenario found', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });

      const result = await service.deleteScenario('nonexistent');

      expect(result).toBe(false);
    });

    it('returns false when affectedRows is undefined', async () => {
      mockQuery.mockResolvedValue({});

      const result = await service.deleteScenario('sc-1');

      expect(result).toBe(false);
    });
  });
});
