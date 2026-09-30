import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { projectGroupService } from '../../services/ProjectGroupService';
import { sendValidationError } from '../../utils/validationError';

const NAME_MESSAGE = 'Enter a name for the group.';
const COLOR_MESSAGE = 'Pick a colour as a hex code, e.g. #3B82F6.';

const createSchema = z.object({
  name: z.string({ message: NAME_MESSAGE }).trim().min(1, NAME_MESSAGE).max(255, 'Keep the group name under 255 characters.'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, COLOR_MESSAGE).optional(),
  icon: z.string().max(50, 'Keep the icon name under 50 characters.').optional(),
});

const updateSchema = z.object({
  name: z.string({ message: NAME_MESSAGE }).trim().min(1, NAME_MESSAGE).max(255, 'Keep the group name under 255 characters.').optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, COLOR_MESSAGE).optional(),
  icon: z.string().max(50, 'Keep the icon name under 50 characters.').optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string({ message: 'Each group in the new order must be a group id.' }), {
    message: 'Send the groups in their new order (orderedIds).',
  }),
});

const PROJECT_MESSAGE = 'Say which project (projectId).';
const projectSchema = z.object({
  projectId: z.string({ message: PROJECT_MESSAGE }).min(1, PROJECT_MESSAGE),
});

/**
 * Turn a caller mistake into a clear 4xx instead of a 500: a body that fails its schema
 * (400), a group that doesn't exist (404), a duplicate name (409). Anything else is a real
 * failure and goes to the global error handler.
 */
function handleGroupError(reply: FastifyReply, err: unknown) {
  if (err instanceof z.ZodError) return sendValidationError(reply, err);
  const message = err instanceof Error ? err.message : '';
  if (message === 'Group not found') {
    return reply.status(404).send({ error: 'Not found', message: 'That project group no longer exists.' });
  }
  if (message === 'A group with this name already exists') {
    return reply.status(409).send({ error: 'Conflict', message: 'A group with this name already exists — choose another name.' });
  }
  throw err;
}

export async function projectGroupRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list all groups
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const groups = await projectGroupService.getGroups();
    return { groups };
  });

  // POST / — create group
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const parsed = createSchema.parse(request.body ?? {});
      const group = await projectGroupService.createGroup(parsed, user.userId);
      return reply.status(201).send(group);
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // PUT /reorder — reorder groups (must be before /:id routes)
  fastify.put('/reorder', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orderedIds } = reorderSchema.parse(request.body ?? {});
      await projectGroupService.reorderGroups(orderedIds);
      return { ok: true };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // PUT /unassign — unassign project from group
  fastify.put('/unassign', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = projectSchema.parse(request.body ?? {});
      await projectGroupService.unassignProject(projectId);
      return { ok: true };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // PUT /:id — update group
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const parsed = updateSchema.parse(request.body ?? {});
      const group = await projectGroupService.updateGroup(id, parsed);
      return group;
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // DELETE /:id — delete group
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await projectGroupService.deleteGroup(id);
      return { ok: true };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // PUT /:id/assign — assign project to group
  fastify.put('/:id/assign', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { projectId } = projectSchema.parse(request.body ?? {});
      await projectGroupService.assignProject(projectId, id);
      return { ok: true };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });
}
