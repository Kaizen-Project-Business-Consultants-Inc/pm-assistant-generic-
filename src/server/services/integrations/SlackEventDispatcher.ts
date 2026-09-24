import { integrationRepository, parseConfig } from '../../database/IntegrationRepository';
import { slackAdapter, SlackConfig, canPostAsBot } from './SlackAdapter';
import { config } from '../../config';
import logger from '../../utils/logger';

class SlackEventDispatcher {
  async dispatchToSlack(event: string, payload: Record<string, any>, projectId?: string): Promise<void> {
    if (!projectId) return;

    try {
      const rows = await integrationRepository.findActiveByProviderAndProject('slack', projectId);
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

        // Approve/Reject buttons only work on messages posted as the bot, which
        // is also the only path that honours a channel the customer picked.
        const message = slackAdapter.buildEventBlocks(event, enrichedPayload, canPostAsBot(integrationConfig));
        if (!message) continue;

        slackAdapter.deliver(integrationConfig, message).then((result) => {
          if (result.success) {
            // Stamps the "Last message" line the customer sees on the
            // Integrations page, so a working connection doesn't read as idle.
            integrationRepository.updateLastSyncAt(row.id).catch(() => { /* cosmetic */ });
          } else {
            logger.warn('SlackEventDispatcher: delivery failed', { event, integrationId: row.id, reason: result.message });
          }
        }).catch(err => {
          logger.warn('SlackEventDispatcher: notification failed', { event, error: err.message });
        });
      }
    } catch (err: any) {
      logger.warn('SlackEventDispatcher: dispatch error', { event, projectId, error: err.message });
    }
  }
}

export const slackEventDispatcher = new SlackEventDispatcher();
