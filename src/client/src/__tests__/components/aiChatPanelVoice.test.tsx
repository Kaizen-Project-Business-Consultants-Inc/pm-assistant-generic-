import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Mjuzi's voice in the chat panel: only a reply that ARRIVES while the panel is open is read aloud
 * (an old conversation opened from History is not), and a spoken question hands the mic over once
 * the voice has finished.
 */
const speak = vi.hoisted(() => vi.fn());
const startListening = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({
  messages: [] as any[],
  isLoading: false,
  error: null as string | null,
  conversations: [] as any[],
  conversationsLoaded: true,
}));

vi.mock('../../hooks/useVoice', () => ({
  useVoice: () => ({ isSupported: true, isListening: false, startListening, stopListening: vi.fn(), speak, cancelSpeech: vi.fn(), isSpeaking: false, error: null }),
}));
vi.mock('../../stores/aiChatStore', () => ({
  useAIChatStore: () => ({
    ...store, addMessage: vi.fn(), clearChat: vi.fn(), sendMessage: vi.fn(), loadConversations: vi.fn(), loadConversation: vi.fn(),
  }),
  dashboardQuickActions: [],
  projectQuickActions: [],
}));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { AIChatPanel } from '../../components/ai/AIChatPanel';
import { announce } from '../../utils/announce';

const panel = () => (<MemoryRouter><AIChatPanel context={{ type: 'dashboard' } as never} /></MemoryRouter>);
const old = { id: 'old-1', role: 'assistant', content: 'An old answer. Anything else?', isStreaming: false };

describe('AIChatPanel voice', () => {
  beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); }); // jsdom has none
  beforeEach(() => { speak.mockClear(); startListening.mockClear(); store.messages = [{ id: 'welcome', role: 'assistant', content: 'Hi', isStreaming: false }, old]; });
  afterEach(() => cleanup());

  it('does not read out a conversation that was already there, even with Speak replies on', () => {
    const { rerender } = render(panel());
    fireEvent.click(screen.getByLabelText('Speak replies'));
    rerender(panel());
    expect(speak).not.toHaveBeenCalled();
  });

  it('reads out a reply that arrives while the panel is open, and asks for the mic only when it ends in a question', () => {
    const { rerender } = render(panel());
    fireEvent.click(screen.getByLabelText('Speak replies'));

    // the reply starts as an empty streaming placeholder, then is filled in
    store.messages = [...store.messages, { id: 'new-1', role: 'assistant', content: '', isStreaming: true }];
    rerender(panel());
    store.messages = [...store.messages.slice(0, -1), { id: 'new-1', role: 'assistant', content: 'Done. Shall I continue?', isStreaming: false }];
    rerender(panel());

    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('Done. Shall I continue?', expect.any(Function));

    // a statement is read out with no mic hand-over
    store.messages = [...store.messages, { id: 'new-2', role: 'assistant', content: '', isStreaming: true }];
    rerender(panel());
    store.messages = [...store.messages.slice(0, -1), { id: 'new-2', role: 'assistant', content: 'All done.', isStreaming: false }];
    rerender(panel());
    expect(speak).toHaveBeenLastCalledWith('All done.', undefined);
  });

  it('opening a past conversation from History (messages swapped for the loaded ones) is not read out', () => {
    const { rerender } = render(panel());
    fireEvent.click(screen.getByLabelText('Speak replies'));
    store.messages = [{ id: 'loaded-1', role: 'user', content: 'Earlier question', isStreaming: false }, { id: 'loaded-2', role: 'assistant', content: 'Earlier answer. Want more?', isStreaming: false }];
    rerender(panel());
    expect(speak).not.toHaveBeenCalled();
    expect(startListening).not.toHaveBeenCalled();
  });

  it('when the voice ends after a question, the mic opens unless the person has started typing', () => {
    const { rerender } = render(panel());
    fireEvent.click(screen.getByLabelText('Speak replies'));
    store.messages = [...store.messages, { id: 'q-1', role: 'assistant', content: '', isStreaming: true }];
    rerender(panel());
    store.messages = [...store.messages.slice(0, -1), { id: 'q-1', role: 'assistant', content: 'Which task?', isStreaming: false }];
    rerender(panel());
    const handOver = speak.mock.calls[0][1] as () => void;

    fireEvent.change(screen.getByLabelText('Chat message input'), { target: { value: 'typing an answer' } });
    handOver();
    expect(startListening).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Chat message input'), { target: { value: '' } });
    handOver();
    expect(startListening).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/microphone is on/)); // screen readers are told
  });
});
