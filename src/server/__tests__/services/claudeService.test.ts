import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('../../config', () => ({
  config: {
    AI_ENABLED: true,
    ANTHROPIC_API_KEY: 'test-api-key',
    AI_MODEL: 'claude-sonnet-4-5-20250929',
    AI_FALLBACK_MODEL: 'claude-haiku-4-5-20251001',
    AI_FALLBACK_ENABLED: false,
    AI_MAX_TOKENS: 4096,
    AI_TEMPERATURE: 0.3,
    AI_PRICING_INPUT: 3.0,
    AI_PRICING_OUTPUT: 15.0,
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../utils/promptSanitizer', () => ({
  sanitizeForPrompt: vi.fn((input: string) => input),
}));

vi.mock('../../middleware/requestContext', () => ({
  getRequestContext: vi.fn(() => null),
}));

vi.mock('../../services/AIBudgetService', () => ({
  aiBudgetService: { checkBudget: vi.fn().mockResolvedValue(undefined) },
  AIBudgetExceededError: class AIBudgetExceededError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'AIBudgetExceededError';
    }
  },
}));

// Mock the Anthropic SDK
// Use vi.hoisted() so mock fns are available in the hoisted vi.mock factory
const { mockCreate, mockStream } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockStream: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }
  class APIConnectionTimeoutError extends Error {
    constructor(message = 'timeout') {
      super(message);
      this.name = 'APIConnectionTimeoutError';
    }
  }
  class APIConnectionError extends Error {
    constructor(message = 'connection error') {
      super(message);
      this.name = 'APIConnectionError';
    }
  }

  class Anthropic {
    messages = { create: mockCreate, stream: mockStream };
    static APIError = APIError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    static APIConnectionError = APIConnectionError;
  }

  return { default: Anthropic };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ClaudeService, PromptTemplate, promptTemplates, AICircuitBreakerError } from '../../services/claudeService';
import type { CompletionOptions } from '../../services/claudeService';
import { config } from '../../config';
import { getRequestContext } from '../../middleware/requestContext';
import { aiBudgetService } from '../../services/AIBudgetService';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const mockCheckBudget = aiBudgetService.checkBudget as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(overrides?: Partial<typeof config>): ClaudeService {
  if (overrides) Object.assign(config, overrides);
  return new ClaudeService();
}

function defaultOptions(overrides?: Partial<CompletionOptions>): CompletionOptions {
  return {
    systemPrompt: 'You are a helpful assistant.',
    userMessage: 'Hello',
    ...overrides,
  };
}

function mockApiResponse(overrides?: Partial<{
  content: any[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stop_reason: string;
}>) {
  return {
    content: [{ type: 'text', text: 'Response text' }],
    usage: { input_tokens: 100, output_tokens: 50 },
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to defaults
    Object.assign(config, {
      AI_ENABLED: true,
      ANTHROPIC_API_KEY: 'test-api-key',
      AI_MODEL: 'claude-sonnet-4-5-20250929',
      AI_FALLBACK_MODEL: 'claude-haiku-4-5-20251001',
      AI_FALLBACK_ENABLED: false,
      AI_MAX_TOKENS: 4096,
      AI_TEMPERATURE: 0.3,
      AI_PRICING_INPUT: 3.0,
      AI_PRICING_OUTPUT: 15.0,
    });
  });

  // =========================================================================
  // Constructor & isAvailable
  // =========================================================================

  describe('constructor & isAvailable', () => {
    it('creates client when AI is enabled and API key is set', () => {
      const service = makeService();
      expect(service.isAvailable()).toBe(true);
    });

    it('disables AI when AI_ENABLED is false', () => {
      const service = makeService({ AI_ENABLED: false } as any);
      expect(service.isAvailable()).toBe(false);
    });

    it('disables AI when ANTHROPIC_API_KEY is empty', () => {
      const service = makeService({ ANTHROPIC_API_KEY: '' } as any);
      expect(service.isAvailable()).toBe(false);
    });
  });

  // =========================================================================
  // getUsageStats
  // =========================================================================

  describe('getUsageStats', () => {
    it('returns zeroed stats on fresh instance', () => {
      const service = makeService();
      const stats = service.getUsageStats();
      expect(stats).toEqual({
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedCost: 0,
      });
    });

    it('returns a copy (not a reference) of stats', () => {
      const service = makeService();
      const stats1 = service.getUsageStats();
      const stats2 = service.getUsageStats();
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  // =========================================================================
  // getCircuitBreakerStatus
  // =========================================================================

  describe('getCircuitBreakerStatus', () => {
    it('returns closed state with 0 failures initially', () => {
      const service = makeService();
      expect(service.getCircuitBreakerStatus()).toEqual({ state: 'closed', failures: 0 });
    });
  });

  // =========================================================================
  // complete()
  // =========================================================================

  describe('complete', () => {
    it('throws when AI is unavailable', async () => {
      const service = makeService({ AI_ENABLED: false } as any);
      await expect(service.complete(defaultOptions())).rejects.toThrow(
        'AI service is unavailable',
      );
    });

    it('returns content, usage, latency, and model on success', async () => {
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();

      const result = await service.complete(defaultOptions());

      expect(result.content).toBe('Response text');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(result.model).toBe('claude-sonnet-4-5-20250929');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('passes system prompt with defense and persona preambles', async () => {
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();
      await service.complete(defaultOptions());

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toContain('IMPORTANT: Content within <user-data> tags');
      expect(call.system).toContain('Kovarti PM platform');
      expect(call.system).toContain('You are a helpful assistant.');
    });

    it('appends JSON instruction when responseFormat is json', async () => {
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();
      await service.complete(defaultOptions({ responseFormat: 'json' }));

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toContain('respond with ONLY valid JSON');
    });

    it('uses custom maxTokens and temperature when provided', async () => {
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();
      await service.complete(defaultOptions({ maxTokens: 2048, temperature: 0.7 }));

      const call = mockCreate.mock.calls[0][0];
      expect(call.max_tokens).toBe(2048);
      expect(call.temperature).toBe(0.7);
    });

    it('uses default maxTokens and temperature from config when not provided', async () => {
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();
      await service.complete(defaultOptions());

      const call = mockCreate.mock.calls[0][0];
      expect(call.max_tokens).toBe(4096);
      expect(call.temperature).toBe(0.3);
    });

    it('includes conversation history in messages', async () => {
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();
      await service.complete(defaultOptions({
        conversationHistory: [
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
      }));

      const call = mockCreate.mock.calls[0][0];
      expect(call.messages).toHaveLength(3);
      expect(call.messages[0]).toEqual({ role: 'user', content: 'Earlier question' });
      expect(call.messages[1]).toEqual({ role: 'assistant', content: 'Earlier answer' });
      expect(call.messages[2]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('records usage stats after successful call', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({ usage: { input_tokens: 200, output_tokens: 100 } }));
      const service = makeService();
      await service.complete(defaultOptions());

      const stats = service.getUsageStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalInputTokens).toBe(200);
      expect(stats.totalOutputTokens).toBe(100);
      expect(stats.estimatedCost).toBeGreaterThan(0);
    });

    it('checks budget when userId is provided', async () => {
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();
      await service.complete(defaultOptions({ userId: 'user-123' }));

      expect(mockCheckBudget).toHaveBeenCalledWith('user-123');
    });

    it('checks budget from request context when no explicit userId', async () => {
      (getRequestContext as any).mockReturnValue({ userId: 'ctx-user' });
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();
      await service.complete(defaultOptions());

      expect(mockCheckBudget).toHaveBeenCalledWith('ctx-user');
    });

    it('skips budget check when no userId and no request context', async () => {
      (getRequestContext as any).mockReturnValue(null);
      mockCreate.mockResolvedValue(mockApiResponse());
      const service = makeService();
      await service.complete(defaultOptions());

      expect(mockCheckBudget).not.toHaveBeenCalled();
    });

    it('throws when response has no text content blocks', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({
        content: [{ type: 'tool_use', id: 't1', name: 'fn', input: {} }],
        stop_reason: 'tool_use',
      }));
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow(
        'no text content blocks',
      );
    });

    it('concatenates multiple text blocks', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({
        content: [
          { type: 'text', text: 'Part 1 ' },
          { type: 'text', text: 'Part 2' },
        ],
      }));
      const service = makeService();
      const result = await service.complete(defaultOptions());
      expect(result.content).toBe('Part 1 Part 2');
    });

    // --- Error wrapping ---

    it('wraps 401 APIError with authentication message', async () => {
      mockCreate.mockRejectedValue(new Anthropic.APIError(401, 'unauthorized'));
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow(
        'Authentication failed',
      );
    });

    it('wraps 429 APIError with rate limit message', async () => {
      mockCreate.mockRejectedValue(new Anthropic.APIError(429, 'rate limited'));
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow('Rate limit exceeded');
    });

    it('wraps 503 APIError with overloaded message', async () => {
      mockCreate.mockRejectedValue(new Anthropic.APIError(503, 'overloaded'));
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow('temporarily overloaded');
    });

    it('wraps 529 APIError with overloaded message', async () => {
      mockCreate.mockRejectedValue(new Anthropic.APIError(529, 'overloaded'));
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow('temporarily overloaded');
    });

    it('wraps 400 APIError with bad request message', async () => {
      mockCreate.mockRejectedValue(new Anthropic.APIError(400, 'bad request'));
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow('Bad request');
    });

    it('wraps timeout error', async () => {
      mockCreate.mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow('timed out');
    });

    it('wraps connection error', async () => {
      mockCreate.mockRejectedValue(new Anthropic.APIConnectionError('network failure'));
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow(
        'Failed to connect',
      );
    });

    it('wraps generic Error', async () => {
      mockCreate.mockRejectedValue(new Error('something broke'));
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow('Unexpected error');
    });

    it('wraps non-Error values', async () => {
      mockCreate.mockRejectedValue('string error');
      const service = makeService();
      await expect(service.complete(defaultOptions())).rejects.toThrow('Unknown error');
    });

    // --- Fallback model ---

    it('retries with fallback model on transient error when fallback enabled', async () => {
      Object.assign(config, { AI_FALLBACK_ENABLED: true });
      const service = makeService();

      mockCreate
        .mockRejectedValueOnce(new Anthropic.APIError(429, 'rate limited'))
        .mockResolvedValueOnce(mockApiResponse({ model: 'claude-haiku-4-5-20251001' }));

      const result = await service.complete(defaultOptions());
      expect(result.model).toBe('claude-haiku-4-5-20251001');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('does not retry with fallback when fallback is disabled', async () => {
      Object.assign(config, { AI_FALLBACK_ENABLED: false });
      const service = makeService();

      mockCreate.mockRejectedValue(new Anthropic.APIError(429, 'rate limited'));

      await expect(service.complete(defaultOptions())).rejects.toThrow('Rate limit exceeded');
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('does not retry with fallback on non-transient errors', async () => {
      Object.assign(config, { AI_FALLBACK_ENABLED: true });
      const service = makeService();

      mockCreate.mockRejectedValue(new Anthropic.APIError(401, 'unauthorized'));

      await expect(service.complete(defaultOptions())).rejects.toThrow('Authentication failed');
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('records circuit breaker failure when fallback also fails with transient error', async () => {
      Object.assign(config, { AI_FALLBACK_ENABLED: true });
      const service = makeService();

      mockCreate
        .mockRejectedValueOnce(new Anthropic.APIError(429, 'rate limited'))
        .mockRejectedValueOnce(new Anthropic.APIError(503, 'overloaded'));

      await expect(service.complete(defaultOptions())).rejects.toThrow('temporarily overloaded');
      // Circuit breaker should have recorded a failure
      const status = service.getCircuitBreakerStatus();
      expect(status.failures).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Circuit Breaker
  // =========================================================================

  describe('circuit breaker', () => {
    it('opens after 5 transient failures', async () => {
      const service = makeService();

      for (let i = 0; i < 5; i++) {
        mockCreate.mockRejectedValueOnce(new Anthropic.APIError(429, 'rate limited'));
        await expect(service.complete(defaultOptions())).rejects.toThrow();
      }

      const status = service.getCircuitBreakerStatus();
      expect(status.state).toBe('open');
      expect(status.failures).toBe(5);
    });

    it('throws AICircuitBreakerError when circuit is open', async () => {
      const service = makeService();

      // Trip the breaker
      for (let i = 0; i < 5; i++) {
        mockCreate.mockRejectedValueOnce(new Anthropic.APIError(429, 'rate limited'));
        await expect(service.complete(defaultOptions())).rejects.toThrow();
      }

      // Next call should throw circuit breaker error (not even reaching the API)
      await expect(service.complete(defaultOptions())).rejects.toThrow(
        'AI service temporarily unavailable',
      );
    });

    it('resets to closed after a successful request', async () => {
      const service = makeService();

      // Record 3 failures (not enough to open)
      for (let i = 0; i < 3; i++) {
        mockCreate.mockRejectedValueOnce(new Anthropic.APIError(429, 'rate limited'));
        await expect(service.complete(defaultOptions())).rejects.toThrow();
      }
      expect(service.getCircuitBreakerStatus().failures).toBe(3);

      // Successful call resets
      mockCreate.mockResolvedValueOnce(mockApiResponse());
      await service.complete(defaultOptions());
      expect(service.getCircuitBreakerStatus()).toEqual({ state: 'closed', failures: 0 });
    });

    it('does not count non-transient errors toward circuit breaker', async () => {
      const service = makeService();

      for (let i = 0; i < 10; i++) {
        mockCreate.mockRejectedValueOnce(new Anthropic.APIError(401, 'unauthorized'));
        await expect(service.complete(defaultOptions())).rejects.toThrow();
      }

      // Should still be closed since 401 is not transient
      expect(service.getCircuitBreakerStatus()).toEqual({ state: 'closed', failures: 0 });
    });
  });

  // =========================================================================
  // completeWithTools
  // =========================================================================

  describe('completeWithTools', () => {
    const toolOptions = {
      ...defaultOptions(),
      tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object' as const, properties: {} } }],
    };

    it('throws when AI is unavailable', async () => {
      const service = makeService({ AI_ENABLED: false } as any);
      await expect(service.completeWithTools(toolOptions)).rejects.toThrow('AI service is unavailable');
    });

    it('returns content blocks, usage, model, and stopReason', async () => {
      const response = mockApiResponse({
        content: [{ type: 'text', text: 'The weather is sunny' }],
        stop_reason: 'end_turn',
      });
      mockCreate.mockResolvedValue(response);
      const service = makeService();

      const result = await service.completeWithTools(toolOptions);

      expect(result.content).toEqual([{ type: 'text', text: 'The weather is sunny' }]);
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(result.stopReason).toBe('end_turn');
    });

    it('defaults stopReason to end_turn when null', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({ stop_reason: null as any }));
      const service = makeService();
      const result = await service.completeWithTools(toolOptions);
      expect(result.stopReason).toBe('end_turn');
    });

    it('records circuit breaker failure on transient error', async () => {
      mockCreate.mockRejectedValue(new Anthropic.APIError(503, 'overloaded'));
      const service = makeService();
      await expect(service.completeWithTools(toolOptions)).rejects.toThrow();
      expect(service.getCircuitBreakerStatus().failures).toBe(1);
    });
  });

  // =========================================================================
  // completeWithJsonSchema
  // =========================================================================

  describe('completeWithJsonSchema', () => {
    const schema = z.object({ name: z.string(), count: z.number() });

    it('parses valid JSON on first attempt', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({
        content: [{ type: 'text', text: '{"name":"test","count":42}' }],
      }));
      const service = makeService();

      const result = await service.completeWithJsonSchema({
        ...defaultOptions(),
        schema,
      });

      expect(result.data).toEqual({ name: 'test', count: 42 });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('strips markdown code fences from JSON response', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({
        content: [{ type: 'text', text: '```json\n{"name":"test","count":1}\n```' }],
      }));
      const service = makeService();

      const result = await service.completeWithJsonSchema({
        ...defaultOptions(),
        schema,
      });

      expect(result.data).toEqual({ name: 'test', count: 1 });
    });

    it('retries with correction when first attempt fails validation', async () => {
      mockCreate
        .mockResolvedValueOnce(mockApiResponse({
          content: [{ type: 'text', text: '{"name":"test"}' }], // missing count
          usage: { input_tokens: 50, output_tokens: 30 },
        }))
        .mockResolvedValueOnce(mockApiResponse({
          content: [{ type: 'text', text: '{"name":"test","count":5}' }],
          usage: { input_tokens: 80, output_tokens: 40 },
        }));

      const service = makeService();
      const result = await service.completeWithJsonSchema({ ...defaultOptions(), schema });

      expect(result.data).toEqual({ name: 'test', count: 5 });
      expect(result.usage).toEqual({ inputTokens: 130, outputTokens: 70 }); // combined
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('throws when both attempts fail validation', async () => {
      mockCreate
        .mockResolvedValueOnce(mockApiResponse({
          content: [{ type: 'text', text: '{"name":"test"}' }],
        }))
        .mockResolvedValueOnce(mockApiResponse({
          content: [{ type: 'text', text: '{"name":"still wrong"}' }],
        }));

      const service = makeService();
      await expect(
        service.completeWithJsonSchema({ ...defaultOptions(), schema }),
      ).rejects.toThrow('Failed to get valid JSON after retry');
    });

    it('throws when JSON is completely unparseable on both attempts', async () => {
      mockCreate
        .mockResolvedValueOnce(mockApiResponse({
          content: [{ type: 'text', text: 'not json at all' }],
        }))
        .mockResolvedValueOnce(mockApiResponse({
          content: [{ type: 'text', text: 'still not json' }],
        }));

      const service = makeService();
      await expect(
        service.completeWithJsonSchema({ ...defaultOptions(), schema }),
      ).rejects.toThrow('Failed to get valid JSON after retry');
    });

    it('repairs trailing commas in JSON', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({
        content: [{ type: 'text', text: '{"name":"test","count":42,}' }],
      }));
      const service = makeService();

      const result = await service.completeWithJsonSchema({ ...defaultOptions(), schema });
      expect(result.data).toEqual({ name: 'test', count: 42 });
    });
  });

  // =========================================================================
  // completeToolLoop
  // =========================================================================

  describe('completeToolLoop', () => {
    const toolDef: Anthropic.Tool = {
      name: 'lookup',
      description: 'Look up data',
      input_schema: { type: 'object' as const, properties: {} },
    };

    it('returns final text when first response has no tool use', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({ stop_reason: 'end_turn' }));
      const service = makeService();

      const result = await service.completeToolLoop({
        ...defaultOptions(),
        tools: [toolDef],
        executeToolFn: vi.fn(),
      });

      expect(result.finalText).toBe('Response text');
      expect(result.toolResults).toHaveLength(0);
      expect(result.totalUsage.inputTokens).toBe(100);
    });

    it('executes tools and loops until no more tool_use', async () => {
      const executeToolFn = vi.fn().mockResolvedValue('tool result');

      // First call: tool_use
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { query: 'test' } },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
        stop_reason: 'tool_use',
        model: 'claude-sonnet-4-5-20250929',
      });
      // Second call: final text
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Final answer' }],
        usage: { input_tokens: 80, output_tokens: 30 },
        stop_reason: 'end_turn',
        model: 'claude-sonnet-4-5-20250929',
      });

      const service = makeService();
      const result = await service.completeToolLoop({
        ...defaultOptions(),
        tools: [toolDef],
        executeToolFn,
      });

      expect(result.finalText).toBe('Final answer');
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0]).toEqual({ toolName: 'lookup', result: 'tool result' });
      expect(executeToolFn).toHaveBeenCalledWith('lookup', { query: 'test' });
      expect(result.totalUsage.inputTokens).toBe(180);
      expect(result.totalUsage.outputTokens).toBe(80);
    });

    it('handles tool execution errors gracefully', async () => {
      const executeToolFn = vi.fn().mockRejectedValue(new Error('Tool failed'));

      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'lookup', input: {} },
        ],
        usage: { input_tokens: 50, output_tokens: 25 },
        stop_reason: 'tool_use',
        model: 'claude-sonnet-4-5-20250929',
      });
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Recovered' }],
        usage: { input_tokens: 60, output_tokens: 20 },
        stop_reason: 'end_turn',
        model: 'claude-sonnet-4-5-20250929',
      });

      const service = makeService();
      const result = await service.completeToolLoop({
        ...defaultOptions(),
        tools: [toolDef],
        executeToolFn,
      });

      expect(result.finalText).toBe('Recovered');
      expect(result.toolResults[0].result).toBe('Error: Tool failed');
    });

    it('stops after maxIterations and gets final response', async () => {
      const executeToolFn = vi.fn().mockResolvedValue('result');

      // Every iteration returns tool_use
      for (let i = 0; i < 3; i++) {
        mockCreate.mockResolvedValueOnce({
          content: [
            { type: 'tool_use', id: `tu_${i}`, name: 'lookup', input: {} },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'tool_use',
          model: 'claude-sonnet-4-5-20250929',
        });
      }
      // Final response after max iterations
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done after max' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
        model: 'claude-sonnet-4-5-20250929',
      });

      const service = makeService();
      const result = await service.completeToolLoop({
        ...defaultOptions(),
        tools: [toolDef],
        executeToolFn,
        maxIterations: 3,
      });

      expect(result.finalText).toBe('Done after max');
      expect(result.toolResults).toHaveLength(3);
    });

    it('checks budget when userId is provided', async () => {
      mockCreate.mockResolvedValue(mockApiResponse({ stop_reason: 'end_turn' }));
      const service = makeService();

      await service.completeToolLoop({
        ...defaultOptions({ userId: 'u1' }),
        tools: [toolDef],
        executeToolFn: vi.fn(),
      });

      expect(mockCheckBudget).toHaveBeenCalledWith('u1');
    });
  });

  // =========================================================================
  // stream()
  // =========================================================================

  describe('stream', () => {
    it('throws when AI is unavailable', async () => {
      const service = makeService({ AI_ENABLED: false } as any);
      const gen = service.stream(defaultOptions());
      await expect(gen.next()).rejects.toThrow('AI service is unavailable');
    });

    it('yields text deltas and final usage', async () => {
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 0 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
        { type: 'message_delta', usage: { output_tokens: 20 } },
      ];

      mockStream.mockReturnValue({
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: () =>
              i < events.length
                ? Promise.resolve({ value: events[i++], done: false })
                : Promise.resolve({ value: undefined, done: true }),
          };
        },
      });

      const service = makeService();
      const chunks: any[] = [];
      for await (const chunk of service.stream(defaultOptions())) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'text_delta', content: 'Hello ' },
        { type: 'text_delta', content: 'world' },
        { type: 'usage', usage: { inputTokens: 50, outputTokens: 20 } },
        { type: 'done' },
      ]);
    });

    it('records circuit breaker failure on transient stream error', async () => {
      mockStream.mockImplementation(() => {
        throw new Anthropic.APIError(503, 'overloaded');
      });

      const service = makeService();
      const gen = service.stream(defaultOptions());
      await expect(gen.next()).rejects.toThrow();
      expect(service.getCircuitBreakerStatus().failures).toBe(1);
    });
  });

  // =========================================================================
  // PromptTemplate
  // =========================================================================

  describe('PromptTemplate', () => {
    it('renders variables wrapped in user-data XML tags', () => {
      const template = new PromptTemplate('Analyze: {{description}}', '1.0.0');
      const result = template.render({ description: 'Build a house' });

      expect(result).toContain('<user-data field="description">');
      expect(result).toContain('Build a house');
      expect(result).toContain('</user-data>');
      expect(result).not.toContain('{{description}}');
    });

    it('renders multiple variables', () => {
      const template = new PromptTemplate('{{a}} and {{b}}', '2.0.0');
      const result = template.render({ a: 'first', b: 'second' });

      expect(result).toContain('first');
      expect(result).toContain('second');
      expect(result).not.toContain('{{a}}');
      expect(result).not.toContain('{{b}}');
    });

    it('returns template version', () => {
      const template = new PromptTemplate('test', '3.0.0');
      expect(template.getVersion()).toBe('3.0.0');
    });
  });

  // =========================================================================
  // promptTemplates
  // =========================================================================

  describe('promptTemplates', () => {
    it('contains all expected template keys', () => {
      expect(Object.keys(promptTemplates)).toEqual(
        expect.arrayContaining([
          'taskBreakdown',
          'riskAssessment',
          'projectInsights',
          'reportGeneration',
          'statusReport',
          'meetingNotesExtraction',
          'standupSummary',
          'conversational',
        ]),
      );
    });

    it('all templates are PromptTemplate instances', () => {
      for (const tmpl of Object.values(promptTemplates)) {
        expect(tmpl).toBeInstanceOf(PromptTemplate);
        expect(typeof tmpl.getVersion()).toBe('string');
      }
    });
  });

  // =========================================================================
  // AICircuitBreakerError
  // =========================================================================

  describe('AICircuitBreakerError', () => {
    it('has correct name and retryAfterMs', () => {
      const err = new AICircuitBreakerError(30000);
      expect(err.name).toBe('AICircuitBreakerError');
      expect(err.retryAfterMs).toBe(30000);
      expect(err.message).toContain('temporarily unavailable');
    });
  });
});
