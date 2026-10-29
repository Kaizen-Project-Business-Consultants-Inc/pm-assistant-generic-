import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope, keyChangesNeed } from '../../middleware/requireScope';
import { requireProjectAccess, checkProjectRole } from '../../middleware/requireProjectAccess';
import { projectCoverService, CoverError, isLineManagerOfOwner } from '../../services/ProjectCoverService';
import { projectMemberService } from '../../services/ProjectMemberService';
import { projectService } from '../../services/ProjectService';
import { userService } from '../../services/UserService';
import { canManageLogins, isCompanyLogin } from '../../services/peopleRights';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { notificationService } from '../../services/NotificationService';
import { getActorSource } from '../../middleware/requestContext';
import logger from '../../utils/logger';

/**
 * Temporary cover for a project's Owner (while they are on leave or sick) and handing the project to
 * a new Owner (2026-10-29). Who may start or end cover: the project's Owner, the company owner or a
 * PMO, or the Owner's line manager. Who may hand the project over: the Owner, the company owner or a
 * PMO. Someone covering for the Owner may do neither.
 */
async function ownerOf(request: FastifyRequest, projectId: string): Promise<boolean> {
  const d = await checkProjectRole(request, projectId, 'owner');
  return d.ok && !d.membership?.acting;
}

async function mayManage(request: FastifyRequest, projectId: string, allowLineManager: boolean): Promise<boolean> {
  if (request.user!.role === 'admin' || request.user!.isGuest) return false; // the platform admin never changes a company's data
  if (await ownerOf(request, projectId)) return true;
  if (await canManageLogins(request.user)) return true;
  return allowLineManager && (await isLineManagerOfOwner(projectId, request.user!.userId));
}

/** The gate for cover and hand-over changes (not a project role check alone: the line manager is not on the project) */
function coverGate(allowLineManager: boolean) {
  return async function coverGateCheck(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.params as { projectId: string };
    if (!(await projectService.findById(projectId))) return reply.status(404).send({ error: 'Not found', message: 'The requested resource was not found' });
    if (!(await mayManage(request, projectId, allowLineManager))) {
      // Someone who isn't on the project can't tell it exists
      if (!(await checkProjectRole(request, projectId, 'viewer')).ok) return reply.status(404).send({ error: 'Not found', message: 'The requested resource was not found' });
      return reply.status(403).send({
        error: 'cover_not_allowed',
        message: allowLineManager
          ? "Only the project's Owner, the company owner or the Owner's line manager can do this."
          : "Only the project's Owner or the company owner can do this.",
      });
    }
  };
}

const startSchema = z.object({
  coverUserId: z.string({ message: 'Choose who covers.' }).min(1, 'Choose who covers.'),
  startDate: z.string({ message: 'Choose a start date.' }),
  endDate: z.string({ message: 'Choose an end date.' }),
});
const reassignSchema = z.object({ userId: z.string({ message: 'Choose the new Owner.' }).min(1, 'Choose the new Owner.') });

export async function projectCoverRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/projects/:projectId/cover — the current or next cover, and whether the caller may start/end it
  fastify.get('/:projectId/cover', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'The current cover for the project Owner', tags: ['members'] },
  }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const cover = await projectCoverService.current(projectId);
    const canManage = await mayManage(request, projectId, true) && !request.apiKeyScopes;
    const canHandOver = canManage && (await mayManage(request, projectId, false));
    return {
      cover: cover ? {
        id: cover.id, coverUserId: cover.coverUserId, coverUserName: cover.coverUserName, startDate: cover.startDate,
        endDate: cover.endDate, active: cover.active, ownerUserId: cover.ownerUserId,
      } : null,
      canManage, canHandOver,
    };
  });

  // POST /api/v1/projects/:projectId/cover
  fastify.post('/:projectId/cover', {
    preHandler: [keyChangesNeed('write'), coverGate(true)],
    schema: { description: 'Start temporary cover for the project Owner', tags: ['members'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const body = startSchema.parse(request.body);
      // A line manager who is not on the project cannot give themselves edit rights
      if (body.coverUserId === request.user!.userId && !(await ownerOf(request, projectId)) && !(await canManageLogins(request.user))) {
        return reply.status(403).send({ error: 'cover_self', message: 'Choose someone else to cover. You cannot give yourself access.' });
      }
      const cover = await projectCoverService.start({ userId: request.user!.userId }, projectId, body);
      return reply.status(201).send({ cover });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', message: error.issues[0]?.message ?? 'Check the details.' });
      if (error instanceof CoverError) return reply.status(error.status).send({ error: error.code, message: error.message });
      logger.error('Start cover error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /api/v1/projects/:projectId/cover — end cover now
  fastify.delete('/:projectId/cover', {
    preHandler: [keyChangesNeed('write'), coverGate(true)],
    schema: { description: 'End the project cover now', tags: ['members'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const ended = await projectCoverService.end({ userId: request.user!.userId }, projectId);
      if (!ended) return reply.status(404).send({ error: 'no_cover', message: 'This project has no cover to end.' });
      return { message: 'Cover ended' };
    } catch (error) {
      logger.error('End cover error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/projects/:projectId/reassign-owner — the new person becomes the Owner, the old Owner a Manager
  fastify.post('/:projectId/reassign-owner', {
    preHandler: [keyChangesNeed('write'), coverGate(false)],
    schema: { description: 'Hand the project to a new Owner', tags: ['members'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { userId } = reassignSchema.parse(request.body);
      if (!(await isCompanyLogin(userId))) return reply.status(400).send({ error: 'not_in_company', message: 'Choose someone from your company.' });
      const person = await userService.findById(userId);
      if (!person || !person.isActive) return reply.status(400).send({ error: 'not_in_company', message: 'That person cannot sign in, so they cannot own a project.' });
      const { owner, previousOwners } = await projectMemberService.reassignOwner(projectId, { userId, userName: person.fullName || person.email, email: person.email });
      await auditLedgerService.append({
        actorId: request.user!.userId, actorType: 'user', action: 'project.owner_reassigned', entityType: 'project', entityId: projectId, projectId,
        payload: { newOwnerUserId: owner.userId, previousOwnerUserIds: previousOwners.map(o => o.userId) }, source: getActorSource(),
      }).catch(err => logger.error('owner_reassigned audit error', { error: err }));
      const project = await projectService.findById(projectId);
      const name = project?.name ?? 'a project';
      for (const userIdToTell of [owner.userId, ...previousOwners.map(o => o.userId)]) {
        if (userIdToTell === request.user!.userId) continue;
        const becameOwner = userIdToTell === owner.userId;
        void notificationService.create({
          userId: userIdToTell, type: 'project_cover', severity: 'medium', title: becameOwner ? `You are now the Owner of "${name}"` : `"${name}" has a new Owner`,
          message: becameOwner ? 'You are the one accountable PM for this project.' : 'You are now a Manager on this project.', projectId, linkType: 'project', linkId: projectId,
        }).catch(err => logger.error('owner_reassigned notification error', { error: err }));
      }
      return { owner, previousOwners };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', message: error.issues[0]?.message ?? 'Choose the new Owner.' });
      logger.error('Reassign owner error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
