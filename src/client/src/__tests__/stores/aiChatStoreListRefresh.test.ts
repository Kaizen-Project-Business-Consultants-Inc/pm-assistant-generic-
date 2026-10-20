import { describe, it, expect, vi, beforeEach } from 'vitest';

/** U58 (2026-10-20): the chat list is fetched again only when a reply starts a new chat */
const api = vi.hoisted(() => ({
  sendChatMessage: vi.fn(),
  getConversations: vi.fn(async () => ({ conversations: [] })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../queryClient', () => ({ queryClient: { invalidateQueries: vi.fn(), getQueryData: vi.fn(), getQueriesData: vi.fn(() => []) } }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));
vi.mock('../../utils/projectListCache', () => ({ refreshProjectLists: vi.fn() }));
vi.mock('../../utils/scheduleChanged', () => ({ refreshAfterScheduleChange: vi.fn(), projectOfSchedule: vi.fn() }));

import { useAIChatStore } from '../../stores/aiChatStore';

beforeEach(() => {
  vi.clearAllMocks();
  useAIChatStore.setState({ conversationId: null, messages: [] } as never);
});

describe('chat list refresh (U58)', () => {
  it('a reply that starts a new chat fetches the list', async () => {
    api.sendChatMessage.mockResolvedValue({ reply: 'hi', conversationId: 'c1' });
    await useAIChatStore.getState().sendMessage('hello');
    expect(api.getConversations).toHaveBeenCalledTimes(1);
  });

  it('a reply in a chat already open does not', async () => {
    useAIChatStore.setState({ conversationId: 'c1' } as never);
    api.sendChatMessage.mockResolvedValue({ reply: 'again', conversationId: 'c1' });
    await useAIChatStore.getState().sendMessage('more');
    expect(api.getConversations).not.toHaveBeenCalled();
  });
});
