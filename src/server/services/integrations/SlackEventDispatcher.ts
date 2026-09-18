import { integrationRepository, parseConfig } from '../../database/IntegrationRepository';
import { slackAdapter, SlackConfig } from './SlackAdapter';
import { config } from '../../config';
import logger from '../../utils/logger';

class SlackEventDispatcher {
  async dispatchToSlack(event: string, payload: Record<string, any>, projectId?: string): Promise<void> {
    if (!projectId) return;

    try {
      const rows = await integrationRepository.findActiveSlackByProject(projectId);
      if (rows.length === 0) return;

      // Look the project name up once so messages can say which project they
      // came from — important when one channel watches several projects.
      let projectName: string | undefined;
      try {
        const { projectService } = await import('../ProjectService');
        projectName = (await projectService.findById(projectId))?.name;
      } catch { /* name is a nicety, never block the notification */ }
      const enrichedPayload = { ...payload, projectId, projectName };

      for (const row of rows) {
        const integrationConfig = parseConfig(row.config) as SlackConfig & { notifyEvents?: string[] };

        // Check event filter if configured
        if (integrationConfig.notifyEvents && integrationConfig.notifyEvents.length > 0) {
          if (!integrationConfig.notifyEvents.includes(event)) continue;
        }

        // Only this workspace's own OAuth token can post interactively.
        const workspaceBotToken = integrationConfig.botToken;
        const message = slackAdapter.buildEventBlocks(event, enrichedPayload, !!workspaceBotToken);
        if (!message) continue;

        // Use the workspace's bot token for messages with actions (proposals),
        // webhook for everything else.
        if (event === 'proposal.created' && workspaceBotToken && integrationConfig.channel) {
          slackAdapter.postWithBotToken(workspaceBotToken, integrationConfig.channel, message.blocks || [], message.text).catch(err => {
            logger.warn('SlackEventDispatcher: bot token post failed', { event, error: err.message });
          });
        } else {
          slackAdapter.sendNotification(integrationConfig, message).catch(err => {
            logger.warn('SlackEventDispatcher: notification failed', { event, error: err.message });
          });
        }
      }
    } catch (err: any) {
      logger.warn('SlackEventDispatcher: dispatch error', { event, projectId, error: err.message });
    }
  }
}

export const slackEventDispatcher = new SlackEventDispatcher();
