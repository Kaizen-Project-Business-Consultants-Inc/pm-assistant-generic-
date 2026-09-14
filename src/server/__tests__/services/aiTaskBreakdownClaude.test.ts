import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before import
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: vi.fn(),
    completeWithJsonSchema: vi.fn(),
  },
  promptTemplates: {
    taskBreakdown: {
      render: vi.fn().mockReturnValue('rendered-system-prompt'),
    },
  },
}));

vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: vi.fn().mockImplementation(() => ({
    buildProjectContext: vi.fn().mockResolvedValue({ some: 'context' }),
    toPromptString: vi.fn().mockReturnValue('context-string'),
  })),
}));

vi.mock('../../services/aiTaskBreakdown', () => ({
  FallbackTaskBreakdownService: vi.fn().mockImplementation(() => ({
    analyzeProject: vi.fn().mockResolvedValue({
      projectType: 'general',
      complexity: 'medium',
      estimatedDuration: 30,
      riskLevel: 5,
      suggestedPhases: [],
      taskSuggestions: [],
      criticalPath: [],
      resourceRequirements: {},
    }),
  })),
}));

vi.mock('../../services/aiUsageLogger', () => ({
  logAIUsage: vi.fn(),
}));

vi.mock('../../schemas/aiSchemas', () => ({
  AIProjectAnalysisSchema: { type: 'object' },
}));

import { ClaudeTaskBreakdownService } from '../../services/aiTaskBreakdownClaude';
import { claudeService, promptTemplates } from '../../services/claudeService';
import { AIContextBuilder } from '../../services/aiContextBuilder';
import { FallbackTaskBreakdownService } from '../../services/aiTaskBreakdown';
import { logAIUsage } from '../../services/aiUsageLogger';

const mockIsAvailable = claudeService.isAvailable as ReturnType<typeof vi.fn>;
const mockComplete = claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>;
const mockRender = promptTemplates.taskBreakdown.render as ReturnType<typeof vi.fn>;
const mockLogAIUsage = logAIUsage as ReturnType<typeof vi.fn>;

function createMockFastify() {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as any;
}

function makeClaudeResult(overrides: Record<string, any> = {}) {
  return {
    data: {
      projectType: 'software',
      complexity: 'high',
      estimatedDuration: 60,
      riskLevel: 7,
      suggestedPhases: [{ name: 'Phase 1', tasks: [] }],
      taskSuggestions: [
        {
          id: 't1',
          name: 'Setup',
          description: 'Initial setup',
          estimatedDays: 3,
          complexity: 'low',
          priority: 'high',
          dependencies: [],
          riskLevel: 2,
          category: 'setup',
          skills: ['devops'],
          deliverables: ['env configured'],
        },
      ],
      criticalPath: ['t1'],
      resourceRequirements: { developers: 3, testers: 1 },
      ...overrides,
    },
    usage: { inputTokens: 500, outputTokens: 300 },
    latencyMs: 1200,
  };
}

describe('ClaudeTaskBreakdownService', () => {
  let service: ClaudeTaskBreakdownService;
  let mockFastify: ReturnType<typeof createMockFastify>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFastify = createMockFastify();
    service = new ClaudeTaskBreakdownService(mockFastify);
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------
  it('creates FallbackTaskBreakdownService and AIContextBuilder on construction', () => {
    expect(FallbackTaskBreakdownService).toHaveBeenCalledWith(mockFastify);
    expect(AIContextBuilder).toHaveBeenCalledWith(mockFastify);
  });

  // -------------------------------------------------------------------------
  // Happy path — Claude available
  // -------------------------------------------------------------------------
  describe('when Claude is available', () => {
    beforeEach(() => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue(makeClaudeResult());
    });

    it('returns AI-powered analysis with aiPowered=true', async () => {
      const result = await service.analyzeProject('Build a web app');
      expect(result.aiPowered).toBe(true);
      expect(result.analysis.projectType).toBe('software');
      expect(result.analysis.complexity).toBe('high');
      expect(result.analysis.estimatedDuration).toBe(60);
      expect(result.analysis.riskLevel).toBe(7);
      expect(result.analysis.suggestedPhases).toHaveLength(1);
      expect(result.analysis.taskSuggestions).toHaveLength(1);
      expect(result.analysis.criticalPath).toEqual(['t1']);
      expect(result.analysis.resourceRequirements).toEqual({ developers: 3, testers: 1 });
    });

    it('renders prompt template with project description', async () => {
      await service.analyzeProject('Build a web app');
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({ projectDescription: 'Build a web app' }),
      );
    });

    it('calls completeWithJsonSchema with correct parameters', async () => {
      await service.analyzeProject('Build a web app');
      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'rendered-system-prompt',
          temperature: 0.3,
        }),
      );
    });

    it('logs successful AI usage', async () => {
      await service.analyzeProject('Build a web app', 'software', 'proj-1', 'user-1');
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          feature: 'task-breakdown',
          model: 'claude',
          success: true,
          usage: { inputTokens: 500, outputTokens: 300 },
          latencyMs: 1200,
          requestContext: { projectType: 'software', projectId: 'proj-1' },
        }),
      );
    });

    it('includes project type in additional context when provided', async () => {
      await service.analyzeProject('Build a web app', 'software');
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: expect.stringContaining('Project type hint: software'),
        }),
      );
    });

    it('builds project context when projectId is provided', async () => {
      await service.analyzeProject('Build a web app', undefined, 'proj-1');
      // The context builder should have been called and its output included
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: expect.stringContaining('context-string'),
        }),
      );
    });

    it('does not build project context when projectId is not provided', async () => {
      await service.analyzeProject('Build a web app');
      // additionalContext should be empty (no projectId, no projectType)
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: '',
        }),
      );
    });

    it('includes both context and project type when both are provided', async () => {
      await service.analyzeProject('Build a web app', 'software', 'proj-1');
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: expect.stringContaining('context-string'),
        }),
      );
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: expect.stringContaining('Project type hint: software'),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Claude unavailable — fallback
  // -------------------------------------------------------------------------
  describe('when Claude is unavailable', () => {
    beforeEach(() => {
      mockIsAvailable.mockReturnValue(false);
    });

    it('returns fallback analysis with aiPowered=false', async () => {
      const result = await service.analyzeProject('Build a web app', 'software');
      expect(result.aiPowered).toBe(false);
      expect(result.analysis.projectType).toBe('general');
      expect(result.analysis.complexity).toBe('medium');
    });

    it('logs info message about fallback', async () => {
      await service.analyzeProject('Build a web app');
      expect(mockFastify.log.info).toHaveBeenCalledWith(
        'Claude unavailable, using fallback task breakdown',
      );
    });

    it('does not call completeWithJsonSchema', async () => {
      await service.analyzeProject('Build a web app');
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('does not log AI usage', async () => {
      await service.analyzeProject('Build a web app');
      expect(mockLogAIUsage).not.toHaveBeenCalled();
    });

    it('passes projectDescription and projectType to fallback', async () => {
      const fallbackInstance = (FallbackTaskBreakdownService as any).mock.results[0].value;
      await service.analyzeProject('Build a bridge', 'construction');
      expect(fallbackInstance.analyzeProject).toHaveBeenCalledWith('Build a bridge', 'construction');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling — Claude throws
  // -------------------------------------------------------------------------
  describe('when Claude throws an error', () => {
    beforeEach(() => {
      mockIsAvailable.mockReturnValue(true);
    });

    it('falls back gracefully on Error instance', async () => {
      mockComplete.mockRejectedValue(new Error('API timeout'));
      const result = await service.analyzeProject('Build a web app', 'software', 'p1', 'u1');
      expect(result.aiPowered).toBe(false);
      expect(result.analysis.projectType).toBe('general');
    });

    it('logs warning with error details', async () => {
      const err = new Error('Rate limited');
      mockComplete.mockRejectedValue(err);
      await service.analyzeProject('Build a web app');
      expect(mockFastify.log.warn).toHaveBeenCalledWith(
        { err },
        'Claude task breakdown failed, falling back to template',
      );
    });

    it('logs failed AI usage with error message for Error instance', async () => {
      mockComplete.mockRejectedValue(new Error('Rate limited'));
      await service.analyzeProject('Build a web app', undefined, undefined, 'u1');
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: 'Rate limited',
          usage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
        }),
      );
    });

    it('handles non-Error thrown values (string)', async () => {
      mockComplete.mockRejectedValue('something went wrong');
      await service.analyzeProject('Build a web app');
      expect(mockFastify.log.warn).toHaveBeenCalledWith(
        { err: new Error('something went wrong') },
        'Claude task breakdown failed, falling back to template',
      );
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: 'something went wrong',
        }),
      );
    });

    it('handles non-Error thrown values (number)', async () => {
      mockComplete.mockRejectedValue(42);
      const result = await service.analyzeProject('Build a web app');
      expect(result.aiPowered).toBe(false);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: '42',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Context builder failure — best-effort
  // -------------------------------------------------------------------------
  describe('when context builder fails', () => {
    beforeEach(() => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue(makeClaudeResult());
    });

    it('proceeds without context when buildProjectContext throws', async () => {
      // Get the context builder instance and make it throw
      const ctxInstance = (AIContextBuilder as any).mock.results[0].value;
      ctxInstance.buildProjectContext.mockRejectedValue(new Error('DB error'));

      const result = await service.analyzeProject('Build a web app', 'software', 'proj-1');
      // Should still succeed with AI
      expect(result.aiPowered).toBe(true);
      expect(mockComplete).toHaveBeenCalled();
    });

    it('does not include context string when context building fails', async () => {
      const ctxInstance = (AIContextBuilder as any).mock.results[0].value;
      ctxInstance.buildProjectContext.mockRejectedValue(new Error('DB error'));

      await service.analyzeProject('Build a web app', 'software', 'proj-1');
      // additionalContext should only have the project type hint, not context-string
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: '\nProject type hint: software',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    beforeEach(() => {
      mockIsAvailable.mockReturnValue(true);
    });

    it('handles empty project description', async () => {
      mockComplete.mockResolvedValue(makeClaudeResult());
      const result = await service.analyzeProject('');
      expect(result.aiPowered).toBe(true);
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({ projectDescription: '' }),
      );
    });

    it('handles undefined optional parameters', async () => {
      mockComplete.mockResolvedValue(makeClaudeResult());
      const result = await service.analyzeProject('Build a web app');
      expect(result.aiPowered).toBe(true);
      // userId is undefined so logAIUsage should have userId as undefined
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: undefined,
          requestContext: { projectType: undefined, projectId: undefined },
        }),
      );
    });

    it('maps all fields from Claude response to ProjectAnalysis', async () => {
      const customResult = makeClaudeResult({
        projectType: 'construction',
        complexity: 'low',
        estimatedDuration: 120,
        riskLevel: 3,
        suggestedPhases: [{ name: 'Foundation' }, { name: 'Framing' }],
        taskSuggestions: [],
        criticalPath: ['a', 'b', 'c'],
        resourceRequirements: { managers: 2, designers: 1 },
      });
      mockComplete.mockResolvedValue(customResult);

      const result = await service.analyzeProject('Build a house');
      expect(result.analysis).toEqual({
        projectType: 'construction',
        complexity: 'low',
        estimatedDuration: 120,
        riskLevel: 3,
        suggestedPhases: [{ name: 'Foundation' }, { name: 'Framing' }],
        taskSuggestions: [],
        criticalPath: ['a', 'b', 'c'],
        resourceRequirements: { managers: 2, designers: 1 },
      });
    });
  });
});
