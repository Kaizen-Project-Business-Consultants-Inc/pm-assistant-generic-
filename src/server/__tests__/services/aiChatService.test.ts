import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockIsAvailable,
  mockComplete,
  mockStream,
  mockCompleteToolLoop,
  mockRender,
  mockBuildProjectContext,
  mockBuildPortfolioContext,
  mockToPromptString,
  mockPortfolioToPromptString,
  mockExecute,
  mockLogAIUsage,
  mockFindByUserId,
  mockFindByIdForUser,
  mockGetMessages,
  mockGetAllMessages,
  mockAddMessage,
  mockUpdateTokenCount,
  mockCreateConversation,
  mockSoftDelete,
  mockFindByProjectId,
  mockRecall,
  mockStore,
  mockGetInsightsByProject,
} = vi.hoisted(() => ({
  mockIsAvailable: vi.fn(),
  mockComplete: vi.fn(),
  mockStream: vi.fn(),
  mockCompleteToolLoop: vi.fn(),
  mockRender: vi.fn(),
  mockBuildProjectContext: vi.fn(),
  mockBuildPortfolioContext: vi.fn(),
  mockToPromptString: vi.fn(),
  mockPortfolioToPromptString: vi.fn(),
  mockExecute: vi.fn(),
  mockLogAIUsage: vi.fn(),
  mockFindByUserId: vi.fn(),
  mockFindByIdForUser: vi.fn(),
  mockGetMessages: vi.fn(),
  mockGetAllMessages: vi.fn(),
  mockAddMessage: vi.fn(),
  mockUpdateTokenCount: vi.fn(),
  mockCreateConversation: vi.fn(),
  mockSoftDelete: vi.fn(),
  mockFindByProjectId: vi.fn(),
  mockRecall: vi.fn(),
  mockStore: vi.fn(),
  mockGetInsightsByProject: vi.fn(),
}));

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: mockIsAvailable,
    complete: mockComplete,
    stream: mockStream,
    completeToolLoop: mockCompleteToolLoop,
  },
  promptTemplates: {
    conversational: { render: mockRender },
  },
}));

vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: class {
    buildProjectContext = mockBuildProjectContext;
    buildPortfolioContext = mockBuildPortfolioContext;
    toPromptString = mockToPromptString;
    portfolioToPromptString = mockPortfolioToPromptString;
  },
}));

vi.mock('../../services/aiUsageLogger', () => ({
  logAIUsage: mockLogAIUsage,
}));

vi.mock('../../services/aiToolDefinitions', () => ({
  AI_TOOLS: [{ name: 'create_task', description: 'test', input_schema: { type: 'object', properties: {} } }],
  MUTATING_TOOLS: ['create_task'],
}));

vi.mock('../../services/aiActionExecutor', () => ({
  AIActionExecutor: class {
    execute = mockExecute;
  },
}));

vi.mock('../../database/ChatRepository', () => ({
  chatRepository: {
    findByUserId: mockFindByUserId,
    findByIdForUser: mockFindByIdForUser,
    getMessages: mockGetMessages,
    getAllMessages: mockGetAllMessages,
    addMessage: mockAddMessage,
    updateTokenCount: mockUpdateTokenCount,
    createConversation: mockCreateConversation,
    softDelete: mockSoftDelete,
    findByProjectId: mockFindByProjectId,
  },
}));

vi.mock('../../services/AgentMemoryService', () => ({
  agentMemoryService: {
    recall: mockRecall,
    store: mockStore,
  },
}));

vi.mock('../../services/agents/InterAgentQueryService', () => ({
  InterAgentQueryService: class {
    getInsightsByProject = mockGetInsightsByProject;
  },
}));

vi.mock('../../services/context/ContextConfigService', () => ({
  contextConfigService: {
    resolveContext: vi.fn().mockResolvedValue({}),
    formatForPrompt: vi.fn().mockReturnValue(''),
  },
}));

vi.mock('../../services/AIBudgetService', () => ({
  AIBudgetExceededError: class AIBudgetExceededError extends Error {
    public statusCode = 429;
    public code = 'AI_BUDGET_EXCEEDED';
    public resetDate: string;
    constructor(public used: number, public budget: number) {
      super(`AI token budget exceeded`);
      this.name = 'AIBudgetExceededError';
      this.resetDate = '2026-11-01';
    }
  },
}));

// ── Import SUT after mocks ─────────────────────────────────────────────

import { AIChatService, type ChatRequest } from '../../services/aiChatService';
import { AIBudgetExceededError } from '../../services/AIBudgetService';

// ── Helpers ────────────────────────────────────────────────────────────

function makeFastify() {
  return { log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } } as any;
}

function makeRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    message: 'Hello AI',
    userId: 'user-1',
    userRole: 'admin',
    ...overrides,
  };
}

function setupDefaults() {
  mockIsAvailable.mockReturnValue(true);
  mockRender.mockReturnValue('system prompt');
  mockRecall.mockResolvedValue([]);
  mockStore.mockResolvedValue(undefined);
  mockGetInsightsByProject.mockResolvedValue([]);
  mockFindByProjectId.mockResolvedValue([]);
  mockBuildProjectContext.mockResolvedValue({ project: {} });
  mockBuildPortfolioContext.mockResolvedValue({ projects: [] });
  mockToPromptString.mockReturnValue('project context');
  mockPortfolioToPromptString.mockReturnValue('portfolio context');
  mockGetMessages.mockResolvedValue([]);
  mockFindByIdForUser.mockResolvedValue(null);
  mockCreateConversation.mockResolvedValue({ id: 'conv-new', userId: 'user-1', title: 'Hello AI', contextType: 'general', tokenCount: 0, isActive: true, projectId: null, createdAt: '', updatedAt: '' });
  mockAddMessage.mockResolvedValue(undefined);
  mockUpdateTokenCount.mockResolvedValue(undefined);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('AIChatService', () => {
  let service: AIChatService;
  let fastify: ReturnType<typeof makeFastify>;

  beforeEach(() => {
    vi.clearAllMocks();
    fastify = makeFastify();
    service = new AIChatService(fastify);
    setupDefaults();
  });

  // =====================================================================
  // sendMessage
  // =====================================================================

  describe('sendMessage', () => {
    it('returns AI-disabled message when claudeService is unavailable', async () => {
      mockIsAvailable.mockReturnValue(false);

      const result = await service.sendMessage(makeRequest());

      expect(result.aiPowered).toBe(false);
      expect(result.reply).toContain('AI features are currently disabled');
      expect(result.conversationId).toBeTruthy();
    });

    it('preserves conversationId when AI is unavailable and conversationId is provided', async () => {
      mockIsAvailable.mockReturnValue(false);

      const result = await service.sendMessage(makeRequest({ conversationId: 'existing-conv' }));

      expect(result.conversationId).toBe('existing-conv');
    });

    // ─── Tools enabled (default) ────────────────────────────────────

    it('calls completeToolLoop when tools are enabled (default)', async () => {
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'AI reply with tools',
        toolResults: [],
        totalUsage: { inputTokens: 100, outputTokens: 50 },
        totalLatencyMs: 500,
      });

      const result = await service.sendMessage(makeRequest());

      expect(mockCompleteToolLoop).toHaveBeenCalledTimes(1);
      expect(result.reply).toBe('AI reply with tools');
      expect(result.aiPowered).toBe(true);
      expect(result.actions).toBeUndefined(); // no actions taken
    });

    it('returns actions when tools are executed', async () => {
      const actionResult = { success: true, toolName: 'create_task', summary: 'Created task', data: {} };
      mockCompleteToolLoop.mockImplementation(async (opts: any) => {
        // Simulate the tool being called
        await opts.executeToolFn('create_task', { name: 'Test task' });
        return {
          finalText: 'Task created',
          toolResults: [{ toolName: 'create_task', result: '{}' }],
          totalUsage: { inputTokens: 200, outputTokens: 100 },
          totalLatencyMs: 800,
        };
      });
      mockExecute.mockResolvedValue(actionResult);

      const result = await service.sendMessage(makeRequest());

      expect(result.actions).toHaveLength(1);
      expect(result.actions![0].toolName).toBe('create_task');
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'chat-tools', success: true }),
      );
    });

    it('persists new conversation when no conversationId provided', async () => {
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'Hello!',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 20 },
        totalLatencyMs: 100,
      });

      await service.sendMessage(makeRequest());

      expect(mockCreateConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          contextType: 'general',
          title: 'Hello AI',
        }),
      );
      expect(mockAddMessage).toHaveBeenCalledTimes(2); // user + assistant
    });

    it('appends to existing conversation when conversationId + ownership verified', async () => {
      mockFindByIdForUser.mockResolvedValue({ id: 'conv-existing', userId: 'user-1' });
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'Follow-up reply',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      const result = await service.sendMessage(makeRequest({ conversationId: 'conv-existing' }));

      expect(mockCreateConversation).not.toHaveBeenCalled();
      expect(mockAddMessage).toHaveBeenCalledTimes(2);
      expect(result.conversationId).toBe('conv-existing');
    });

    it('creates new conversation when conversationId ownership check fails', async () => {
      mockFindByIdForUser.mockResolvedValue(null); // ownership fails
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'reply',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(makeRequest({ conversationId: 'not-mine' }));

      expect(mockCreateConversation).toHaveBeenCalled();
    });

    // ─── Tools disabled ─────────────────────────────────────────────

    it('calls complete (no tools) when enableTools is false', async () => {
      mockComplete.mockResolvedValue({
        content: 'Plain reply',
        usage: { inputTokens: 50, outputTokens: 25 },
        latencyMs: 200,
        model: 'claude',
      });

      const result = await service.sendMessage(makeRequest({ enableTools: false }));

      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(mockCompleteToolLoop).not.toHaveBeenCalled();
      expect(result.reply).toBe('Plain reply');
      expect(result.aiPowered).toBe(true);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'chat', success: true }),
      );
    });

    // ─── Error handling ─────────────────────────────────────────────

    it('handles AIBudgetExceededError with specific message', async () => {
      const budgetErr = new AIBudgetExceededError(600000, 500000);
      mockCompleteToolLoop.mockRejectedValue(budgetErr);

      const result = await service.sendMessage(makeRequest());

      expect(result.aiPowered).toBe(false);
      expect(result.reply).toContain('monthly AI token limit');
      expect(result.reply).toContain('2026-11-01');
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
      );
    });

    it('handles generic errors with fallback message', async () => {
      mockCompleteToolLoop.mockRejectedValue(new Error('Network error'));

      const result = await service.sendMessage(makeRequest());

      expect(result.aiPowered).toBe(false);
      expect(result.reply).toContain('encountered an error');
      expect(fastify.log.error).toHaveBeenCalled();
    });

    it('handles non-Error thrown values', async () => {
      mockCompleteToolLoop.mockRejectedValue('string error');

      const result = await service.sendMessage(makeRequest());

      expect(result.aiPowered).toBe(false);
      expect(result.reply).toContain('encountered an error');
    });

    it('survives persist failure and returns a fallback conversationId', async () => {
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'reply',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });
      mockCreateConversation.mockRejectedValue(new Error('DB down'));

      const result = await service.sendMessage(makeRequest());

      expect(result.reply).toBe('reply');
      expect(result.aiPowered).toBe(true);
      expect(result.conversationId).toBeTruthy();
      expect(fastify.log.error).toHaveBeenCalled();
    });

    // ─── Context building ───────────────────────────────────────────

    it('builds project context when projectId is provided', async () => {
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'project-aware reply',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(
        makeRequest({ context: { type: 'project', projectId: 'proj-1' } }),
      );

      expect(mockBuildProjectContext).toHaveBeenCalledWith('proj-1');
      expect(mockToPromptString).toHaveBeenCalled();
    });

    it('builds portfolio context when no projectId', async () => {
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'portfolio reply',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(makeRequest({ context: { type: 'dashboard' } }));

      expect(mockBuildPortfolioContext).toHaveBeenCalledWith({ userId: 'user-1', role: 'admin' });
      expect(mockPortfolioToPromptString).toHaveBeenCalled();
    });

    it('falls back gracefully when project context build fails', async () => {
      mockBuildProjectContext.mockRejectedValue(new Error('context fail'));
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'still works',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      const result = await service.sendMessage(
        makeRequest({ context: { type: 'project', projectId: 'proj-1' } }),
      );

      // Should not throw — fallback behavior
      expect(result.reply).toBe('still works');
    });

    it('loads conversation history when conversationId is provided', async () => {
      mockGetMessages.mockResolvedValue([
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'first reply' },
      ]);
      mockFindByIdForUser.mockResolvedValue({ id: 'conv-1', userId: 'user-1' });
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'follow-up',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(makeRequest({ conversationId: 'conv-1' }));

      expect(mockGetMessages).toHaveBeenCalledWith('conv-1', 20);
    });

    it('truncates title to 100 chars + ellipsis for long messages', async () => {
      const longMessage = 'A'.repeat(150);
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'ok',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(makeRequest({ message: longMessage }));

      expect(mockCreateConversation).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'A'.repeat(100) + '...' }),
      );
    });

    it('does not add ellipsis for short messages', async () => {
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'ok',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(makeRequest({ message: 'Short' }));

      expect(mockCreateConversation).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Short' }),
      );
    });
  });

  // =====================================================================
  // streamMessage
  // =====================================================================

  describe('streamMessage', () => {
    it('yields AI-disabled message when claudeService is unavailable', async () => {
      mockIsAvailable.mockReturnValue(false);

      const chunks: any[] = [];
      for await (const chunk of service.streamMessage(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe('text_delta');
      expect(chunks[0].content).toContain('AI features are currently disabled');
      expect(chunks[1].type).toBe('done');
    });

    it('streams text deltas and persists on usage chunk', async () => {
      async function* fakeStream() {
        yield { type: 'text_delta' as const, content: 'Hello' };
        yield { type: 'text_delta' as const, content: ' world' };
        yield { type: 'usage' as const, usage: { inputTokens: 50, outputTokens: 30 } };
        yield { type: 'done' as const };
      }
      mockStream.mockReturnValue(fakeStream());
      mockFindByIdForUser.mockResolvedValue(null);
      mockCreateConversation.mockResolvedValue({ id: 'conv-stream', userId: 'user-1' });

      const chunks: any[] = [];
      for await (const chunk of service.streamMessage(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks.filter(c => c.type === 'text_delta')).toHaveLength(2);
      const doneChunk = chunks.find(c => c.type === 'done');
      expect(doneChunk.conversationId).toBe('conv-stream');
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'chat-stream', success: true }),
      );
    });

    it('handles stream errors gracefully', async () => {
      async function* failingStream(): AsyncGenerator<any> {
        yield { type: 'text_delta' as const, content: 'Partial' };
        throw new Error('Stream broken');
      }
      mockStream.mockReturnValue(failingStream());

      const chunks: any[] = [];
      for await (const chunk of service.streamMessage(makeRequest())) {
        chunks.push(chunk);
      }

      // Should get partial text, error message, and done
      expect(chunks.some(c => c.content?.includes('error occurred'))).toBe(true);
      expect(chunks[chunks.length - 1].type).toBe('done');
      expect(fastify.log.error).toHaveBeenCalled();
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'chat-stream', success: false }),
      );
    });
  });

  // =====================================================================
  // getConversations
  // =====================================================================

  describe('getConversations', () => {
    it('returns conversations for a user', async () => {
      const convs = [{ id: 'c1', userId: 'user-1', title: 'Chat 1' }];
      mockFindByUserId.mockResolvedValue(convs);

      const result = await service.getConversations('user-1');

      expect(result).toEqual(convs);
      expect(mockFindByUserId).toHaveBeenCalledWith('user-1');
    });
  });

  // =====================================================================
  // getConversation
  // =====================================================================

  describe('getConversation', () => {
    it('returns conversation with messages when found', async () => {
      mockFindByIdForUser.mockResolvedValue({ id: 'c1', userId: 'user-1', title: 'Test' });
      mockGetAllMessages.mockResolvedValue([
        { id: 'm1', role: 'user', content: 'Hi' },
        { id: 'm2', role: 'assistant', content: 'Hello' },
      ]);

      const result = await service.getConversation('c1', 'user-1');

      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(mockFindByIdForUser).toHaveBeenCalledWith('c1', 'user-1');
      expect(mockGetAllMessages).toHaveBeenCalledWith('c1');
    });

    it('returns null when conversation not found or not owned', async () => {
      mockFindByIdForUser.mockResolvedValue(null);

      const result = await service.getConversation('c1', 'user-1');

      expect(result).toBeNull();
      expect(mockGetAllMessages).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // deleteConversation
  // =====================================================================

  describe('deleteConversation', () => {
    it('delegates to chatRepository.softDelete', async () => {
      mockSoftDelete.mockResolvedValue(true);

      const result = await service.deleteConversation('c1', 'user-1');

      expect(result).toBe(true);
      expect(mockSoftDelete).toHaveBeenCalledWith('c1', 'user-1');
    });

    it('returns false when conversation not found', async () => {
      mockSoftDelete.mockResolvedValue(false);

      const result = await service.deleteConversation('c1', 'user-1');

      expect(result).toBe(false);
    });
  });

  // =====================================================================
  // Agent memory / self-learning context
  // =====================================================================

  describe('agent memory integration', () => {
    it('stores action memory when tools execute with projectId', async () => {
      const actionResult = { success: true, toolName: 'create_task', summary: 'Created', data: {} };
      mockCompleteToolLoop.mockImplementation(async (opts: any) => {
        await opts.executeToolFn('create_task', {});
        return {
          finalText: 'Done',
          toolResults: [{ toolName: 'create_task', result: '{}' }],
          totalUsage: { inputTokens: 10, outputTokens: 10 },
          totalLatencyMs: 50,
        };
      });
      mockExecute.mockResolvedValue(actionResult);
      mockFindByIdForUser.mockResolvedValue({ id: 'conv-1', userId: 'user-1' });

      await service.sendMessage(
        makeRequest({ conversationId: 'conv-1', context: { type: 'project', projectId: 'proj-1' } }),
      );

      expect(mockStore).toHaveBeenCalledWith(
        'mjuzi-chat',
        'project',
        'proj-1',
        expect.stringContaining('action-'),
        expect.objectContaining({ actions: expect.stringContaining('create_task') }),
      );
    });

    it('does not store action memory when no projectId', async () => {
      const actionResult = { success: true, toolName: 'create_task', summary: 'Created', data: {} };
      mockCompleteToolLoop.mockImplementation(async (opts: any) => {
        await opts.executeToolFn('create_task', {});
        return {
          finalText: 'Done',
          toolResults: [{ toolName: 'create_task', result: '{}' }],
          totalUsage: { inputTokens: 10, outputTokens: 10 },
          totalLatencyMs: 50,
        };
      });
      mockExecute.mockResolvedValue(actionResult);

      await service.sendMessage(makeRequest());

      expect(mockStore).not.toHaveBeenCalled();
    });

    it('includes agent insights in context when available', async () => {
      mockGetInsightsByProject.mockResolvedValue([
        { agentId: 'risk-scanner', value: { risk: 'high' } },
      ]);
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'reply',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(
        makeRequest({ context: { type: 'project', projectId: 'proj-1' } }),
      );

      // The render call should include insight text via projectContext
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          projectContext: expect.stringContaining('risk-scanner'),
        }),
      );
    });

    it('includes self-learning preferences and corrections in context', async () => {
      mockRecall.mockResolvedValue([
        { keyName: 'pref:format', value: { value: 'bullet points', reason: 'user asked' } },
        { keyName: 'correction:budget', value: { wrong: '10k', correct: '15k' } },
      ]);
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'reply',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(
        makeRequest({ context: { type: 'project', projectId: 'proj-1' } }),
      );

      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          projectContext: expect.stringContaining('bullet points'),
        }),
      );
    });
  });

  // =====================================================================
  // Edge cases
  // =====================================================================

  describe('edge cases', () => {
    it('defaults userRole to team_member when empty', async () => {
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'ok',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(makeRequest({ userRole: '' }));

      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({ userRole: 'team_member' }),
      );
    });

    it('defaults context type to general when not specified', async () => {
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'ok',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      await service.sendMessage(makeRequest());

      expect(mockCreateConversation).toHaveBeenCalledWith(
        expect.objectContaining({ contextType: 'general' }),
      );
    });

    it('handles portfolio context build failure gracefully', async () => {
      mockBuildPortfolioContext.mockRejectedValue(new Error('portfolio fail'));
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'fallback ok',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      const result = await service.sendMessage(makeRequest({ context: { type: 'dashboard' } }));

      expect(result.reply).toBe('fallback ok');
    });

    it('handles conversation history load failure silently', async () => {
      mockGetMessages.mockRejectedValue(new Error('DB error'));
      mockCompleteToolLoop.mockResolvedValue({
        finalText: 'reply without history',
        toolResults: [],
        totalUsage: { inputTokens: 10, outputTokens: 10 },
        totalLatencyMs: 50,
      });

      const result = await service.sendMessage(makeRequest({ conversationId: 'conv-1' }));

      expect(result.reply).toBe('reply without history');
    });

    it('logs usage on both tool and plain completion errors', async () => {
      mockComplete.mockRejectedValue(new Error('API down'));

      await service.sendMessage(makeRequest({ enableTools: false }));

      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, errorMessage: 'API down' }),
      );
    });
  });
});
