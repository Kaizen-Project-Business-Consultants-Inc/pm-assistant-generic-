import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { claudeService, promptTemplates, AIPromptTooLargeError, type StreamChunk, type CompletionResult } from './claudeService';
import { AIContextBuilder, CHAT_PROMPT_TASK_LIMIT } from './aiContextBuilder';
import { logAIUsage } from './aiUsageLogger';
import { AI_TOOLS, MUTATING_TOOLS } from './aiToolDefinitions';
import { AIActionExecutor, type ActionResult } from './aiActionExecutor';
import { chatRepository, type ChatConversation, type ChatMessage } from '../database/ChatRepository';
import { agentMemoryService } from './AgentMemoryService';
import { InterAgentQueryService } from './agents/InterAgentQueryService';
import { AIBudgetExceededError } from './AIBudgetService';
import { contextConfigService } from './context/ContextConfigService';
import { getRequestContext } from '../middleware/requestContext';
import { sanitizeForPrompt } from '../utils/promptSanitizer';

/**
 * The items a past reply's actions named, as one line after that reply in the chat history: a
 * follow-up ("mark them complete") has the ids instead of guessing them — the guesses were refused
 * and searched for again, one paid step per task (U58, 2026-10-20)
 */
function itemsLine(actions: ChatMessage['actions']): string {
  const refs = (actions ?? []).flatMap((a: { refs?: Array<{ id: string; name?: string; scheduleId?: string }> }) => a?.refs ?? []);
  if (refs.length === 0) return '';
  // names are the company's text: one line, no brackets, so a name can't break out of the line
  const clean = (name: string) => sanitizeForPrompt(name).replace(/[\r\n[\]"]+/g, ' ').trim();
  const items = refs.slice(0, 30).map(r => `${r.name ? `"${clean(r.name)}" ` : ''}id=${r.id}${r.scheduleId ? ` scheduleId=${r.scheduleId}` : ''}`);
  return `\n[Items in this answer: ${items.join('; ')}]`;
}

/** Replies whose items are given back in the history (the newest ones) */
const ITEMS_REPLIES = 2;

/**
 * More than a few link changes in one message is a bulk edit (M4, 2026-10-23: "link all tasks" chained
 * 33 tasks into one line without asking). Past this, the change is refused and Mjuzi must show the
 * user the links it proposes and ask first.
 */
export const MAX_LINK_CHANGES_PER_MESSAGE = 3;
const LINK_TOOLS = new Set(['set_dependency', 'remove_dependency']);

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
      feature: 'chat-tools',
          systemPrompt,
          userMessage: req.message,
          conversationHistory: history,
          temperature: 0.5,
          tools: AI_TOOLS,
          executeToolFn: async (toolName: string, toolInput: Record<string, any>) => {
            if (LINK_TOOLS.has(toolName) && allActions.filter(a => a.success && LINK_TOOLS.has(a.toolName)).length >= MAX_LINK_CHANGES_PER_MESSAGE) {
              const stopped: ActionResult = {
                success: false,
                toolName,
                summary: `Stopped: more than ${MAX_LINK_CHANGES_PER_MESSAGE} link changes in one message needs the user's OK. List the links you propose (task row → predecessor row), say what it would do to the plan, and ask them to confirm before making more.`,
                error: 'Bulk link change needs the user\'s OK',
              };
              allActions.push(stopped);
              return JSON.stringify(stopped);
            }
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
      feature: 'chat',
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
      // The plan has no AI, the account's AI is paused (neutral message), or the question needs
      // more data than one call can read: the error's own message says so
      const ownMessage = error instanceof AIPromptTooLargeError
        || (error instanceof AIBudgetExceededError && error.code !== 'AI_BUDGET_EXCEEDED');
      if (ownMessage) {
        reply = (error as Error).message;
      } else if (error instanceof AIBudgetExceededError && error.needed > 0 && error.used < error.budget) {
        reply = `This question needs about ${error.needed.toLocaleString()} AI tokens and you have ${(error.budget - error.used).toLocaleString()} left this month. Try a narrower question, or [purchase additional tokens](/pricing).`;
      } else if (error instanceof AIBudgetExceededError) {
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
      feature: 'chat-stream',
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

      // A refusal before any call (no AI on the plan, budget, question too big) says why
      const refusal = error instanceof AIBudgetExceededError || error instanceof AIPromptTooLargeError;
      yield {
        type: 'text_delta' as const,
        content: refusal ? `\n\n${error.message}` : '\n\n[An error occurred while generating the response. Please try again.]',
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

    // Fetch all context in parallel: project/portfolio data, agent insights, self-learning memories
    const userMemoriesP = agentMemoryService.recall('mjuzi-chat', 'role', req.userId).catch(() => []);

    if (req.context?.projectId) {
      try {
        const [ctx, insights, projectMemories, userMemories] = await Promise.all([
          this.contextBuilder.buildProjectContext(req.context.projectId).catch(() => null),
          this.interAgentQueryService.getInsightsByProject(req.context.projectId).catch(() => []),
          agentMemoryService.recall('mjuzi-chat', 'project', req.context.projectId, undefined, { excludeKeyPrefix: 'action-' }).catch(() => []),
          userMemoriesP,
        ]);

        // Up to CHAT_PROMPT_TASK_LIMIT task lines: this prompt is resent on every turn of the tool
        // loop, and Mjuzi can look up the rest with list_tasks (audit 2026-10-10 H1)
        projectContext = ctx
          ? `${this.contextBuilder.toPromptString(ctx, CHAT_PROMPT_TASK_LIMIT, true)}A task not listed here can be found with list_tasks and nameContains (or status / assignedTo).\n`
          : `Project ID: ${req.context.projectId} (context unavailable)`;

        const parts: string[] = [];

        if (insights.length > 0) {
          const insightLines = insights.map(i => `- ${i.agentId}: ${JSON.stringify(i.value)}`).join('\n');
          parts.push(`Recent agent scan findings for this project:\n${insightLines}`);
        }

        // Mjuzi project notes (excluding corrections, which go in selfLearnContext). Old automatic
        // "action-<time>" logs are left out: one was written after every change, so the prompt —
        // and its cache — changed every message, and the chat history already says what was done (U58)
        const projectNotes = projectMemories.filter(m => !m.keyName.startsWith('correction:') && !m.keyName.startsWith('action-'));
        if (projectNotes.length > 0) {
          const memLines = projectNotes.slice(0, 5).map(m => `- ${m.keyName}: ${JSON.stringify(m.value)}`).join('\n');
          parts.push(`Your prior notes about this project:\n${memLines}`);
        }

        if (parts.length > 0) {
          agentInsightsContext = '\n\n' + parts.join('\n\n');
        }

        // Self-learning: user prefs + corrections (user-scoped + project-scoped)
        agentInsightsContext += this.buildSelfLearnContext(userMemories, projectMemories);
      } catch {
        // Non-critical — continue with defaults
      }
    } else {
      try {
        const [ctx, userMemories] = await Promise.all([
          this.contextBuilder.buildPortfolioContext({ userId: req.userId, role: req.userRole }).catch(() => null),
          userMemoriesP,
        ]);
        projectContext = ctx ? this.contextBuilder.portfolioToPromptString(ctx) : 'Portfolio context unavailable.';
        agentInsightsContext += this.buildSelfLearnContext(userMemories, []);
      } catch {
        projectContext = 'Portfolio context unavailable.';
      }
    }

    // Resolve hierarchical context config (org -> project -> user)
    let customContextPrompt = '';
    try {
      // The company this chat runs in: it picks the company's own settings, and which company's
      // project settings apply (project ids repeat across companies — 2026-10-08). This read
      // req.organizationId, which a chat request never has, so company settings never applied.
      const resolved = await contextConfigService.resolveContext(
        getRequestContext()?.organizationId ?? null,
        req.context?.projectId || null,
        req.userId,
      );
      customContextPrompt = contextConfigService.formatForPrompt(resolved);
    } catch {
      // Non-critical — continue without custom context
    }

    // The company's own instructions first: the data after them can be long, and an over-long
    // prompt is cut at the end — it was the instructions that got cut (U58, 2026-10-20)
    const systemPrompt = promptTemplates.conversational.render({
      projectContext: customContextPrompt + projectContext + agentInsightsContext,
      userRole: req.userRole || 'team_member',
    });

    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (req.conversationId) {
      try {
        const messages = await chatRepository.getMessages(req.conversationId, 20);
        // Verify ownership by checking conversation exists for user
        const conv = await chatRepository.findByIdForUser(req.conversationId, req.userId);
        if (conv) {
          // the items line on the last ITEMS_REPLIES replies only: older ones are rarely what a
          // follow-up means, and every line is resent on every step
          const replies = messages.filter(m => m.role === 'assistant');
          const recent = new Set(replies.slice(-ITEMS_REPLIES));
          history = messages.map(m => ({ role: m.role, content: recent.has(m) ? m.content + itemsLine(m.actions) : m.content }));
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
      return conv.id;
    } catch (error) {
      this.fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Failed to persist conversation');
      return req.conversationId || randomUUID();
    }
  }

  private buildSelfLearnContext(
    userMemories: import('./AgentMemoryService').AgentMemory[],
    projectMemories: import('./AgentMemoryService').AgentMemory[],
  ): string {
    const prefEntries = userMemories.filter(m => m.keyName.startsWith('pref:'));
    const corrEntries = [
      ...userMemories.filter(m => m.keyName.startsWith('correction:')),
      ...projectMemories.filter(m => m.keyName.startsWith('correction:')),
    ];

    if (prefEntries.length === 0 && corrEntries.length === 0) return '';

    const parts: string[] = [];
    if (prefEntries.length > 0) {
      const prefLines = prefEntries.slice(0, 10).map(m => {
        const v = m.value as { value: string; reason: string };
        return `- ${m.keyName.replace('pref:', '')}: ${v.value}`;
      }).join('\n');
      parts.push(`User preferences (apply these to your responses):\n${prefLines}`);
    }
    if (corrEntries.length > 0) {
      const corrLines = corrEntries.slice(0, 10).map(m => {
        const v = m.value as { wrong: string; correct: string };
        return `- ${m.keyName.replace('correction:', '')}: NOT "${v.wrong}" — correct is "${v.correct}"`;
      }).join('\n');
      parts.push(`Previous corrections (do not repeat these mistakes):\n${corrLines}`);
    }
    return '\n\n' + parts.join('\n\n');
  }
}
