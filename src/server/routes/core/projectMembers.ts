import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { projectMemberService, LastOwnerError } from '../../services/ProjectMemberService';
import { projectService } from '../../services/ProjectService';
import { emailService } from '../../services/EmailService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess, checkProjectRole } from '../../middleware/requireProjectAccess';
import { notificationService } from '../../services/NotificationService';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';

const ROLE_MESSAGE = 'Choose a role: Viewer, Manager or Owner. (Editor was removed.)';
const roleSchema = z.enum(['owner', 'manager', 'viewer'], { message: ROLE_MESSAGE }); // Editor removed Sep 2026

const addMemberSchema = z.object({
  userId: z.string().optional(),
  userName: z.string({ message: "Enter the person's name." }).trim().min(1, "Enter the person's name."),
  email: z.string({ message: 'Enter their email address.' }).email('Enter a valid email address, e.g. name@company.com.'),
  role: roleSchema,
});

/**
 * The message for a bad add/update-member request: the first thing actually wrong. It used
 * to always say "Choose a role", even when the role was fine and the name or email was missing.
 */
export function memberValidationMessage(err: z.ZodError): string {
  return err.issues[0]?.message || ROLE_MESSAGE;
}

const updateRoleSchema = z.object({
  role: roleSchema,
});

/** Owner is granted only by an Owner of the project, or an admin/PMO */
function canGrantOwner(request: FastifyRequest): boolean {
  return ['admin', 'pmo'].includes(request.user!.role) || request.projectMembership?.role === 'owner';
}
function refuseOwnerGrant(reply: FastifyReply) {
  return reply.status(403).send({ error: 'owner_only', message: "Only the project's Owner can make someone Owner or change an Owner's role." });
}

export async function projectMemberRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/projects/:projectId/members/me — the caller's role here, so the screen
  // shows edit controls from the PROJECT role (it used to use the organisation role).
  fastify.get('/:projectId/members/me', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: "The caller's role on this project", tags: ['members'] },
  }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const pm = await checkProjectRole(request, projectId, 'manager');
    const role = pm.ok ? (pm.membership?.role ?? 'manager') : (request.projectMembership?.role === 'editor' ? 'viewer' : request.projectMembership?.role ?? 'viewer');
    return { role, canEdit: pm.ok, canManageOwners: canGrantOwner(request) || (pm.ok && pm.membership?.role === 'owner') };
  });

  // GET /api/v1/projects/:projectId/members
  fastify.get('/:projectId/members', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
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
      if (data.role === 'owner' && !canGrantOwner(request)) return refuseOwnerGrant(reply);

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
      // request.user has no name/email — read the inviter's (it always said "A team member")
      const inviter = await userService.findById(request.user!.userId).catch(() => null);
      const inviterName = inviter?.fullName || inviter?.email || 'A team member';
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
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', message: memberValidationMessage(error) });
      }
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
      const { projectId, memberId } = request.params as { projectId: string; memberId: string };
      const data = updateRoleSchema.parse(request.body);
      const target = await projectMemberService.findMemberById(memberId);
      if (!target || target.projectId !== projectId) return reply.status(404).send({ error: 'Member not found' });
      // Making someone Owner, or changing an Owner, is for Owners (or admin/PMO) only
      if ((data.role === 'owner' || target.role === 'owner') && !canGrantOwner(request)) return refuseOwnerGrant(reply);
      const member = await projectMemberService.updateRole(memberId, data.role);
      if (!member) return reply.status(404).send({ error: 'Member not found' });
      return { member };
    } catch (error) {
      if (error instanceof LastOwnerError) return reply.status(409).send({ error: 'last_owner', message: error.message });
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', message: memberValidationMessage(error) });
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
      const { projectId, memberId } = request.params as { projectId: string; memberId: string };
      const target = await projectMemberService.findMemberById(memberId);
      if (!target || target.projectId !== projectId) return reply.status(404).send({ error: 'Member not found' });
      const removed = await projectMemberService.removeMember(memberId);
      if (!removed) return reply.status(400).send({ error: 'Cannot remove member (may be last owner)' });
      return { message: 'Member removed' };
    } catch (error) {
      logger.error('Remove member error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
