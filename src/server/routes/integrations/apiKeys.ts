import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { apiKeyService } from '../../services/ApiKeyService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';
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

  // POST / — Create a new API key (stays gated for trial users)
  fastify.post('/', { preHandler: [requireScope('write'), requireFeature('api_keys')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = createApiKeySchema.parse(request.body ?? {});

      // Enforce: requested scopes cannot exceed user's own role scopes
      const ROLE_SCOPES: Record<string, string[]> = {
        admin: ['read', 'write', 'admin'],
        executive: ['read'],
        project_manager: ['read', 'write'],
        scrum_master: ['read', 'write'],
        team_member: ['read'],
        finance_officer: ['read'],
        risk_manager: ['read', 'write'],
        pmo: ['read', 'write'],
        ba: ['read', 'write'],
        qa: ['read', 'write'],
        tester: ['read'],
        devops: ['read', 'write'],
        claude_sme: ['read'],
        viewer: ['read'],
      };
      const userScopes = ROLE_SCOPES[user.role ?? ''] ?? ['read'];
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
  // Trial users get sample API key list with an upgrade prompt.
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      // Trial users get sample API keys
      if (user.role !== 'admin') {
        const fullUser = await userService.findById(user.userId);
        if (fullUser && fullUser.subscriptionTier === 'trial') {
          return { apiKeys: generateSampleApiKeys(), sample: true };
        }
      }

      const apiKeys = await apiKeyService.listKeys(user.userId);
      return { apiKeys };
    } catch (error) {
      logger.error('List API keys error', { error });
      return reply.status(500).send({ error: 'Failed to list API keys' });
    }
  });

  // DELETE /:id — Revoke an API key
  fastify.delete('/:id', { preHandler: [requireScope('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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

function generateSampleApiKeys() {
  return [
    {
      id: 'sample-key-1',
      name: 'CI/CD Pipeline Key',
      prefix: 'pmk_demo',
      scopes: ['read', 'write'],
      rateLimit: 1000,
      lastUsedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      id: 'sample-key-2',
      name: 'Dashboard Read-Only',
      prefix: 'pmk_demo',
      scopes: ['read'],
      rateLimit: 500,
      lastUsedAt: new Date(Date.now() - 24 * 3600000).toISOString(),
      expiresAt: null,
      createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    },
  ];
}
