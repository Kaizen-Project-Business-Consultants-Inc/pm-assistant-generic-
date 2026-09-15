import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { notificationService } from '../../services/NotificationService';
import { webPushService } from '../../services/WebPushService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { config } from '../../config';
import logger from '../../utils/logger';

export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list notifications for authenticated user
  fastify.get('/', {
    schema: { description: 'List notifications for the current user', tags: ['notifications'] },
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };
      const parsedLimit = parseInt(limit, 10);
      const parsedOffset = parseInt(offset, 10);
      const [notifications, total] = await Promise.all([
        notificationService.getByUserId(user.userId, parsedLimit, parsedOffset),
        notificationService.countByUserId(user.userId),
      ]);
      return { notifications, total, limit: parsedLimit, offset: parsedOffset };
    } catch (error) {
      logger.error('Get notifications error', { error });
      return reply.status(500).send({ error: 'Failed to fetch notifications' });
    }
  });

  // GET /unread-count — unread count
  fastify.get('/unread-count', {
    schema: { description: 'Get unread notification count', tags: ['notifications'] },
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const count = await notificationService.getUnreadCount(user.userId);
      return { count };
    } catch (error) {
      logger.error('Get unread count error', { error });
      return reply.status(500).send({ error: 'Failed to fetch unread count' });
    }
  });

  // POST /:id/read — mark one read
  fastify.post('/:id/read', {
    schema: { description: 'Mark a notification as read', tags: ['notifications'] },
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await notificationService.markRead(id);
      return { message: 'Notification marked as read' };
    } catch (error) {
      logger.error('Mark read error', { error });
      return reply.status(500).send({ error: 'Failed to mark notification as read' });
    }
  });

  // POST /mark-all-read — mark all read for user
  fastify.post('/mark-all-read', {
    schema: { description: 'Mark all notifications as read', tags: ['notifications'] },
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      await notificationService.markAllRead(user.userId);
      return { message: 'All notifications marked as read' };
    } catch (error) {
      logger.error('Mark all read error', { error });
      return reply.status(500).send({ error: 'Failed to mark all as read' });
    }
  });

  // GET /push/vapid-key — return public VAPID key
  fastify.get('/push/vapid-key', {
    schema: { description: 'Get VAPID public key for push notifications', tags: ['notifications'] },
    preHandler: [requireScope('read')],
  }, async () => {
    return { vapidPublicKey: config.VAPID_PUBLIC_KEY || null, configured: webPushService.isConfigured };
  });

  // POST /push/subscribe — store push subscription
  fastify.post('/push/subscribe', {
    schema: { description: 'Subscribe to push notifications', tags: ['notifications'] },
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = z.object({
        endpoint: z.string().min(1),
        keys: z.object({
          p256dh: z.string().min(1),
          auth: z.string().min(1),
        }),
      }).parse(request.body);

      await webPushService.subscribe(request.user!.userId, body, request.headers['user-agent']);
      return { message: 'Subscribed to push notifications' };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid subscription data', details: error.issues });
      }
      logger.error('Push subscribe error', { error });
      return reply.status(500).send({ error: 'Failed to subscribe' });
    }
  });

  // DELETE /push/subscribe — remove push subscription
  fastify.delete('/push/subscribe', {
    schema: { description: 'Unsubscribe from push notifications', tags: ['notifications'] },
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { endpoint } = z.object({ endpoint: z.string().min(1) }).parse(request.body);
      await webPushService.unsubscribe(request.user!.userId, endpoint);
      return { message: 'Unsubscribed from push notifications' };
    } catch (error) {
      logger.error('Push unsubscribe error', { error });
      return reply.status(500).send({ error: 'Failed to unsubscribe' });
    }
  });
}
