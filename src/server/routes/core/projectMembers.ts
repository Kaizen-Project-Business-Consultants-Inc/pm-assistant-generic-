import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { projectMemberService } from '../../services/ProjectMemberService';
import { projectService } from '../../services/ProjectService';
import { emailService } from '../../services/EmailService';
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
      let isRegistered = true;

      if (!userId) {
        const user = await projectMemberService.findUserByEmail(data.email);
        if (user) {
          userId = user.id;
          userName = user.fullName;
        } else {
          // Unregistered user — check if already a pending member
          const existing = await projectMemberService.findByEmail(projectId, data.email);
          if (existing) {
            // Update role if re-invited
            await projectMemberService.updateRole(existing.id, data.role);
            return reply.status(200).send({ member: { ...existing, role: data.role } });
          }
          userId = `pending_${uuidv4()}`;
          isRegistered = false;
        }
      }

      const member = await projectMemberService.addMember(projectId, {
        userId,
        userName,
        email: data.email,
        role: data.role,
      });

      // Notify the added user (fire-and-forget, registered only)
      if (isRegistered && userId !== (request.user as any)?.userId) {
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

      // Send invitation email (fire-and-forget)
      const inviterName = (request.user as any)?.fullName || (request.user as any)?.email || 'A team member';
      projectService.findById(projectId).then(project => {
        const projectName = project?.name || 'a project';
        emailService.sendProjectInviteEmail(data.email, {
          projectName,
          projectId,
          inviterName,
          role: data.role,
          isRegistered,
        }).catch(err => logger.error('project invite email error', { error: err }));
      }).catch(err => logger.error('project lookup for invite email error', { error: err }));

      return reply.status(201).send({ member });
    } catch (error: any) {
      logger.error('Add member error', { error: error?.message || error, stack: error?.stack });
      return reply.status(500).send({ error: 'Internal server error', message: error?.message });
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
