import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { portalService } from '../../services/PortalService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';
import { rateLimiter } from '../../middleware/rateLimiter';

const portalCommentSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  authorName: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
});

const createLinkSchema = z.object({
  permissions: z.any(),
  label: z.string().max(200).optional(),
  expiresAt: z.string().optional(),
});

const updateLinkSchema = z.object({
  permissions: z.any().optional(),
  label: z.string().max(200).optional(),
  expiresAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function portalRoutes(fastify: FastifyInstance) {
  // ── Public routes (token-based access) ──────────────────────────────

  // GET /view/:token — public portal view (no auth)
  fastify.get('/view/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = request.ip;
      const rl = await rateLimiter.checkAsync('portal-view:' + ip, 60, 60000);
      reply.header('X-RateLimit-Remaining', rl.remaining);
      reply.header('X-RateLimit-Reset', Math.ceil(rl.resetAt / 1000));
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many requests', retryAfterMs: rl.resetAt - Date.now() });
      }

      const { token } = request.params as { token: string };
      const link = await portalService.validateToken(token);
      if (!link) return reply.status(404).send({ error: 'Invalid or expired portal link' });

      const view = await portalService.getPortalView(token);
      return { view };
    } catch (error) {
      logger.error('Get portal view error', { error });
      return reply.status(500).send({ error: 'Failed to fetch portal view' });
    }
  });

  // POST /view/:token/comment — public comment submission (no auth)
  fastify.post('/view/:token/comment', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = request.ip;
      const rl = await rateLimiter.checkAsync('portal-comment:' + ip, 5, 60000);
      reply.header('X-RateLimit-Remaining', rl.remaining);
      reply.header('X-RateLimit-Reset', Math.ceil(rl.resetAt / 1000));
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many requests', retryAfterMs: rl.resetAt - Date.now() });
      }

      const { token } = request.params as { token: string };
      const link = await portalService.validateToken(token);
      if (!link) return reply.status(404).send({ error: 'Invalid or expired portal link' });

      if (!link.permissions.canComment) {
        return reply.status(403).send({ error: 'Comments are not enabled for this portal link' });
      }

      const { entityType, entityId, authorName, content } = portalCommentSchema.parse(request.body);
      const comment = await portalService.addComment(link.id, link.projectId, entityType, entityId, authorName, content);
      return { comment };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Add portal comment error', { error });
      return reply.status(500).send({ error: 'Failed to add comment' });
    }
  });

  // ── Authenticated management routes ─────────────────────────────────

  // POST /links/:projectId — create portal link
  fastify.post('/links/:projectId', {
    preHandler: [authMiddleware, requireScope('write'), requireFeature('portal'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { projectId } = request.params as { projectId: string };
      const { permissions, label, expiresAt } = createLinkSchema.parse(request.body);
      const link = await portalService.createLink(projectId, permissions, user.userId, label, expiresAt);
      return { link };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Create portal link error', { error });
      return reply.status(500).send({ error: 'Failed to create portal link' });
    }
  });

  // GET /links/:projectId — list portal links
  // Trial users get sample portal links with an upgrade prompt.
  fastify.get('/links/:projectId', {
    preHandler: [authMiddleware, requireScope('read'), async (request: FastifyRequest, reply: FastifyReply) => {
      // Trial users get sample data before project access check (project may not exist)
      if (request.user && request.user.role !== 'admin') {
        const u = await userService.findById(request.user.userId);
        if (u && u.subscriptionTier === 'trial') {
          const { projectId } = request.params as { projectId: string };
          return reply.send({ links: generateSamplePortalLinks(projectId), sample: true });
        }
      }
    }, requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const links = await portalService.getLinks(projectId);
      return { links };
    } catch (error) {
      logger.error('Get portal links error', { error });
      return reply.status(500).send({ error: 'Failed to fetch portal links' });
    }
  });

  // PUT /links/:id — update portal link
  fastify.put('/links/:id', {
    preHandler: [authMiddleware, requireScope('write'), requireFeature('portal')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await portalService.getLinkById(id);
      if (!existing) return reply.status(404).send({ error: 'Portal link not found' });

      // Ownership check: only creator or admin can update
      const user = request.user!;
      if (existing.createdBy !== user.userId && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Only the link creator or an admin can modify this portal link' });
      }

      const body = updateLinkSchema.parse(request.body);
      const link = await portalService.updateLink(id, body);
      return { link };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update portal link error', { error });
      return reply.status(500).send({ error: 'Failed to update portal link' });
    }
  });

  // DELETE /links/:id — delete portal link
  fastify.delete('/links/:id', {
    preHandler: [authMiddleware, requireScope('write'), requireFeature('portal')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await portalService.getLinkById(id);
      if (!existing) return reply.status(404).send({ error: 'Portal link not found' });

      // Ownership check: only creator or admin can delete
      const user = request.user!;
      if (existing.createdBy !== user.userId && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Only the link creator or an admin can delete this portal link' });
      }

      await portalService.deleteLink(id);
      return { message: 'Portal link deleted' };
    } catch (error) {
      logger.error('Delete portal link error', { error });
      return reply.status(500).send({ error: 'Failed to delete portal link' });
    }
  });

  // GET /comments/:projectId — get portal comments
  fastify.get('/comments/:projectId', {
    preHandler: [authMiddleware, requireScope('read'), requireFeature('portal'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const comments = await portalService.getComments(projectId);
      return { comments };
    } catch (error) {
      logger.error('Get portal comments error', { error });
      return reply.status(500).send({ error: 'Failed to fetch portal comments' });
    }
  });
}

function generateSamplePortalLinks(projectId: string) {
  return [
    {
      id: 'sample-link-1',
      projectId,
      label: 'Stakeholder Review Portal',
      token: 'sample-token-abc123',
      is_active: true,
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      permissions: { canViewGantt: true, canViewBudget: false, canComment: true, canViewReports: true },
      created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    },
    {
      id: 'sample-link-2',
      projectId,
      label: 'Executive Dashboard',
      token: 'sample-token-def456',
      is_active: true,
      expires_at: null,
      permissions: { canViewGantt: true, canViewBudget: true, canComment: false, canViewReports: true },
      created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    },
  ];
}
