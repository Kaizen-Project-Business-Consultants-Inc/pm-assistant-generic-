import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireTier } from '../../middleware/requireTier';
import { storageConnectorService } from '../../services/StorageConnectorService';
import { storageConnectorRepository, toPublic } from '../../database/StorageConnectorRepository';
import { ALL_PROVIDERS, isProviderConfigured, getProviderLabel, type StorageProvider } from '../../services/integrations/storageAdapterRegistry';
import { config } from '../../config';
import logger from '../../utils/logger';

const VALID_CALLBACK_PROVIDERS = ['onedrive', 'google_drive', 'dropbox'];
const VALID_AUTH_PROVIDERS: StorageProvider[] = ['onedrive', 'sharepoint', 'google_drive', 'dropbox'];
const requireConnectorTier = requireTier('consultant_pro', 'sme', 'enterprise');

// OAuth callback — top-level route, no auth (called by provider redirect)
export async function storageConnectorCallbackRoutes(fastify: FastifyInstance) {
  // Generic callback: GET /storage-connectors/:provider/callback
  for (const provider of VALID_CALLBACK_PROVIDERS) {
    fastify.get(`/storage-connectors/${provider}/callback`, async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state, error } = request.query as { code?: string; state?: string; error?: string };

      if (error) {
        logger.warn('Storage OAuth denied', { provider, error });
        return reply.redirect(`${config.APP_URL}/oauth/callback?error=${encodeURIComponent(error)}`);
      }

      if (!code || !state) {
        return reply.redirect(`${config.APP_URL}/oauth/callback?error=missing_params`);
      }

      try {
        const connector = await storageConnectorService.handleOAuthCallback(state, code);
        return reply.redirect(`${config.APP_URL}/oauth/callback?success=true&connectorId=${connector.id}&provider=${connector.provider}`);
      } catch (err: any) {
        logger.error('Storage OAuth callback failed', { provider, error: err.message });
        return reply.redirect(`${config.APP_URL}/oauth/callback?error=${encodeURIComponent(err.message)}`);
      }
    });
  }
}

// Project-scoped routes — require auth
export async function storageConnectorRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:projectId/storage-connectors/providers — list available providers
  fastify.get('/:projectId/storage-connectors/providers', { preHandler: [requireScope('read')] }, async () => {
    const providers = ALL_PROVIDERS.map(p => ({
      id: p,
      label: getProviderLabel(p),
      configured: isProviderConfigured(p),
    }));
    return { providers };
  });

  // GET /:projectId/storage-connectors — list connectors for project
  fastify.get('/:projectId/storage-connectors', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const connectors = await storageConnectorRepository.findByProject(projectId);
    return { connectors };
  });

  // POST /:projectId/storage-connectors/:provider/auth — initiate OAuth flow (tier-gated)
  fastify.post('/:projectId/storage-connectors/:provider/auth', {
    preHandler: [requireScope('write'), requireConnectorTier],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { projectId, provider } = request.params as { projectId: string; provider: string };

    if (!VALID_AUTH_PROVIDERS.includes(provider as StorageProvider)) {
      return reply.status(400).send({ error: `Invalid storage provider: ${provider}` });
    }

    if (!isProviderConfigured(provider as StorageProvider)) {
      return reply.status(501).send({ error: `${getProviderLabel(provider as StorageProvider)} integration is not configured` });
    }

    const body = (request.body || {}) as Record<string, string>;
    const extra = Object.keys(body).length > 0 ? body : undefined;
    const result = await storageConnectorService.initiateOAuthFlow(projectId, user.userId, provider as StorageProvider, extra);
    return result;
  });

  // GET /:projectId/storage-connectors/:id — get connector details
  fastify.get('/:projectId/storage-connectors/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { projectId: string; id: string };
    // Exclude 'providers' — it's handled above
    if (id === 'providers') return;
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
