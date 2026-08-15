import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { projectMemberService } from '../../services/ProjectMemberService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { notificationService } from '../../services/NotificationService';
import logger from '../../utils/logger';

const addMemberSchema = z.object({
  userId: z.string().optional(),
  userName: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['owner', 'manager', 'editor', 'viewer']),
});

const updateRoleSchema = z.object({
  role: z.enum(['owner', 'manager', 'editor', 'viewer']),
});

export async function projectMemberRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/projects/:projectId/members
  fastify.get('/:projectId/members', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get project members', tags: ['members'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const members = await projectMemberService.findByProjectId(projectId);
      return { members };
    } catch (error) {
      logger.error('Get members error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/projects/:projectId/members
  fastify.post('/:projectId/members', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Add a project member', tags: ['members'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const data = addMemberSchema.parse(request.body);

      // Resolve userId from email if not provided
      let userId = data.userId;
      let userName = data.userName;
      if (!userId) {
        const user = await projectMemberService.findUserByEmail(data.email);
        if (!user) {
          return reply.status(404).send({ error: 'User not found', message: `No registered user with email ${data.email}` });
        }
        userId = user.id;
        userName = user.fullName;
      }

      const member = await projectMemberService.addMember(projectId, {
        userId,
        userName,
        email: data.email,
        role: data.role,
      });

      // Notify the added user (fire-and-forget)
      if (userId && userId !== (request.user as any)?.userId) {
        notificationService.create({
          userId,
          type: 'member_added',
          severity: 'low',
          title: 'Added to project',
          message: `You have been added to a project as ${data.role}`,
          projectId,
          linkType: 'project',
          linkId: projectId,
        }).catch(err => logger.error('member_added notification error', { error: err }));
      }

      return reply.status(201).send({ member });
    } catch (error) {
      logger.error('Add member error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PUT /api/v1/projects/:projectId/members/:memberId
  fastify.put('/:projectId/members/:memberId', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Update member role', tags: ['members'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { memberId } = request.params as { memberId: string };
      const data = updateRoleSchema.parse(request.body);
      const member = await projectMemberService.updateRole(memberId, data.role);
      if (!member) return reply.status(404).send({ error: 'Member not found' });
      return { member };
    } catch (error) {
      logger.error('Update member error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /api/v1/projects/:projectId/members/:memberId
  fastify.delete('/:projectId/members/:memberId', {
    preHandler: [requireScope('write'), requireProjectAccess('owner')],
    schema: { description: 'Remove a project member', tags: ['members'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { memberId } = request.params as { memberId: string };
      const removed = await projectMemberService.removeMember(memberId);
      if (!removed) return reply.status(400).send({ error: 'Cannot remove member (may be last owner)' });
      return { message: 'Member removed' };
    } catch (error) {
      logger.error('Remove member error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
