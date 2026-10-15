import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess, checkProjectRole } from '../../middleware/requireProjectAccess';
import { projectTeamService, TeamPoolError } from '../../services/ProjectTeamService';

/**
 * A project's team (U8): picked from its client's resource pool and My resources.
 * Anyone on the project sees the team; only its Manager/Owner changes it.
 */
const addSchema = z.object({
  resourceId: z.string().min(1).max(36),
  roleOnProject: z.string().trim().max(100).nullable().optional(),
});

function teamError(reply: FastifyReply, err: unknown) {
  if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', message: err.issues[0]?.message ?? 'Check the details and try again.' });
  if (err instanceof TeamPoolError) return reply.status(400).send({ error: 'team', message: err.message });
  throw err;
}

export async function projectTeamRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/:projectId/team-pool', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const pools = await projectTeamService.pools(projectId);
      // the pools to pick from are for whoever changes the team; everyone else sees the team only
      if ((await checkProjectRole(request, projectId, 'manager')).ok) return pools;
      return { ...pools, clientPool: [], mine: [] };
    } catch (err) { return teamError(reply, err); }
  });

  fastify.post('/:projectId/team', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const body = addSchema.parse(request.body);
      await projectTeamService.add(projectId, body.resourceId, body.roleOnProject ?? null, request.user!.userId);
      return reply.status(201).send(await projectTeamService.pools(projectId));
    } catch (err) { return teamError(reply, err); }
  });

  fastify.delete('/:projectId/team/:resourceId', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, resourceId } = request.params as { projectId: string; resourceId: string };
      await projectTeamService.remove(projectId, resourceId);
      return await projectTeamService.pools(projectId);
    } catch (err) { return teamError(reply, err); }
  });
}
