import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { projectLinkRepository } from '../../database/ProjectLinkRepository';

const createSchema = z.object({
  label: z.string().min(1).max(255),
  url: z.string().url().max(2048),
  icon: z.string().max(50).optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  url: z.string().url().max(2048).optional(),
  icon: z.string().max(50).nullable().optional(),
});

export async function projectLinkRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:projectId/links
  fastify.get('/:projectId/links', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const links = await projectLinkRepository.findByProject(projectId);
    return { links };
  });

  // POST /:projectId/links
  fastify.post('/:projectId/links', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createSchema.parse(request.body);
    const link = await projectLinkRepository.create({
      ...parsed,
      projectId,
      createdBy: request.user!.userId,
    });
    return reply.status(201).send(link);
  });

  // PUT /:projectId/links/reorder
  fastify.put('/:projectId/links/reorder', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const { orderedIds } = request.body as { orderedIds: string[] };
    if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array');
    await projectLinkRepository.reorder(projectId, orderedIds);
    return { ok: true };
  });

  // PUT /:projectId/links/:linkId
  fastify.put('/:projectId/links/:linkId', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, linkId } = request.params as { projectId: string; linkId: string };
    const parsed = updateSchema.parse(request.body);
    const link = await projectLinkRepository.update(linkId, projectId, parsed);
    if (!link) return reply.status(404).send({ error: 'Link not found' });
    return link;
  });

  // DELETE /:projectId/links/:linkId
  fastify.delete('/:projectId/links/:linkId', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, linkId } = request.params as { projectId: string; linkId: string };
    const deleted = await projectLinkRepository.remove(linkId, projectId);
    if (!deleted) return reply.status(404).send({ error: 'Link not found' });
    return { ok: true };
  });
}
