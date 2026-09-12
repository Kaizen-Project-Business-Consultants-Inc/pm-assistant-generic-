import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { inviteService } from '../../services/InviteService';
import { rateLimiter } from '../../middleware/rateLimiter';
import logger from '../../utils/logger';

const createInviteSchema = z.object({
  email: z.string().email(),
  projectId: z.string().uuid().optional(),
  role: z.enum(['viewer', 'team_member', 'project_manager']).default('viewer'),
});

const tokenParamSchema = z.object({
  token: z.string().min(1).max(128).regex(/^[a-f0-9]+$/),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

export async function inviteRoutes(fastify: FastifyInstance) {
  // POST /api/v1/invites — create invite (auth required)
  fastify.post('/', {
    preHandler: [authMiddleware, requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 20 invites per minute per user
      const rl = await rateLimiter.checkAsync(`invite:create:${request.user!.userId}`, 20, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many invite requests. Please try again later.' });
      }

      const data = createInviteSchema.parse(request.body);
      const invite = await inviteService.createInvite(
        request.user!.userId,
        data.email,
        data.projectId,
        data.role,
      );
      return reply.status(201).send({ invite });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create invite';
      if (msg.includes('limit reached')) {
        return reply.status(403).send({ error: 'Viewer limit reached' });
      }
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', message: error.issues.map(e => e.message).join(', ') });
      }
      logger.error('Create invite error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/invites — list invites for user's org
  fastify.get('/', {
    preHandler: [authMiddleware, requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { organizationRepository } = await import('../../database/OrganizationRepository');
      const org = await organizationRepository.findByUserId(request.user!.userId);
      if (!org) {
        return reply.status(404).send({ error: 'No organization found' });
      }
      const invites = await inviteService.listInvites(org.id);
      return { invites };
    } catch (error) {
      logger.error('List invites error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/invites/:token/validate — public, for registration page
  fastify.get('/:token/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 10 token validations per minute per IP
      const ip = request.ip || 'unknown';
      const rl = await rateLimiter.checkAsync(`invite:validate:${ip}`, 10, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many requests. Please try again later.' });
      }

      const parsed = tokenParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid token format' });
      }

      const result = await inviteService.validateToken(parsed.data.token);
      return result;
    } catch (error) {
      logger.error('Validate invite error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/invites/accept — accept invite for existing user (auth required)
  fastify.post('/accept', {
    preHandler: [authMiddleware, requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = z.object({ token: z.string().min(1).max(128).regex(/^[a-f0-9]+$/) }).parse(request.body);
      const result = await inviteService.acceptInvite(body.token, request.user!.userId);
      return { success: true, organizationId: result.organizationId };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to accept invite';
      if (msg.includes('Invalid or expired')) {
        return reply.status(400).send({ error: msg });
      }
      logger.error('Accept invite error', { error });
      return reply.status(400).send({ error: msg });
    }
  });

  // POST /api/v1/invites/:id/resend — resend invite email with new token
  fastify.post('/:id/resend', {
    preHandler: [authMiddleware, requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rl = await rateLimiter.checkAsync(`invite:resend:${request.user!.userId}`, 20, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many resend requests. Please try again later.' });
      }

      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid invite ID format' });
      }

      await inviteService.resendInvite(parsed.data.id, request.user!.userId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to resend invite';
      if (msg.includes('Not authorized')) {
        return reply.status(403).send({ error: msg });
      }
      if (msg.includes('already been accepted') || msg.includes('been revoked')) {
        return reply.status(400).send({ error: msg });
      }
      logger.error('Resend invite error', { error });
      return reply.status(400).send({ error: msg });
    }
  });

  // DELETE /api/v1/invites/:id — revoke invite
  fastify.delete('/:id', {
    preHandler: [authMiddleware, requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid invite ID format' });
      }
      await inviteService.revokeInvite(parsed.data.id, request.user!.userId, request.user!.role);
      return { message: 'Invite revoked' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to revoke invite';
      if (msg.includes('Not authorized')) {
        return reply.status(403).send({ error: msg });
      }
      logger.error('Revoke invite error', { error });
      return reply.status(400).send({ error: msg });
    }
  });
}
