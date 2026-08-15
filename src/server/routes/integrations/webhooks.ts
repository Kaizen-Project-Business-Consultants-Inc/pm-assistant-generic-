import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { webhookService } from '../../services/WebhookService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { parsePagination } from '../../schemas/paginationSchema';
import logger from '../../utils/logger';

const createWebhookSchema = z.object({
  url: z.string().url().max(2000),
  events: z.array(z.string().min(1)).min(1),
});

const updateWebhookSchema = z.object({
  url: z.string().url().max(2000).optional(),
  events: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
});

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // POST / — Register webhook
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { url, events } = createWebhookSchema.parse(request.body);

      const webhook = await webhookService.register(user.userId, url, events);
      return reply.status(201).send({ webhook });
    } catch (error) {
      logger.error('Register webhook error', { error });
      return reply.status(500).send({ error: 'Failed to register webhook' });
    }
  });

  // GET / — List webhooks
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const webhooks = await webhookService.list(user.userId);
      return { webhooks };
    } catch (error) {
      logger.error('List webhooks error', { error });
      return reply.status(500).send({ error: 'Failed to fetch webhooks' });
    }
  });

  // PUT /:id — Update webhook
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { id } = request.params as { id: string };
      const body = updateWebhookSchema.parse(request.body);

      const webhook = await webhookService.update(user.userId, id, body);
      if (!webhook) return reply.status(404).send({ error: 'Webhook not found' });

      return { webhook };
    } catch (error) {
      logger.error('Update webhook error', { error });
      return reply.status(500).send({ error: 'Failed to update webhook' });
    }
  });

  // DELETE /:id — Delete webhook
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { id } = request.params as { id: string };
      const deleted = await webhookService.delete(user.userId, id);
      if (!deleted) return reply.status(404).send({ error: 'Webhook not found' });

      return { message: 'Webhook deleted' };
    } catch (error) {
      logger.error('Delete webhook error', { error });
      return reply.status(500).send({ error: 'Failed to delete webhook' });
    }
  });

  // GET /:id/deliveries — Delivery log
  fastify.get('/:id/deliveries', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { id } = request.params as { id: string };
      // Verify webhook belongs to user
      const webhook = await webhookService.getById(user.userId, id);
      if (!webhook) return reply.status(404).send({ error: 'Webhook not found' });

      const { limit, offset } = parsePagination(request.query as Record<string, unknown>);
      const deliveries = await webhookService.getDeliveries(id, limit, offset);
      return deliveries;
    } catch (error) {
      logger.error('Get webhook deliveries error', { error });
      return reply.status(500).send({ error: 'Failed to fetch webhook deliveries' });
    }
  });

  // POST /:id/test — Send test ping
  fastify.post('/:id/test', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { id } = request.params as { id: string };
      const found = await webhookService.test(user.userId, id);
      if (!found) return reply.status(404).send({ error: 'Webhook not found' });

      return { message: 'Test webhook sent' };
    } catch (error) {
      logger.error('Test webhook error', { error });
      return reply.status(500).send({ error: 'Failed to send test webhook' });
    }
  });
}
