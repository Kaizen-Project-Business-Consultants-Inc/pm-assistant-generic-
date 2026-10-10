import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { dreamingService, DREAMING_SWITCHED_OFF, DREAMING_OFF_MESSAGE } from '../../services/context/DreamingService';

import { platformAdminOnly } from '../../utils/platformAdmin';
import { clampPagination } from '../../schemas/paginationSchema';

/*
 * Mjuzi's internal memory is in the SHARED database and spans every company: the Kovarti platform
 * admin only. It used to be "admin or PMO", so any company's owner/PMO could list, approve or
 * reject shared proposals (2026-10-09 audit M12; dormant while dreaming is switched off).
 */

export async function dreamingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // Switched off: nothing here runs, lists or applies anything (see DreamingService)
  fastify.addHook('preHandler', async (_request, reply) => {
    if (DREAMING_SWITCHED_OFF) return reply.status(410).send({ error: 'switched_off', message: DREAMING_OFF_MESSAGE });
  });

  // GET /api/v1/dreaming/runs — list dreaming runs
  fastify.get('/runs', {
    preHandler: [requireScope('read'), platformAdminOnly],
    schema: { description: 'List dreaming batch runs', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { limit } = request.query as { limit?: string };
      // A limit that isn't a number falls back to the default instead of SQL `LIMIT NaN` (2026-10-07)
      const runs = await dreamingService.listRuns(clampPagination({ limit }, { defaultLimit: 20 }).limit);
      return { runs };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to list dreaming runs');
      return reply.status(500).send({ error: 'Failed to list dreaming runs' });
    }
  });

  // GET /api/v1/dreaming/proposals — list pending proposals
  fastify.get('/proposals', {
    preHandler: [requireScope('read'), platformAdminOnly],
    schema: { description: 'List dreaming proposals', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { status, limit } = request.query as { status?: string; limit?: string };
      const proposals = await dreamingService.listProposals(status, clampPagination({ limit }, { defaultLimit: 50 }).limit);
      return { proposals };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to list dreaming proposals');
      return reply.status(500).send({ error: 'Failed to list dreaming proposals' });
    }
  });

  // POST /api/v1/dreaming/proposals/:id/approve — approve a proposal
  fastify.post('/proposals/:id/approve', {
    preHandler: [requireScope('write'), platformAdminOnly],
    schema: { description: 'Approve a dreaming proposal', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = (request as any).user;

      const proposal = await dreamingService.approveProposal(id, user.userId);
      return { proposal };
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      fastify.log.error({ err }, 'Failed to approve proposal');
      return reply.status(500).send({ error: 'Failed to approve proposal' });
    }
  });

  // POST /api/v1/dreaming/proposals/:id/reject — reject a proposal
  fastify.post('/proposals/:id/reject', {
    preHandler: [requireScope('write'), platformAdminOnly],
    schema: { description: 'Reject a dreaming proposal', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = (request as any).user;

      const proposal = await dreamingService.rejectProposal(id, user.userId);
      return { proposal };
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      fastify.log.error({ err }, 'Failed to reject proposal');
      return reply.status(500).send({ error: 'Failed to reject proposal' });
    }
  });

  // POST /api/v1/dreaming/trigger — manually trigger a dreaming run (admin)
  fastify.post('/trigger', {
    preHandler: [requireScope('admin'), platformAdminOnly],
    schema: { description: 'Manually trigger a dreaming run', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const run = await dreamingService.triggerRun(user.userId);
      return reply.status(202).send({ run });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to trigger dreaming run');
      return reply.status(500).send({ error: 'Failed to trigger dreaming run' });
    }
  });
}
