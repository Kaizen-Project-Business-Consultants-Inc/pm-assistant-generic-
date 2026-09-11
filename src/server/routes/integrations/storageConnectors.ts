import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { storageConnectorService } from '../../services/StorageConnectorService';
import { storageConnectorRepository, toPublic } from '../../database/StorageConnectorRepository';
import { config } from '../../config';
import logger from '../../utils/logger';

export async function storageConnectorRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:projectId/storage-connectors — list connectors for project
  fastify.get('/:projectId/storage-connectors', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const connectors = await storageConnectorRepository.findByProject(projectId);
    return { connectors };
  });

  // POST /:projectId/storage-connectors/onedrive/auth — initiate OAuth flow
  fastify.post('/:projectId/storage-connectors/onedrive/auth', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { projectId } = request.params as { projectId: string };

    if (!config.MICROSOFT_CLIENT_ID) {
      return reply.status(501).send({ error: 'OneDrive integration is not configured' });
    }

    const result = await storageConnectorService.initiateOAuthFlow(projectId, user.userId);
    return result;
  });

  // GET /:projectId/storage-connectors/onedrive/callback — OAuth callback
  fastify.get('/:projectId/storage-connectors/onedrive/callback', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };

    if (error) {
      logger.warn('OneDrive OAuth denied', { projectId, error });
      // Redirect to frontend with error
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=missing_params`);
    }

    try {
      const connector = await storageConnectorService.handleOAuthCallback(projectId, state, code);
      return reply.redirect(`${config.APP_URL}/oauth/callback?success=true&connectorId=${connector.id}&provider=onedrive`);
    } catch (err: any) {
      logger.error('OneDrive OAuth callback failed', { projectId, error: err.message });
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=${encodeURIComponent(err.message)}`);
    }
  });

  // GET /:projectId/storage-connectors/:id — get connector details
  fastify.get('/:projectId/storage-connectors/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { projectId: string; id: string };
    const connector = await storageConnectorRepository.findById(id);
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });
    return { connector: toPublic(connector) };
  });

  // GET /:projectId/storage-connectors/:id/browse — browse folders
  fastify.get('/:projectId/storage-connectors/:id/browse', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { projectId: string; id: string };
    const { folderId } = request.query as { folderId?: string };

    try {
      const items = await storageConnectorService.listFolder(id, folderId || undefined);
      return { items };
    } catch (err: any) {
      logger.error('Browse folder failed', { connectorId: id, error: err.message });
      return reply.status(500).send({ error: 'Failed to browse folders' });
    }
  });

  // PUT /:projectId/storage-connectors/:id/folders — set sync folders
  fastify.put('/:projectId/storage-connectors/:id/folders', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { projectId: string; id: string };
    const { folderIds } = request.body as { folderIds: string[] };

    if (!Array.isArray(folderIds)) {
      return reply.status(400).send({ error: 'folderIds must be an array' });
    }

    await storageConnectorService.updateSyncFolders(id, folderIds);
    return { success: true };
  });

  // POST /:projectId/storage-connectors/:id/sync — trigger manual sync
  fastify.post('/:projectId/storage-connectors/:id/sync', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { projectId: string; id: string };

    try {
      const result = await storageConnectorService.syncConnector(id);
      return result;
    } catch (err: any) {
      logger.error('Manual sync failed', { connectorId: id, error: err.message });
      return reply.status(500).send({ error: `Sync failed: ${err.message}` });
    }
  });

  // PUT /:projectId/storage-connectors/:id — update settings
  fastify.put('/:projectId/storage-connectors/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { projectId: string; id: string };
    const body = request.body as {
      displayName?: string;
      status?: 'active' | 'paused';
      syncIntervalMinutes?: number;
    };

    const connector = await storageConnectorRepository.findById(id);
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });

    await storageConnectorRepository.updateSettings(id, {
      displayName: body.displayName,
      status: body.status,
      syncIntervalMinutes: body.syncIntervalMinutes ? Math.max(15, Math.min(1440, body.syncIntervalMinutes)) : undefined,
    });

    const updated = await storageConnectorRepository.findById(id);
    return { connector: updated ? toPublic(updated) : null };
  });

  // DELETE /:projectId/storage-connectors/:id — disconnect
  fastify.delete('/:projectId/storage-connectors/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { projectId: string; id: string };

    const connector = await storageConnectorRepository.findById(id);
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });

    await storageConnectorService.disconnect(id);
    return { success: true };
  });
}
