import { describe, it, expect, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { watchSignedInUser } from '../../utils/signedInUser';
import { useAuthStore } from '../../stores/authStore';
import { useAIChatStore } from '../../stores/aiChatStore';
import { useUIStore } from '../../stores/uiStore';
import { apiService } from '../../services/api';

/** Sign-out keeps the tab; the next person must never see the last person's data (2026-10-11) */
describe('watchSignedInUser', () => {
  const org = { id: 'org-1', name: 'Co', slug: 'co' };
  const userA = { id: 'user-a', username: 'a', email: 'a@x.test', fullName: 'Ann A', role: 'project_manager', organization: org } as const;
  const userB = { ...userA, id: 'user-b', username: 'b', email: 'b@x.test', fullName: 'Ben B' } as const;
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null, isAuthenticated: false });
    useAIChatStore.getState().forgetUser();
    useUIStore.getState().clearNotifications();
    sessionStorage.clear();
  });

  const fillAsA = (qc: QueryClient) => {
    useAuthStore.getState().setUser({ ...userA });
    qc.setQueryData(['pm-projects'], { data: [{ id: 'p1', name: "Ann's secret project" }] });
    useAIChatStore.setState({ conversations: [{ id: 'c1', title: "Ann's chat" } as never], conversationsLoaded: true, conversationId: 'c1' });
    useUIStore.getState().addNotification({ title: "Ann's alert", message: 'x', type: 'info' } as never);
    useUIStore.getState().setAIPanelContext({ type: 'project', projectId: 'p1' } as never);
    sessionStorage.setItem('brief-draft-p1', "Ann's unsaved brief");
    stop = watchSignedInUser(qc);
  };

  const expectNothingOfA = (qc: QueryClient) => {
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(useAIChatStore.getState().conversations).toEqual([]);
    expect(useAIChatStore.getState().conversationsLoaded).toBe(false);
    expect(useAIChatStore.getState().conversationId).toBeNull();
    expect(useUIStore.getState().notifications).toEqual([]);
    expect(useUIStore.getState().aiPanelContext).toEqual({ type: 'dashboard' });
    expect(sessionStorage.getItem('brief-draft-p1')).toBeNull();
  };

  it('signing out drops the cache, Mjuzi conversations and context, notifications and brief drafts', () => {
    const qc = new QueryClient();
    fillAsA(qc);
    useAuthStore.getState().logout();
    expectNothingOfA(qc);
  });

  it('someone else signing in on the same tab (no sign-out) also starts clean', () => {
    const qc = new QueryClient();
    fillAsA(qc);
    useAuthStore.getState().setUser({ ...userB });
    expectNothingOfA(qc);
  });

  it('the same person in another company (invite accepted, support visit) starts clean', () => {
    const qc = new QueryClient();
    fillAsA(qc);
    useAuthStore.getState().setUser({ ...userA, organization: { id: 'org-2', name: 'Other', slug: 'other' } });
    expectNothingOfA(qc);
  });

  it('the same person refreshing their details keeps everything', () => {
    const qc = new QueryClient();
    fillAsA(qc);
    useAuthStore.getState().setUser({ ...userA, fullName: 'Ann Renamed' });
    expect(qc.getQueryData(['pm-projects'])).toBeDefined();
    expect(useAIChatStore.getState().conversations).toHaveLength(1);
    expect(useUIStore.getState().notifications).toHaveLength(1);
  });

  it('a Mjuzi reply that arrives after sign-out is dropped', async () => {
    const qc = new QueryClient();
    fillAsA(qc);
    let answer: (v: unknown) => void = () => {};
    vi.spyOn(apiService, 'sendChatMessage').mockReturnValue(new Promise((r) => { answer = r; }) as never);
    const sending = useAIChatStore.getState().sendMessage('hello');
    useAuthStore.getState().logout();
    answer({ reply: "Ann's answer", conversationId: 'c1', actions: [] });
    await sending;
    const { messages, conversationId } = useAIChatStore.getState();
    expect(conversationId).toBeNull();
    expect(messages.some((m) => m.content === "Ann's answer")).toBe(false);
  });

  const otherTabWrites = (user: unknown) => window.dispatchEvent(new StorageEvent('storage', {
    key: 'pm-generic-auth-storage',
    newValue: user === null ? null : JSON.stringify({ state: { user, isAuthenticated: true } }),
  }));

  it('a different person signing in in another tab: this tab takes them on, clean', () => {
    const qc = new QueryClient();
    fillAsA(qc);
    otherTabWrites({ ...userB });
    expect(useAuthStore.getState().user?.id).toBe('user-b');
    expectNothingOfA(qc);
    // the other tab hearing this tab's write of B changes nothing for it — no sign-out ping-pong
    otherTabWrites({ ...userB });
    expect(useAuthStore.getState().user?.id).toBe('user-b');
  });

  it('a sign-out in another tab signs this tab out', () => {
    const qc = new QueryClient();
    fillAsA(qc);
    otherTabWrites(null);
    expect(useAuthStore.getState().user).toBeNull();
    expectNothingOfA(qc);
  });
});
