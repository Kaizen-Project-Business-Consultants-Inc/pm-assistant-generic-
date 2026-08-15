import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { integrationService } from '../../services/IntegrationService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const createIntegrationSchema = z.object({
  provider: z.string().min(1),
  config: z.record(z.string(), z.any()),
  projectId: z.string().optional(),
});

const updateIntegrationSchema = z.object({
  config: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().optional(),
});

const syncIntegrationSchema = z.object({
  direction: z.enum(['push', 'pull']),
});

export async function integrationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST / — create integration
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { provider, config, projectId } = createIntegrationSchema.parse(request.body);
      const integration = await integrationService.create(user.userId, provider, config, projectId);
      return reply.status(201).send({ integration });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Create integration error', { error });
      return reply.status(500).send({ error: 'Failed to create integration' });
    }
  });

  // GET / — list integrations for user
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const integrations = await integrationService.getByUser(user.userId);
      return { integrations };
    } catch (error) {
      logger.error('Get integrations error', { error });
      return reply.status(500).send({ error: 'Failed to fetch integrations' });
    }
  });

  // GET /:id — get integration by id
  fastify.get('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const integration = await integrationService.getById(id);
      if (!integration) return reply.status(404).send({ error: 'Not found', message: 'Integration not found' });
      return { integration };
    } catch (error) {
      logger.error('Get integration error', { error });
      return reply.status(500).send({ error: 'Failed to fetch integration' });
    }
  });

  // PUT /:id — update integration
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await integrationService.getById(id);
      if (!existing) return reply.status(404).send({ error: 'Not found', message: 'Integration not found' });
      const body = updateIntegrationSchema.parse(request.body);
      const integration = await integrationService.update(id, body);
      return { integration };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update integration error', { error });
      return reply.status(500).send({ error: 'Failed to update integration' });
    }
  });

  // DELETE /:id — delete integration
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await integrationService.getById(id);
      if (!existing) return reply.status(404).send({ error: 'Not found', message: 'Integration not found' });
      await integrationService.delete(id);
      return { message: 'Integration deleted' };
    } catch (error) {
      logger.error('Delete integration error', { error });
      return reply.status(500).send({ error: 'Failed to delete integration' });
    }
  });

  // POST /:id/test — test connection
  fastify.post('/:id/test', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await integrationService.testConnection(id);
      return { result };
    } catch (error) {
      logger.error('Test connection error', { error });
      return reply.status(500).send({ error: 'Failed to test connection' });
    }
  });

  // POST /:id/sync — sync integration
  fastify.post('/:id/sync', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { direction } = syncIntegrationSchema.parse(request.body);
      const result = await integrationService.sync(id, direction);
      return { result };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Sync integration error', { error });
      return reply.status(500).send({ error: 'Failed to sync integration' });
    }
  });

  // GET /:id/log — get sync log
  fastify.get('/:id/log', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const log = await integrationService.getSyncLog(id);
      return { log };
    } catch (error) {
      logger.error('Get sync log error', { error });
      return reply.status(500).send({ error: 'Failed to fetch sync log' });
    }
  });
}
