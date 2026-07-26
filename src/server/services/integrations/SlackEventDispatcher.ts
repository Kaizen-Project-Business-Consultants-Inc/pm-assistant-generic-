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

      for (const row of rows) {
        const integrationConfig = parseConfig(row.config) as SlackConfig & { notifyEvents?: string[] };

        // Check event filter if configured
        if (integrationConfig.notifyEvents && integrationConfig.notifyEvents.length > 0) {
          if (!integrationConfig.notifyEvents.includes(event)) continue;
        }

        const message = slackAdapter.buildEventBlocks(event, payload);
        if (!message) continue;

        // Use bot token for messages with actions (proposals), webhook for everything else
        if (event === 'proposal.created' && config.SLACK_BOT_TOKEN && integrationConfig.channel) {
          slackAdapter.postWithBotToken(integrationConfig.channel, message.blocks || [], message.text).catch(err => {
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
