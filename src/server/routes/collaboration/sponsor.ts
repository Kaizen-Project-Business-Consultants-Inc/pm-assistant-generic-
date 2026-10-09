import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { organizationService } from '../../services/OrganizationService';
import { projectService } from '../../services/ProjectService';
import { riskService } from '../../services/RiskService';
import { sponsorService, SponsorError } from '../../services/SponsorService';
import { sendValidationError } from '../../utils/validationError';
import logger from '../../utils/logger';

/**
 * Project sponsor + RAID escalation (Oct 2026). Only the project's Manager/Owner sets the sponsor,
 * escalates an item (with a note) or answers "Not now" to the Critical prompt. Anyone who can see
 * the project sees who the sponsor is.
 */
const setSchema = z.object({
  userId: z.string().min(1).nullable().optional(),
  resourceId: z.string().min(1).nullable().optional(),
}).refine(b => !(b.userId && b.resourceId), { message: 'Pick one sponsor.' });
const escalateSchema = z.object({
  note: z.string().trim().min(1, 'Write a short note for the sponsor: what you need from them.').max(2000),
});

async function sampleReadOnly(projectId: string, reply: FastifyReply): Promise<boolean> {
  const p = await projectService.findById(projectId);
  if (p?.isDemo) {
    reply.status(403).send({ error: 'Read-only', message: 'This is a sample project and cannot be modified.' });
    return true;
  }
  return false;
}

function fail(reply: FastifyReply, error: unknown, what: string) {
  if (error instanceof z.ZodError) return sendValidationError(reply, error);
  if (error instanceof SponsorError) return reply.status(error.status).send({ error: 'Bad request', message: error.message });
  logger.error(`${what} failed`, { message: (error as Error)?.message });
  return reply.status(500).send({ error: 'Internal server error', message: `${what} failed. Nothing was changed — please try again.` });
}

export async function sponsorRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/:projectId/sponsor', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    return { sponsor: await sponsorService.get(projectId) };
  });

  fastify.get('/:projectId/sponsor/candidates', { preHandler: [requireScope('read'), requireProjectAccess('manager')] }, async (request) => {
    const org = await organizationService.findByUserId(request.user!.userId).catch(() => null);
    return { candidates: await sponsorService.candidates(org?.id ?? null) };
  });

  fastify.put('/:projectId/sponsor', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      if (await sampleReadOnly(projectId, reply)) return reply;
      const body = setSchema.parse(request.body ?? {});
      const org = await organizationService.findByUserId(request.user!.userId).catch(() => null);
      return { sponsor: await sponsorService.set(projectId, body, org?.id ?? null) };
    } catch (error) { return fail(reply, error, 'Saving the sponsor'); }
  });

  fastify.post('/:projectId/risks/:riskId/escalate', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      if (await sampleReadOnly(projectId, reply)) return reply;
      const { note } = escalateSchema.parse(request.body ?? {});
      const item = await riskService.findById(riskId);
      if (!item || item.projectId !== projectId) return reply.status(404).send({ error: 'RAID item not found' });
      const project = await projectService.findById(projectId);
      const updated = await sponsorService.escalate(projectId, item, note, request.user!.userId, project?.name ?? '');
      return { data: updated };
    } catch (error) { return fail(reply, error, 'Escalating to the sponsor'); }
  });

  fastify.post('/:projectId/risks/:riskId/escalation-prompt/dismiss', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request, reply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const item = await riskService.findById(riskId);
      if (!item || item.projectId !== projectId) return reply.status(404).send({ error: 'RAID item not found' });
      return { data: await sponsorService.dismissPrompt(riskId) };
    } catch (error) { return fail(reply, error, 'Hiding the prompt'); }
  });
}
