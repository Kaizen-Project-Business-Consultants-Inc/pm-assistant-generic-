import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { apiKeyService } from '../../services/ApiKeyService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { scopesForRole } from '../../constants/roleScopes';
import { requireFeature } from '../../middleware/requireTier';
import logger from '../../utils/logger';
import { sendValidationError } from '../../utils/validationError';

const createApiKeySchema = z.object({
  name: z.string({ message: 'Enter a name for the API key.' }).trim().min(1, 'Enter a name for the API key.').max(200, 'Keep the key name under 200 characters.'),
  scopes: z.array(z.enum(['read', 'write', 'admin'], { message: 'Scopes can only be read, write or admin.' })).default(['read', 'write']),
  rateLimit: z.number().int().positive().optional(),
  expiresAt: z.string().optional(),
});

export async function apiKeyRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  // POST / — Create a new API key (needs the api_keys feature)
  fastify.post('/', { preHandler: [requireScope('write'), requireFeature('api_keys')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = createApiKeySchema.parse(request.body ?? {});

      // Enforce: requested scopes cannot exceed user's own role scopes
      const userScopes: string[] = scopesForRole(user.role);
      const disallowed = body.scopes.filter(s => !userScopes.includes(s));
      if (disallowed.length > 0) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: `Your role (${user.role}) cannot create API keys with scopes: ${disallowed.join(', ')}`,
        });
      }

      const apiKey = await apiKeyService.createKey(
        user.userId,
        body.name,
        body.scopes,
        body.rateLimit,
        body.expiresAt,
      );

      return reply.status(201).send({ apiKey });
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      logger.error('Create API key error', { error });
      return reply.status(500).send({ error: 'Failed to create API key' });
    }
  });

  // GET / — List all API keys for the current user
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const apiKeys = await apiKeyService.listKeys(user.userId);
      return { apiKeys };
    } catch (error) {
      logger.error('List API keys error', { error });
      return reply.status(500).send({ error: 'Failed to list API keys' });
    }
  });

  // DELETE /:id — Revoke an API key
  // Anyone may revoke their OWN key (revokeKey only matches the caller's keys). It used to need
  // the 'admin' right, so customers couldn't revoke keys at all (found 2026-10-05).
  fastify.delete('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { id } = request.params as { id: string };
      await apiKeyService.revokeKey(user.userId, id);
      return { message: 'API key revoked' };
    } catch (error) {
      logger.error('Revoke API key error', { error });
      return reply.status(500).send({ error: 'Failed to revoke API key' });
    }
  });

  // GET /:id/usage — Get usage stats for an API key
  fastify.get('/:id/usage', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { id } = request.params as { id: string };
      const { since } = request.query as { since?: string };
      // Your own keys only (any key's usage log — pages called, addresses — was readable by id)
      const mine = await apiKeyService.listKeys(user.userId);
      if (!mine.some((k) => k.id === id) && user.role !== 'admin') {
        return reply.status(404).send({ error: 'Not found', message: 'API key not found' });
      }
      const usage = await apiKeyService.getUsageStats(id, since);
      return { usage };
    } catch (error) {
      logger.error('Get API key usage error', { error });
      return reply.status(500).send({ error: 'Failed to fetch API key usage' });
    }
  });
}
