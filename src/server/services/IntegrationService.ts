import { integrationRepository, parseConfig } from '../database/IntegrationRepository';
import { jiraAdapter } from './integrations/JiraAdapter';
import { githubAdapter } from './integrations/GitHubAdapter';
import { slackAdapter } from './integrations/SlackAdapter';
import { trelloAdapter } from './integrations/TrelloAdapter';
import { teamsAdapter } from './integrations/TeamsAdapter';

export interface Integration {
  id: string;
  projectId: string | null;
  userId: string;
  provider: string;
  config: Record<string, any>;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationSyncLog {
  id: string;
  integrationId: string;
  direction: string;
  status: string;
  itemsSynced: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export class IntegrationService {
  async create(
    userId: string,
    provider: string,
    config: Record<string, any>,
    projectId?: string,
  ): Promise<Integration> {
    return integrationRepository.create(userId, provider, config, projectId);
  }

  async getByUser(userId: string): Promise<Integration[]> {
    return integrationRepository.findByUser(userId);
  }

  async getByProject(projectId: string): Promise<Integration[]> {
    return integrationRepository.findByProject(projectId);
  }

  async getById(id: string): Promise<Integration | null> {
    return integrationRepository.findById(id);
  }

  async update(id: string, data: { config?: Record<string, any>; isActive?: boolean; projectId?: string | null }): Promise<Integration> {
    return integrationRepository.updateIntegration(id, data);
  }

  async delete(id: string): Promise<void> {
    return integrationRepository.deleteIntegration(id);
  }

  async testConnection(id: string): Promise<{ success: boolean; message: string }> {
    const row = await integrationRepository.findRawById(id);
    if (!row) return { success: false, message: 'Integration not found' };

    const config = parseConfig(row.config);

    switch (row.provider) {
      case 'jira':
        return jiraAdapter.testConnection(config as any);
      case 'github':
        return githubAdapter.testConnection(config as any);
      case 'slack':
        return slackAdapter.testConnection(config as any);
      case 'msteams':
        return teamsAdapter.testConnection(id, config as any);
      case 'trello':
        return trelloAdapter.testConnection(config as any);
      default:
        return { success: false, message: `Unsupported provider: ${row.provider}` };
    }
  }

  async sync(
    id: string,
    direction: 'pull' | 'push',
  ): Promise<{ status: string; itemsSynced: number; errorMessage?: string }> {
    const row = await integrationRepository.findRawById(id);
    if (!row) throw new Error('Integration not found');

    const config = parseConfig(row.config);
    const logId = await integrationRepository.createSyncLog(id, direction);

    try {
      let itemsSynced = 0;

      if (direction === 'pull') {
        itemsSynced = await this.pullFromProvider(row.provider, config);
      } else {
        itemsSynced = await this.pushToProvider(row.provider, config);
      }

      await integrationRepository.completeSyncTransaction(logId, id, itemsSynced);

      return { status: 'success', itemsSynced };
    } catch (error: any) {
      const errorMessage = error.message || 'Sync failed';
      await integrationRepository.completeSyncLog(logId, 'failed', 0, errorMessage);
      return { status: 'failed', itemsSynced: 0, errorMessage };
    }
  }

  private async pullFromProvider(provider: string, config: Record<string, any>): Promise<number> {
    switch (provider) {
      case 'jira': {
        const result = await jiraAdapter.pullIssues(config as any);
        return result.count;
      }
      case 'github': {
        const result = await githubAdapter.pullIssues(config as any);
        return result.count;
      }
      case 'trello': {
        const result = await trelloAdapter.pullCards(config as any);
        return result.count;
      }
      case 'slack':
        throw new Error('Slack integration does not support pull');
      case 'msteams':
        throw new Error('Microsoft Teams integration does not support pull');
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private async pushToProvider(provider: string, config: Record<string, any>): Promise<number> {
    const tasks: any[] = [];

    switch (provider) {
      case 'jira': {
        const result = await jiraAdapter.pushTasks(config as any, tasks);
        return result.count;
      }
      case 'github': {
        const result = await githubAdapter.pushTasks(config as any, tasks);
        return result.count;
      }
      case 'trello': {
        const result = await trelloAdapter.pushTasks(config as any, tasks);
        return result.count;
      }
      case 'slack':
        throw new Error('Slack integration does not support push');
      case 'msteams':
        throw new Error('Microsoft Teams integration does not support push');
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async getSyncLog(integrationId: string): Promise<IntegrationSyncLog[]> {
    return integrationRepository.findSyncLog(integrationId);
  }
}

export const integrationService = new IntegrationService();
