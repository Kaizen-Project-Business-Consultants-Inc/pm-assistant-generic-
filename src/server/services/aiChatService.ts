import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { claudeService, promptTemplates, type StreamChunk, type CompletionResult } from './claudeService';
import { AIContextBuilder } from './aiContextBuilder';
import { logAIUsage } from './aiUsageLogger';
import { AI_TOOLS, MUTATING_TOOLS } from './aiToolDefinitions';
import { AIActionExecutor, type ActionResult } from './aiActionExecutor';
import { chatRepository, type ChatConversation, type ChatMessage } from '../database/ChatRepository';
import { agentMemoryService } from './AgentMemoryService';
import { InterAgentQueryService } from './agents/InterAgentQueryService';
import { AIBudgetExceededError } from './AIBudgetService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatRequest {
  message: string;
  conversationId?: string;
  context?: {
    type: 'dashboard' | 'project' | 'schedule' | 'reports' | 'general';
    projectId?: string;
  };
  userId: string;
  userRole: string;
  enableTools?: boolean;
}

// ---------------------------------------------------------------------------
// AIChatService
// ---------------------------------------------------------------------------

export class AIChatService {
  private fastify: FastifyInstance;
  private contextBuilder: AIContextBuilder;
  private actionExecutor: AIActionExecutor;
  private interAgentQueryService = new InterAgentQueryService();

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.contextBuilder = new AIContextBuilder(fastify);
    this.actionExecutor = new AIActionExecutor();
  }

  // -----------------------------------------------------------------------
  // Non-streaming chat WITH tool execution
  // -----------------------------------------------------------------------

  async sendMessage(req: ChatRequest): Promise<{
    reply: string;
    conversationId: string;
    aiPowered: boolean;
    actions?: ActionResult[];
  }> {
    if (!claudeService.isAvailable()) {
      return {
        reply:
          'AI features are currently disabled. Please check that the ANTHROPIC_API_KEY is configured and AI_ENABLED is set to true.',
        conversationId: req.conversationId || randomUUID(),
        aiPowered: false,
      };
    }

    const { systemPrompt, history } = await this.prepareConversation(req);
    const enableTools = req.enableTools !== false; // tools enabled by default

    try {
      if (enableTools) {
        // Use the tool loop — Claude can call tools and we execute them
        const actionContext = { userId: req.userId, userRole: req.userRole };
        const allActions: ActionResult[] = [];

        const result = await claudeService.completeToolLoop({
          systemPrompt,
          userMessage: req.message,
          conversationHistory: history,
          temperature: 0.5,
          tools: AI_TOOLS,
          executeToolFn: async (toolName: string, toolInput: Record<string, any>) => {
            const actionResult = await this.actionExecutor.execute(toolName, toolInput, actionContext);
            allActions.push(actionResult);
            // Return the result as a string for Claude to interpret
            return JSON.stringify(actionResult);
          },
        });

        const tokenCount = result.totalUsage.inputTokens + result.totalUsage.outputTokens;
        let conversationId: string;
        try {
          conversationId = await this.persistConversation(
            req,
            result.finalText,
            tokenCount,
            allActions.length > 0 ? allActions : undefined,
          );
        } catch (persistErr) {
          this.fastify.log.error({ err: persistErr }, 'Failed to persist conversation');
          conversationId = req.conversationId || randomUUID();
        }

        logAIUsage({
          userId: req.userId,
          feature: 'chat-tools',
          model: 'claude',
          usage: result.totalUsage,
          latencyMs: result.totalLatencyMs,
          success: true,
          requestContext: {
            conversationId,
            contextType: req.context?.type,
            toolsUsed: result.toolResults.map(t => t.toolName),
          },
        });

        return {
          reply: result.finalText,
          conversationId,
          aiPowered: true,
          actions: allActions.length > 0 ? allActions : undefined,
        };
      } else {
        // Plain completion without tools
        const result: CompletionResult = await claudeService.complete({
          systemPrompt,
          userMessage: req.message,
          conversationHistory: history,
          temperature: 0.5,
        });

        let conversationId: string;
        try {
          conversationId = await this.persistConversation(req, result.content, result.usage.inputTokens + result.usage.outputTokens);
        } catch (persistErr) {
          this.fastify.log.error({ err: persistErr }, 'Failed to persist conversation');
          conversationId = req.conversationId || randomUUID();
        }

        logAIUsage({
          userId: req.userId,
          feature: 'chat',
          model: 'claude',
          usage: result.usage,
          latencyMs: result.latencyMs,
          success: true,
          requestContext: { conversationId, contextType: req.context?.type },
        });

        return { reply: result.content, conversationId, aiPowered: true };
      }
    } catch (error) {
      this.fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Chat completion failed');

      logAIUsage({
        userId: req.userId,
        feature: 'chat-tools',
        model: 'claude',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      let reply: string;
      if (error instanceof AIBudgetExceededError) {
        reply = `You've reached your monthly AI token limit (${error.used.toLocaleString()} / ${error.budget.toLocaleString()} tokens used). Your budget resets on **${error.resetDate}**.\n\nYou can [purchase additional tokens](/pricing) to continue using AI features, or wait for your budget to reset. All non-AI features remain fully available.`;
      } else {
        reply = 'I encountered an error processing your request. Please try again in a moment.';
      }

      return {
        reply,
        conversationId: req.conversationId || randomUUID(),
        aiPowered: false,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Streaming chat (tools not supported in streaming mode)
  // -----------------------------------------------------------------------

  async *streamMessage(req: ChatRequest): AsyncGenerator<
    StreamChunk & { conversationId?: string; actions?: ActionResult[] }
  > {
    if (!claudeService.isAvailable()) {
      yield {
        type: 'text_delta' as const,
        content:
          'AI features are currently disabled. Please check that the ANTHROPIC_API_KEY is configured and AI_ENABLED is set to true.',
      };
      yield { type: 'done' as const, conversationId: req.conversationId || randomUUID() };
      return;
    }

    const { systemPrompt, history } = await this.prepareConversation(req);

    let fullReply = '';
    let conversationId = req.conversationId || randomUUID();

    try {
      const stream = claudeService.stream({
        systemPrompt,
        userMessage: req.message,
        conversationHistory: history,
        temperature: 0.5,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          fullReply += chunk.content ?? '';
          yield chunk;
        } else if (chunk.type === 'usage') {
          conversationId = await this.persistConversation(
            req,
            fullReply,
            (chunk.usage?.inputTokens ?? 0) + (chunk.usage?.outputTokens ?? 0),
          );

          logAIUsage({
            userId: req.userId,
            feature: 'chat-stream',
            model: 'claude',
            usage: chunk.usage!,
            latencyMs: 0,
            success: true,
            requestContext: { conversationId, contextType: req.context?.type },
          });

          yield chunk;
        } else if (chunk.type === 'done') {
          yield { ...chunk, conversationId };
        }
      }
    } catch (error) {
      this.fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Chat stream failed');

      logAIUsage({
        userId: req.userId,
        feature: 'chat-stream',
        model: 'claude',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      yield {
        type: 'text_delta' as const,
        content: '\n\n[An error occurred while generating the response. Please try again.]',
      };
      yield { type: 'done' as const, conversationId };
    }
  }

  // -----------------------------------------------------------------------
  // Conversation CRUD (database-backed)
  // -----------------------------------------------------------------------

  async getConversations(userId: string): Promise<Omit<ChatConversation, 'isActive'>[]> {
    return chatRepository.findByUserId(userId);
  }

  async getConversation(conversationId: string, userId: string): Promise<(ChatConversation & { messages: ChatMessage[] }) | null> {
    const conv = await chatRepository.findByIdForUser(conversationId, userId);
    if (!conv) return null;
    const messages = await chatRepository.getAllMessages(conversationId);
    return { ...conv, messages };
  }

  async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
    return chatRepository.softDelete(conversationId, userId);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async prepareConversation(req: ChatRequest): Promise<{
    systemPrompt: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  }> {
    let projectContext = 'No specific project context.';
    let agentInsightsContext = '';

    if (req.context?.projectId) {
      try {
        const ctx = await this.contextBuilder.buildProjectContext(req.context.projectId);
        projectContext = this.contextBuilder.toPromptString(ctx);
      } catch {
        projectContext = `Project ID: ${req.context.projectId} (context unavailable)`;
      }

      // Fetch agent insights for this project (fire-and-forget safe)
      try {
        const [insights, priorConvos, mjuziMemories] = await Promise.all([
          this.interAgentQueryService.getInsightsByProject(req.context.projectId),
          chatRepository.findByProjectId(req.context.projectId, req.userId),
          agentMemoryService.recall('mjuzi-chat', 'project', req.context.projectId),
        ]);

        const parts: string[] = [];

        if (insights.length > 0) {
          const insightLines = insights.map(i => `- ${i.agentId}: ${JSON.stringify(i.value)}`).join('\n');
          parts.push(`Recent agent scan findings for this project:\n${insightLines}`);
        }

        if (priorConvos.length > 0) {
          parts.push(`You have had ${priorConvos.length} prior conversation(s) about this project.`);
        }

        if (mjuziMemories.length > 0) {
          const memLines = mjuziMemories.slice(0, 5).map(m => `- ${m.keyName}: ${JSON.stringify(m.value)}`).join('\n');
          parts.push(`Your prior notes about this project:\n${memLines}`);
        }

        if (parts.length > 0) {
          agentInsightsContext = '\n\n' + parts.join('\n\n');
        }
      } catch {
        // Non-critical — continue without agent context
      }
    } else {
      // Always load portfolio context when no specific project is selected
      try {
        const ctx = await this.contextBuilder.buildPortfolioContext({ userId: req.userId, role: req.userRole });
        projectContext = this.contextBuilder.portfolioToPromptString(ctx);
      } catch {
        projectContext = 'Portfolio context unavailable.';
      }
    }

    const systemPrompt = promptTemplates.conversational.render({
      projectContext: projectContext + agentInsightsContext,
      userRole: req.userRole || 'team_member',
    });

    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (req.conversationId) {
      try {
        const messages = await chatRepository.getMessages(req.conversationId, 20);
        // Verify ownership by checking conversation exists for user
        const conv = await chatRepository.findByIdForUser(req.conversationId, req.userId);
        if (conv) {
          history = messages.map(m => ({ role: m.role, content: m.content }));
        }
      } catch {
        // Continue without history
      }
    }

    return { systemPrompt, history };
  }

  private async persistConversation(
    req: ChatRequest,
    assistantReply: string,
    tokenCount: number,
    actions?: ActionResult[],
  ): Promise<string> {
    try {
      if (req.conversationId) {
        // Verify ownership
        const conv = await chatRepository.findByIdForUser(req.conversationId, req.userId);
        if (conv) {
          await chatRepository.addMessage(req.conversationId, { role: 'user', content: req.message });
          await chatRepository.addMessage(req.conversationId, { role: 'assistant', content: assistantReply, actions });
          await chatRepository.updateTokenCount(req.conversationId, tokenCount);

          // Store agent memory if actions were taken
          this.storeActionMemory(req, actions);

          return req.conversationId;
        }
      }

      // Create new conversation
      const title = req.message.slice(0, 100) + (req.message.length > 100 ? '...' : '');
      const conv = await chatRepository.createConversation({
        userId: req.userId,
        projectId: req.context?.projectId,
        contextType: req.context?.type || 'general',
        title,
      });

      await chatRepository.addMessage(conv.id, { role: 'user', content: req.message });
      await chatRepository.addMessage(conv.id, { role: 'assistant', content: assistantReply, actions });
      await chatRepository.updateTokenCount(conv.id, tokenCount);

      // Store agent memory if actions were taken
      this.storeActionMemory(req, actions);

      return conv.id;
    } catch (error) {
      this.fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Failed to persist conversation');
      return req.conversationId || randomUUID();
    }
  }

  private storeActionMemory(req: ChatRequest, actions?: ActionResult[]): void {
    if (!actions || actions.length === 0 || !req.context?.projectId) return;

    const summary = actions.map(a => `${a.toolName}: ${a.summary}`).join('; ');
    agentMemoryService.store(
      'mjuzi-chat',
      'project',
      req.context.projectId,
      `action-${Date.now()}`,
      { userMessage: req.message.slice(0, 200), actions: summary },
    ).catch(() => { /* fire-and-forget */ });
  }
}
