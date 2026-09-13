import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must come before imports, factories are hoisted) ---

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../database/IntegrationRepository', () => {
  const repo = {
    create: vi.fn(),
    findByUser: vi.fn().mockResolvedValue([]),
    findByProject: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    updateIntegration: vi.fn(),
    deleteIntegration: vi.fn(),
    findRawById: vi.fn().mockResolvedValue(null),
    createSyncLog: vi.fn().mockResolvedValue('log-1'),
    completeSyncLog: vi.fn(),
    completeSyncTransaction: vi.fn(),
    findSyncLog: vi.fn().mockResolvedValue([]),
  };
  return {
    integrationRepository: repo,
    parseConfig: (raw: string | Record<string, any>) => {
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return {}; }
      }
      return raw || {};
    },
  };
});

vi.mock('../../services/integrations/JiraAdapter', () => ({
  jiraAdapter: {
    testConnection: vi.fn(),
    pullIssues: vi.fn(),
    pushTasks: vi.fn(),
  },
}));

vi.mock('../../services/integrations/GitHubAdapter', () => ({
  githubAdapter: {
    testConnection: vi.fn(),
    pullIssues: vi.fn(),
    pushTasks: vi.fn(),
  },
}));

vi.mock('../../services/integrations/SlackAdapter', () => ({
  slackAdapter: {
    testConnection: vi.fn(),
  },
}));

vi.mock('../../services/integrations/TrelloAdapter', () => ({
  trelloAdapter: {
    testConnection: vi.fn(),
    pullCards: vi.fn(),
    pushTasks: vi.fn(),
  },
}));

// --- Imports (after mocks) ---

import { IntegrationService, Integration } from '../../services/IntegrationService';
import { integrationRepository } from '../../database/IntegrationRepository';
import { jiraAdapter } from '../../services/integrations/JiraAdapter';
import { githubAdapter } from '../../services/integrations/GitHubAdapter';
import { slackAdapter } from '../../services/integrations/SlackAdapter';
import { trelloAdapter } from '../../services/integrations/TrelloAdapter';

const mockRepo = integrationRepository as any;
const mockJira = jiraAdapter as any;
const mockGithub = githubAdapter as any;
const mockSlack = slackAdapter as any;
const mockTrello = trelloAdapter as any;

// --- Test data ---

const sampleIntegration: Integration = {
  id: 'int-1',
  projectId: 'proj-1',
  userId: 'user-1',
  provider: 'jira',
  config: { baseUrl: 'https://test.atlassian.net', email: 'a@b.com', apiToken: 'tok****', projectKey: 'TEST' },
  isActive: true,
  lastSyncAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const rawJiraRow = {
  id: 'int-1',
  project_id: 'proj-1',
  user_id: 'user-1',
  provider: 'jira',
  config: JSON.stringify({ baseUrl: 'https://test.atlassian.net', email: 'a@b.com', apiToken: 'secret', projectKey: 'TEST' }),
  is_active: 1,
  last_sync_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const rawGithubRow = { ...rawJiraRow, id: 'int-2', provider: 'github', config: JSON.stringify({ token: 'gh-token', owner: 'org', repo: 'repo' }) };
const rawSlackRow = { ...rawJiraRow, id: 'int-3', provider: 'slack', config: JSON.stringify({ webhookUrl: 'https://hooks.slack.com/xxx' }) };
const rawTrelloRow = { ...rawJiraRow, id: 'int-4', provider: 'trello', config: JSON.stringify({ apiKey: 'key', token: 'tok', boardId: 'b1' }) };

// --- Tests ---

describe('IntegrationService', () => {
  let service: IntegrationService;

  beforeEach(() => {
    service = new IntegrationService();
    vi.clearAllMocks();
  });

  // ========== CRUD ==========

  describe('create', () => {
    it('delegates to repository with all parameters', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleIntegration);
      const result = await service.create('user-1', 'jira', { baseUrl: 'https://test.atlassian.net' }, 'proj-1');
      expect(mockRepo.create).toHaveBeenCalledWith('user-1', 'jira', { baseUrl: 'https://test.atlassian.net' }, 'proj-1');
      expect(result).toEqual(sampleIntegration);
    });

    it('works without projectId', async () => {
      mockRepo.create.mockResolvedValueOnce({ ...sampleIntegration, projectId: null });
      const result = await service.create('user-1', 'github', { token: 'abc' });
      expect(mockRepo.create).toHaveBeenCalledWith('user-1', 'github', { token: 'abc' }, undefined);
      expect(result.projectId).toBeNull();
    });
  });

  describe('getByUser', () => {
    it('returns integrations for user', async () => {
      mockRepo.findByUser.mockResolvedValueOnce([sampleIntegration]);
      const result = await service.getByUser('user-1');
      expect(mockRepo.findByUser).toHaveBeenCalledWith('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('int-1');
    });

    it('returns empty array when user has no integrations', async () => {
      mockRepo.findByUser.mockResolvedValueOnce([]);
      const result = await service.getByUser('user-no-ints');
      expect(result).toEqual([]);
    });
  });

  describe('getByProject', () => {
    it('returns integrations for project', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([sampleIntegration]);
      const result = await service.getByProject('proj-1');
      expect(mockRepo.findByProject).toHaveBeenCalledWith('proj-1');
      expect(result).toHaveLength(1);
    });

    it('returns empty array for project with no integrations', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]);
      const result = await service.getByProject('proj-empty');
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns integration when found', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleIntegration);
      const result = await service.getById('int-1');
      expect(result).toEqual(sampleIntegration);
    });

    it('returns null when not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await service.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates config', async () => {
      const updated = { ...sampleIntegration, config: { baseUrl: 'https://new.atlassian.net' } };
      mockRepo.updateIntegration.mockResolvedValueOnce(updated);
      const result = await service.update('int-1', { config: { baseUrl: 'https://new.atlassian.net' } });
      expect(mockRepo.updateIntegration).toHaveBeenCalledWith('int-1', { config: { baseUrl: 'https://new.atlassian.net' } });
      expect(result.config.baseUrl).toBe('https://new.atlassian.net');
    });

    it('updates isActive flag', async () => {
      const updated = { ...sampleIntegration, isActive: false };
      mockRepo.updateIntegration.mockResolvedValueOnce(updated);
      const result = await service.update('int-1', { isActive: false });
      expect(mockRepo.updateIntegration).toHaveBeenCalledWith('int-1', { isActive: false });
      expect(result.isActive).toBe(false);
    });

    it('updates both config and isActive simultaneously', async () => {
      const data = { config: { token: 'new' }, isActive: true };
      mockRepo.updateIntegration.mockResolvedValueOnce({ ...sampleIntegration, ...data });
      await service.update('int-1', data);
      expect(mockRepo.updateIntegration).toHaveBeenCalledWith('int-1', data);
    });
  });

  describe('delete', () => {
    it('delegates to repository', async () => {
      mockRepo.deleteIntegration.mockResolvedValueOnce(undefined);
      await service.delete('int-1');
      expect(mockRepo.deleteIntegration).toHaveBeenCalledWith('int-1');
    });
  });

  // ========== testConnection ==========

  describe('testConnection', () => {
    it('returns not found when integration does not exist', async () => {
      mockRepo.findRawById.mockResolvedValueOnce(null);
      const result = await service.testConnection('nonexistent');
      expect(result).toEqual({ success: false, message: 'Integration not found' });
    });

    it('tests Jira connection', async () => {
      mockRepo.findRawById.mockResolvedValueOnce(rawJiraRow);
      mockJira.testConnection.mockResolvedValueOnce({ success: true, message: 'Connected to Jira successfully' });
      const result = await service.testConnection('int-1');
      expect(mockJira.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'https://test.atlassian.net' }),
      );
      expect(result.success).toBe(true);
    });

    it('tests GitHub connection', async () => {
      mockRepo.findRawById.mockResolvedValueOnce(rawGithubRow);
      mockGithub.testConnection.mockResolvedValueOnce({ success: true, message: 'Connected' });
      const result = await service.testConnection('int-2');
      expect(mockGithub.testConnection).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('tests Slack connection', async () => {
      mockRepo.findRawById.mockResolvedValueOnce(rawSlackRow);
      mockSlack.testConnection.mockResolvedValueOnce({ success: true, message: 'Slack connected' });
      const result = await service.testConnection('int-3');
      expect(mockSlack.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: 'https://hooks.slack.com/xxx' }),
      );
      expect(result.success).toBe(true);
    });

    it('tests Trello connection', async () => {
      mockRepo.findRawById.mockResolvedValueOnce(rawTrelloRow);
      mockTrello.testConnection.mockResolvedValueOnce({ success: true, message: 'Trello connected' });
      const result = await service.testConnection('int-4');
      expect(mockTrello.testConnection).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('returns failure for unsupported provider', async () => {
      mockRepo.findRawById.mockResolvedValueOnce({ ...rawJiraRow, provider: 'bitbucket' });
      const result = await service.testConnection('int-1');
      expect(result).toEqual({ success: false, message: 'Unsupported provider: bitbucket' });
    });

    it('handles adapter failure gracefully', async () => {
      mockRepo.findRawById.mockResolvedValueOnce(rawJiraRow);
      mockJira.testConnection.mockResolvedValueOnce({ success: false, message: 'Jira returned 401' });
      const result = await service.testConnection('int-1');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Jira returned 401');
    });

    it('parses JSON string config from raw row', async () => {
      mockRepo.findRawById.mockResolvedValueOnce(rawJiraRow);
      mockJira.testConnection.mockResolvedValueOnce({ success: true, message: 'OK' });
      await service.testConnection('int-1');
      // Config should have been parsed from JSON string — raw apiToken is 'secret'
      expect(mockJira.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ apiToken: 'secret' }),
      );
    });

    it('handles already-parsed config object', async () => {
      const rowWithObjectConfig = {
        ...rawJiraRow,
        config: { baseUrl: 'https://test.atlassian.net', email: 'a@b.com', apiToken: 'secret', projectKey: 'TEST' },
      };
      mockRepo.findRawById.mockResolvedValueOnce(rowWithObjectConfig);
      mockJira.testConnection.mockResolvedValueOnce({ success: true, message: 'OK' });
      await service.testConnection('int-1');
      expect(mockJira.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'https://test.atlassian.net' }),
      );
    });
  });

  // ========== sync ==========

  describe('sync', () => {
    describe('pull direction', () => {
      it('pulls from Jira successfully', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawJiraRow);
        mockJira.pullIssues.mockResolvedValueOnce({ items: [{}, {}], count: 2 });
        const result = await service.sync('int-1', 'pull');
        expect(mockRepo.createSyncLog).toHaveBeenCalledWith('int-1', 'pull');
        expect(mockJira.pullIssues).toHaveBeenCalled();
        expect(mockRepo.completeSyncTransaction).toHaveBeenCalledWith('log-1', 'int-1', 2);
        expect(result).toEqual({ status: 'success', itemsSynced: 2 });
      });

      it('pulls from GitHub successfully', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawGithubRow);
        mockGithub.pullIssues.mockResolvedValueOnce({ items: [{}], count: 1 });
        const result = await service.sync('int-2', 'pull');
        expect(mockGithub.pullIssues).toHaveBeenCalled();
        expect(result).toEqual({ status: 'success', itemsSynced: 1 });
      });

      it('pulls from Trello successfully', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawTrelloRow);
        mockTrello.pullCards.mockResolvedValueOnce({ items: [], count: 0 });
        const result = await service.sync('int-4', 'pull');
        expect(mockTrello.pullCards).toHaveBeenCalled();
        expect(result).toEqual({ status: 'success', itemsSynced: 0 });
      });

      it('fails when pulling from Slack', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawSlackRow);
        const result = await service.sync('int-3', 'pull');
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Slack integration does not support pull');
        expect(mockRepo.completeSyncLog).toHaveBeenCalledWith('log-1', 'failed', 0, 'Slack integration does not support pull');
      });

      it('fails for unsupported provider on pull', async () => {
        mockRepo.findRawById.mockResolvedValueOnce({ ...rawJiraRow, provider: 'unknown' });
        const result = await service.sync('int-1', 'pull');
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Unsupported provider: unknown');
      });
    });

    describe('push direction', () => {
      it('pushes to Jira successfully', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawJiraRow);
        mockJira.pushTasks.mockResolvedValueOnce({ count: 3 });
        const result = await service.sync('int-1', 'push');
        expect(mockRepo.createSyncLog).toHaveBeenCalledWith('int-1', 'push');
        expect(mockJira.pushTasks).toHaveBeenCalled();
        expect(result).toEqual({ status: 'success', itemsSynced: 3 });
      });

      it('pushes to GitHub successfully', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawGithubRow);
        mockGithub.pushTasks.mockResolvedValueOnce({ count: 5 });
        const result = await service.sync('int-2', 'push');
        expect(mockGithub.pushTasks).toHaveBeenCalled();
        expect(result).toEqual({ status: 'success', itemsSynced: 5 });
      });

      it('pushes to Trello successfully', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawTrelloRow);
        mockTrello.pushTasks.mockResolvedValueOnce({ count: 1 });
        const result = await service.sync('int-4', 'push');
        expect(mockTrello.pushTasks).toHaveBeenCalled();
        expect(result).toEqual({ status: 'success', itemsSynced: 1 });
      });

      it('fails when pushing to Slack', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawSlackRow);
        const result = await service.sync('int-3', 'push');
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Slack integration does not support push');
      });

      it('fails for unsupported provider on push', async () => {
        mockRepo.findRawById.mockResolvedValueOnce({ ...rawJiraRow, provider: 'mystery' });
        const result = await service.sync('int-1', 'push');
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Unsupported provider: mystery');
      });
    });

    describe('error handling', () => {
      it('throws when integration not found', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(null);
        await expect(service.sync('nonexistent', 'pull')).rejects.toThrow('Integration not found');
      });

      it('catches adapter errors and logs failure', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawJiraRow);
        mockJira.pullIssues.mockRejectedValueOnce(new Error('Network timeout'));
        const result = await service.sync('int-1', 'pull');
        expect(result).toEqual({ status: 'failed', itemsSynced: 0, errorMessage: 'Network timeout' });
        expect(mockRepo.completeSyncLog).toHaveBeenCalledWith('log-1', 'failed', 0, 'Network timeout');
      });

      it('handles error without message property', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawGithubRow);
        mockGithub.pullIssues.mockRejectedValueOnce({ code: 'ERR' });
        const result = await service.sync('int-2', 'pull');
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Sync failed');
      });

      it('creates sync log before attempting adapter call', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawJiraRow);
        mockJira.pullIssues.mockRejectedValueOnce(new Error('fail'));
        await service.sync('int-1', 'pull');
        // createSyncLog should be called before the adapter
        expect(mockRepo.createSyncLog).toHaveBeenCalledTimes(1);
      });

      it('does not call completeSyncTransaction on failure', async () => {
        mockRepo.findRawById.mockResolvedValueOnce(rawJiraRow);
        mockJira.pullIssues.mockRejectedValueOnce(new Error('fail'));
        await service.sync('int-1', 'pull');
        expect(mockRepo.completeSyncTransaction).not.toHaveBeenCalled();
        expect(mockRepo.completeSyncLog).toHaveBeenCalled();
      });
    });
  });

  // ========== getSyncLog ==========

  describe('getSyncLog', () => {
    it('returns sync logs for integration', async () => {
      const logs = [
        { id: 'sl-1', integrationId: 'int-1', direction: 'pull', status: 'success', itemsSynced: 5, errorMessage: null, startedAt: '2026-01-01', completedAt: '2026-01-01' },
        { id: 'sl-2', integrationId: 'int-1', direction: 'push', status: 'failed', itemsSynced: 0, errorMessage: 'Timeout', startedAt: '2026-01-02', completedAt: '2026-01-02' },
      ];
      mockRepo.findSyncLog.mockResolvedValueOnce(logs);
      const result = await service.getSyncLog('int-1');
      expect(mockRepo.findSyncLog).toHaveBeenCalledWith('int-1');
      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('success');
      expect(result[1].errorMessage).toBe('Timeout');
    });

    it('returns empty array when no logs exist', async () => {
      mockRepo.findSyncLog.mockResolvedValueOnce([]);
      const result = await service.getSyncLog('int-no-logs');
      expect(result).toEqual([]);
    });
  });
});
