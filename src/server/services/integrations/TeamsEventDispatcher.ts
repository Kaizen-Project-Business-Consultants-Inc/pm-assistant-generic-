import { integrationRepository, parseConfig } from '../../database/IntegrationRepository';
import { teamsAdapter, TeamsConfig, canPostToTeams } from './TeamsAdapter';
import logger from '../../utils/logger';

class TeamsEventDispatcher {
  async dispatchToTeams(event: string, payload: Record<string, any>, projectId?: string): Promise<void> {
    if (!projectId) return;

    try {
      const rows = await integrationRepository.findActiveByProviderAndProject('msteams', projectId);
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
        const teamsConfig = parseConfig(row.config) as TeamsConfig & { notifyEvents?: string[] };

        if (!canPostToTeams(teamsConfig)) continue;

        // Check event filter if configured
        if (teamsConfig.notifyEvents && teamsConfig.notifyEvents.length > 0) {
          if (!teamsConfig.notifyEvents.includes(event)) continue;
        }

        const message = teamsAdapter.buildEventCards(event, enrichedPayload);
        if (!message) continue;

        teamsAdapter.deliver(row.id, teamsConfig, message).then((result) => {
          if (result.success) {
            // Stamps the "Last message" line the customer sees on the
            // Integrations page, so a working connection doesn't read as idle.
            integrationRepository.updateLastSyncAt(row.id).catch(() => { /* cosmetic */ });
          } else {
            logger.warn('TeamsEventDispatcher: delivery failed', { event, integrationId: row.id, reason: result.message });
          }
        }).catch(err => {
          logger.warn('TeamsEventDispatcher: notification failed', { event, error: err.message });
        });
      }
    } catch (err: any) {
      logger.warn('TeamsEventDispatcher: dispatch error', { event, projectId, error: err.message });
    }
  }
}

export const teamsEventDispatcher = new TeamsEventDispatcher();
