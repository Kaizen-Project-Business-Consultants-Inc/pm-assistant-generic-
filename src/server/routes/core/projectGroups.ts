import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { projectGroupService } from '../../services/ProjectGroupService';

const createSchema = z.object({
  name: z.string().min(1).max(255),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).optional(),
});

export async function projectGroupRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list all groups
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const groups = await projectGroupService.getGroups();
    return { groups };
  });

  // POST / — create group
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const parsed = createSchema.parse(request.body);
    const group = await projectGroupService.createGroup(parsed, user.userId);
    return reply.status(201).send(group);
  });

  // PUT /reorder — reorder groups (must be before /:id routes)
  fastify.put('/reorder', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const { orderedIds } = request.body as { orderedIds: string[] };
    if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array');
    await projectGroupService.reorderGroups(orderedIds);
    return { ok: true };
  });

  // PUT /unassign — unassign project from group
  fastify.put('/unassign', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const { projectId } = request.body as { projectId: string };
    if (!projectId) throw new Error('projectId is required');
    await projectGroupService.unassignProject(projectId);
    return { ok: true };
  });

  // PUT /:id — update group
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.parse(request.body);
    const group = await projectGroupService.updateGroup(id, parsed);
    return group;
  });

  // DELETE /:id — delete group
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    await projectGroupService.deleteGroup(id);
    return { ok: true };
  });

  // PUT /:id/assign — assign project to group
  fastify.put('/:id/assign', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const { projectId } = request.body as { projectId: string };
    if (!projectId) throw new Error('projectId is required');
    await projectGroupService.assignProject(projectId, id);
    return { ok: true };
  });
}
