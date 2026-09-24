import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockFindActive = vi.fn();
const mockUpdateLastSyncAt = vi.fn().mockResolvedValue(undefined);
vi.mock('../../database/IntegrationRepository', () => ({
  integrationRepository: {
    findActiveByProviderAndProject: (...args: any[]) => mockFindActive(...args),
    updateLastSyncAt: (...args: any[]) => mockUpdateLastSyncAt(...args),
  },
  parseConfig: (raw: any) => (typeof raw === 'string' ? JSON.parse(raw) : raw || {}),
}));

const mockBuildEventCards = vi.fn();
const mockDeliver = vi.fn();
vi.mock('../../services/integrations/TeamsAdapter', () => ({
  teamsAdapter: {
    buildEventCards: (...args: any[]) => mockBuildEventCards(...args),
    deliver: (...args: any[]) => mockDeliver(...args),
  },
  canPostToTeams: (cfg: any) => !!(cfg.accessToken && cfg.teamId && cfg.channelId),
}));

vi.mock('../../services/ProjectService', () => ({
  projectService: { findById: vi.fn().mockResolvedValue({ name: 'Test Project' }) },
}));

import { teamsEventDispatcher } from '../../services/integrations/TeamsEventDispatcher';

describe('TeamsEventDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeliver.mockResolvedValue({ success: true, message: 'ok' });
  });

  it('does nothing without a project — Teams events are always project-scoped', async () => {
    await teamsEventDispatcher.dispatchToTeams('task.completed', {});
    expect(mockFindActive).not.toHaveBeenCalled();
  });

  it('does nothing when the project has no active Teams connection', async () => {
    mockFindActive.mockResolvedValue([]);
    await teamsEventDispatcher.dispatchToTeams('task.completed', {}, 'p1');
    expect(mockBuildEventCards).not.toHaveBeenCalled();
  });

  it('skips a connection that has not finished being configured (no team/channel chosen yet)', async () => {
    mockFindActive.mockResolvedValue([{ id: 'i1', config: JSON.stringify({ accessToken: 'x' }) }]);
    await teamsEventDispatcher.dispatchToTeams('task.completed', {}, 'p1');
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it('delivers to a fully configured connection and stamps lastSyncAt on success', async () => {
    mockFindActive.mockResolvedValue([
      { id: 'i1', config: JSON.stringify({ accessToken: 'x', teamId: 't1', channelId: 'c1' }) },
    ]);
    mockBuildEventCards.mockReturnValue({ text: 'hi', card: {} });

    await teamsEventDispatcher.dispatchToTeams('task.completed', { task: { name: 'X' } }, 'p1');
    // deliver() is fired and awaited via .then(), flush microtasks
    await new Promise((r) => setImmediate(r));

    expect(mockDeliver).toHaveBeenCalledWith('i1', expect.objectContaining({ teamId: 't1' }), { text: 'hi', card: {} });
    expect(mockUpdateLastSyncAt).toHaveBeenCalledWith('i1');
  });

  it('honours a per-connection event filter', async () => {
    mockFindActive.mockResolvedValue([
      { id: 'i1', config: JSON.stringify({ accessToken: 'x', teamId: 't1', channelId: 'c1', notifyEvents: ['risk.created'] }) },
    ]);

    await teamsEventDispatcher.dispatchToTeams('task.completed', { task: { name: 'X' } }, 'p1');

    expect(mockBuildEventCards).not.toHaveBeenCalled();
  });

  it('never throws when the underlying lookup fails — this must not break the caller', async () => {
    mockFindActive.mockRejectedValue(new Error('db down'));
    await expect(teamsEventDispatcher.dispatchToTeams('task.completed', {}, 'p1')).resolves.toBeUndefined();
  });
});
