import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { organizationService } from '../../services/OrganizationService';
import { projectService } from '../../services/ProjectService';
import { sampleProjectService, SAMPLE_PROJECT_ID } from '../../services/SampleProjectService';
import logger from '../../utils/logger';

/** The company owner, or an admin/PMO — the same people who set company holidays */
async function canManageSample(request: FastifyRequest): Promise<boolean> {
  const user = request.user!;
  if (user.isGuest) return false;
  if (['admin', 'pmo'].includes(user.role)) return true;
  const org = await organizationService.findByUserId(user.userId).catch(() => null);
  return !!org && org.ownerUserId === user.userId;
}

async function ownerOnly(request: FastifyRequest, reply: FastifyReply) {
  if (await canManageSample(request)) return;
  return reply.status(403).send({ error: 'Forbidden', message: 'Only the company owner or a PMO can load or remove the sample project.' });
}

/**
 * Settings → Sample project (Oct 2026): the read-only example project is optional. New companies
 * start without it; the owner/admin can load it to explore and remove it again.
 */
export async function sampleProjectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/api/v1/sample-project', { preHandler: [requireScope('read')] }, async (request) => ({
    loaded: await sampleProjectService.isLoaded(),
    canManage: await canManageSample(request),
  }));

  fastify.post('/api/v1/sample-project/remove', { preHandler: [requireScope('write'), ownerOnly] }, async (_request, reply) => {
    try {
      const { removed, keptPeople } = await sampleProjectService.remove();
      await projectService.invalidateCache(SAMPLE_PROJECT_ID).catch(() => {});
      return { loaded: false, removed, keptPeople };
    } catch (error) {
      logger.error('Remove sample project failed', { message: (error as Error)?.message, code: (error as any)?.code });
      return reply.status(500).send({ error: 'Internal server error', message: 'The sample project could not be removed. Nothing was changed — please try again.' });
    }
  });

  fastify.post('/api/v1/sample-project/load', { preHandler: [requireScope('write'), ownerOnly] }, async (_request, reply) => {
    try {
      await sampleProjectService.load();
      await projectService.invalidateCache(SAMPLE_PROJECT_ID).catch(() => {});
      return { loaded: true };
    } catch (error) {
      logger.error('Load sample project failed', { message: (error as Error)?.message, code: (error as any)?.code });
      return reply.status(500).send({ error: 'Internal server error', message: 'The sample project could not be loaded. Nothing was changed — please try again.' });
    }
  });
}
