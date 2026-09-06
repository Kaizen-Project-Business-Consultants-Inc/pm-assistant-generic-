import { create } from 'zustand';
import { apiService } from '../services/api';
import { queryClient } from '../main';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  actions?: ActionResult[];
  context?: {
    type: string;
    projectId?: string;
  };
}

export interface ActionResult {
  success: boolean;
  toolName: string;
  summary: string;
  data?: any;
  error?: string;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  contextType: string;
  projectId?: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AIChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  conversationId: string | null;
  error: string | null;
  conversations: ConversationSummary[];
  conversationsLoaded: boolean;

  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateLastAssistantMessage: (content: string) => void;
  setStreaming: (messageId: string, isStreaming: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setConversationId: (id: string | null) => void;
  clearChat: () => void;
  sendMessage: (
    userMessage: string,
    context?: { type: string; projectId?: string },
  ) => Promise<void>;
  loadConversations: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
}

let messageIdCounter = 0;

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: "Hi! I'm Mjuzi, your AI project assistant. I remember our past conversations and can help you manage projects, analyze risks, and take action. What can I help with?",
  timestamp: new Date().toISOString(),
};

export const useAIChatStore = create<AIChatState>()((set, get) => ({
  messages: [WELCOME_MESSAGE],
  isLoading: false,
  conversationId: null,
  error: null,
  conversations: [],
  conversationsLoaded: false,

  addMessage: (message) => set((state) => {
    const id = `msg-${Date.now()}-${++messageIdCounter}`;
    const newMessage: ChatMessage = {
      ...message,
      id,
      timestamp: new Date().toISOString(),
    };
    return { messages: [...state.messages, newMessage], error: null };
  }),

  updateLastAssistantMessage: (content) => set((state) => {
    let lastIdx = -1;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'assistant') { lastIdx = i; break; }
    }
    if (lastIdx === -1) return state;
    return {
      messages: state.messages.map((m, i) =>
        i === lastIdx ? { ...m, content } : m
      ),
    };
  }),

  setStreaming: (messageId, isStreaming) => set((state) => ({
    messages: state.messages.map(m =>
      m.id === messageId ? { ...m, isStreaming } : m
    ),
  })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  setConversationId: (conversationId) => set({ conversationId }),

  clearChat: () => set({
    messages: [WELCOME_MESSAGE],
    conversationId: null,
    error: null,
    isLoading: false,
  }),

  sendMessage: async (userMessage, context) => {
    const { addMessage, updateLastAssistantMessage, setLoading, setError, setConversationId, conversationId } = get();

    setLoading(true);

    // Add placeholder assistant message and capture its ID immediately
    addMessage({ role: 'assistant', content: '', isStreaming: true });
    const messages = get().messages;
    const placeholderMsg = messages[messages.length - 1];

    try {
      // Use non-streaming endpoint for tool support
      const result = await apiService.sendChatMessage({
        message: userMessage,
        conversationId: conversationId || undefined,
        context,
      });

      // Update the placeholder with the real response
      set((state) => ({
        messages: state.messages.map(m =>
          m.id === placeholderMsg.id
            ? { ...m, content: result.reply, isStreaming: false, actions: result.actions }
            : m
        ),
      }));

      if (result.conversationId) {
        setConversationId(result.conversationId);
      }

      // If Mjuzi took actions that modify data, invalidate relevant caches
      if (result.actions && result.actions.length > 0) {
        const mutatingTools = new Set([
          'create_task', 'update_task', 'delete_task',
          'reschedule_task', 'cascade_reschedule',
          'set_dependency', 'remove_dependency', 'clear_all_dependencies',
        ]);
        const projectTools = new Set(['create_project', 'update_project']);
        const hasMutation = result.actions.some((a: ActionResult) => mutatingTools.has(a.toolName));
        const hasProjectMutation = result.actions.some((a: ActionResult) => projectTools.has(a.toolName));

        if (hasMutation) {
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          queryClient.invalidateQueries({ queryKey: ['schedule'] });
          queryClient.invalidateQueries({ queryKey: ['gantt'] });
        }
        if (hasProjectMutation) {
          queryClient.invalidateQueries({ queryKey: ['projects'] });
          queryClient.invalidateQueries({ queryKey: ['project'] });
        }
      }

      // Refresh conversation list in background
      get().loadConversations().catch(() => { /* Background refresh — non-critical */ });

      setLoading(false);
    } catch (error) {
      const errData = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { code?: string; resetDate?: string } } }).response?.data
        : undefined;
      const isBudgetExceeded = errData?.code === 'AI_BUDGET_EXCEEDED';

      if (isBudgetExceeded) {
        const resetDate = errData?.resetDate || 'next month';
        updateLastAssistantMessage(
          `You've reached your monthly AI token limit. Your budget resets on **${resetDate}**.\n\nYou can [purchase additional tokens](/pricing) to continue using AI features, or wait for your budget to reset. All non-AI features remain fully available.`,
        );
      } else {
        updateLastAssistantMessage(
          'Sorry, I encountered an error connecting to the AI service. Please try again.',
        );
      }

      set((state) => ({
        messages: state.messages.map(m =>
          m.id === placeholderMsg.id ? { ...m, isStreaming: false } : m
        ),
      }));

      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  },

  loadConversations: async () => {
    try {
      const data = await apiService.getConversations();
      set({ conversations: data.conversations || [], conversationsLoaded: true });
    } catch {
      // Non-critical
    }
  },

  loadConversation: async (id: string) => {
    try {
      const data = await apiService.getConversation(id);
      if (data.conversation) {
        const conv = data.conversation;
        const messages: ChatMessage[] = (conv.messages || []).map((m: any, idx: number) => ({
          id: m.id || `loaded-${idx}`,
          role: m.role,
          content: m.content,
          timestamp: m.createdAt || m.created_at || new Date().toISOString(),
          actions: m.actions,
        }));
        set({
          messages: messages.length > 0 ? messages : [WELCOME_MESSAGE],
          conversationId: conv.id,
          error: null,
        });
      }
    } catch {
      set({ error: 'Failed to load conversation' });
    }
  },
}));

export const dashboardQuickActions: QuickAction[] = [
  { id: 'risk-scan', label: 'Risk Scan', icon: 'Shield', prompt: 'Scan all active projects for risks and give me a summary of the top concerns.' },
  { id: 'daily-brief', label: 'Daily Brief', icon: 'Sun', prompt: 'Give me a daily briefing on my projects. What needs attention today?' },
  { id: 'create-project', label: 'New Project', icon: 'Plus', prompt: 'Help me create a new project. Ask me what I need.' },
  { id: 'report', label: 'Status Report', icon: 'FileText', prompt: 'Generate a status report for all active projects.' },
  { id: 'resource-contention', label: 'Resource Contention', icon: 'Users', prompt: 'Are any resources over-allocated across my projects? Show me who is spread too thin and suggest how to rebalance.' },
];

export const projectQuickActions: QuickAction[] = [
  { id: 'analyze', label: 'Analyze', icon: 'BarChart3', prompt: 'Analyze this project and tell me how it\'s doing overall.' },
  { id: 'risks', label: 'Find Risks', icon: 'AlertTriangle', prompt: 'What are the biggest risks for this project right now?' },
  { id: 'add-task', label: 'Add Task', icon: 'Plus', prompt: 'I need to add a new task to this project. Ask me for the details.' },
  { id: 'whats-overdue', label: 'Overdue?', icon: 'Clock', prompt: 'Show me any overdue or at-risk tasks in this project and suggest what to do about them.' },
  { id: 'resource-check', label: 'Resource Check', icon: 'Users', prompt: 'Check resource utilization for this project. Who is over-allocated? Are there any bottlenecks or burnout risks?' },
];
