import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Trash2,
  Loader2,
  Bot,
  User,
  ChevronDown,
  CheckCircle,
  XCircle,
  Mic,
  MicOff,
  History,
  Plus,
  MessageSquare,
} from 'lucide-react';
import { useAIChatStore, dashboardQuickActions, projectQuickActions, type QuickAction, type ConversationSummary } from '../../stores/aiChatStore';
import { AIChatContext } from './AIChatContext';
import { QuickActions } from './QuickActions';
import { useVoice } from '../../hooks/useVoice';
import type { AIPanelContext } from '../../stores/uiStore';

interface AIChatPanelProps {
  context: AIPanelContext;
}

export function AIChatPanel({ context }: AIChatPanelProps) {
  const {
    messages, isLoading, error, addMessage, clearChat, sendMessage,
    conversations, conversationsLoaded, loadConversations, loadConversation,
  } = useAIChatStore();
  const [input, setInput] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastSpokenMessageIdRef = useRef<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const { isSupported: voiceSupported, isListening, startListening, stopListening, speak } = useVoice();

  const quickActions = context.type === 'project' ? projectQuickActions : dashboardQuickActions;

  // Load conversations on first open
  useEffect(() => {
    if (!conversationsLoaded) {
      loadConversations();
    }
  }, [conversationsLoaded, loadConversations]);

  // Speak assistant replies when TTS is enabled and a new assistant message is finalized
  useEffect(() => {
    if (!ttsEnabled || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.id === 'welcome') return; // never speak the welcome message
    if (
      last.role === 'assistant' &&
      !last.isStreaming &&
      last.content &&
      last.id !== lastSpokenMessageIdRef.current
    ) {
      speak(last.content);
      lastSpokenMessageIdRef.current = last.id;
    }
  }, [messages, ttsEnabled, speak]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setShowScrollButton(scrollHeight - scrollTop - clientHeight > 100);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    addMessage({ role: 'user', content: trimmed });
    setInput('');
    sendMessage(trimmed, context);
  }

  function handleQuickAction(action: QuickAction) {
    if (isLoading) return;
    addMessage({ role: 'user', content: action.prompt });
    sendMessage(action.prompt, context);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleMicClick() {
    if (isListening) {
      stopListening();
      return;
    }
    startListening((transcript) => {
      const trimmed = transcript.trim();
      if (!trimmed || isLoading) return;
      addMessage({ role: 'user', content: trimmed });
      sendMessage(trimmed, context);
    });
  }

  function handleSelectConversation(conv: ConversationSummary) {
    loadConversation(conv.id);
    setShowHistory(false);
  }

  function handleNewConversation() {
    clearChat();
    setShowHistory(false);
  }

  function formatDate(dateStr: string) {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString();
    } catch {
      return '';
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Context Bar + History Toggle */}
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 px-2 py-1">
        <div className="flex-1">
          <AIChatContext context={context} />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewConversation}
            className="rounded-md p-1.5 text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300"
            title="New conversation"
            aria-label="New conversation"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (!conversationsLoaded) loadConversations();
            }}
            className={`rounded-md p-1.5 ${showHistory ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300'}`}
            title="Conversation history"
            aria-label="Conversation history"
          >
            <History className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Conversation History Dropdown */}
      {showHistory && (
        <div className="max-h-60 overflow-y-auto border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          {conversations.length === 0 ? (
            <div className="px-4 py-3 text-center text-xs text-gray-500 dark:text-gray-500">
              No past conversations
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {conversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-500 dark:text-gray-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">
                      {conv.title}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      {formatDate(conv.updatedAt)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === 'user' ? 'flex-row-reverse' : ''
              }`}
            >
              <div
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                  message.role === 'assistant'
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}
              >
                {message.role === 'assistant' ? (
                  <Bot className="h-4 w-4" />
                ) : (
                  <User className="h-4 w-4" />
                )}
              </div>
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  message.role === 'assistant'
                    ? 'bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100'
                    : 'bg-primary-600 text-white'
                }`}
              >
                {message.content.split('\n').map((line, i) => (
                  <React.Fragment key={i}>
                    {line.split(/(\*\*.*?\*\*)/).map((part, j) =>
                      part.startsWith('**') && part.endsWith('**') ? (
                        <strong key={j}>{part.slice(2, -2)}</strong>
                      ) : (
                        <span key={j}>{part}</span>
                      )
                    )}
                    {i < message.content.split('\n').length - 1 && <br />}
                  </React.Fragment>
                ))}
                {message.isStreaming && (
                  <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-primary-500" />
                )}
                {/* Action Results */}
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-gray-200 dark:border-gray-600 pt-2">
                    {message.actions.map((action, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                          action.success
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                        }`}
                      >
                        {action.success ? (
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        ) : (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        )}
                        <span>{action.summary}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && !messages.some(m => m.isStreaming) && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400">
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-1.5 rounded-xl bg-gray-50 dark:bg-gray-800 px-4 py-3">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '0ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '200ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '400ms' }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Scroll to bottom */}
      {showScrollButton && (
        <div className="absolute bottom-36 left-1/2 -translate-x-1/2">
          <button
            onClick={scrollToBottom}
            className="rounded-full bg-white dark:bg-gray-800 p-1.5 shadow-md ring-1 ring-gray-200 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Scroll to bottom"
          >
            <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
      )}

      {/* Quick Actions */}
      {messages.length <= 1 && (
        <QuickActions actions={quickActions} onAction={handleQuickAction} />
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-end gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={clearChat}
              className="rounded-md p-1.5 text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300"
              title="Clear chat"
              aria-label="Clear chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            {voiceSupported && (
              <button
                type="button"
                onClick={handleMicClick}
                disabled={isLoading}
                className={`rounded-md p-1.5 ${
                  isListening
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
                    : 'text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
                title={isListening ? 'Stop listening' : 'Speak your message'}
                aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
              >
                {isListening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Mjuzi about your projects..."
            aria-label="Chat message input"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3.5 py-2.5 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            style={{ maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={ttsEnabled}
              onChange={(e) => setTtsEnabled(e.target.checked)}
              className="h-3 w-3 rounded border-gray-300 dark:border-gray-600"
            />
            Speak replies
          </label>
          <span className="text-xs text-gray-500 dark:text-gray-500">
            Mjuzi can make mistakes. Verify important information.
          </span>
        </div>
      </div>
    </div>
  );
}
