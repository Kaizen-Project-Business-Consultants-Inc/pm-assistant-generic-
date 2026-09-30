import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { dreamingService, DREAMING_SWITCHED_OFF, DREAMING_OFF_MESSAGE } from '../../services/context/DreamingService';

/** Mjuzi's internal memory spans every project: admin/PMO only (the app only shows it to admins) */
const adminOrPmo = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!['admin', 'pmo'].includes(request.user!.role)) {
    return reply.status(403).send({ error: 'Insufficient role', message: 'Only an admin or PMO can see this.' });
  }
};

export async function dreamingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // Switched off: nothing here runs, lists or applies anything (see DreamingService)
  fastify.addHook('preHandler', async (_request, reply) => {
    if (DREAMING_SWITCHED_OFF) return reply.status(410).send({ error: 'switched_off', message: DREAMING_OFF_MESSAGE });
  });

  // GET /api/v1/dreaming/runs — list dreaming runs
  fastify.get('/runs', {
    preHandler: [requireScope('read'), adminOrPmo],
    schema: { description: 'List dreaming batch runs', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { limit } = request.query as { limit?: string };
      const runs = await dreamingService.listRuns(limit ? parseInt(limit, 10) : undefined);
      return { runs };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to list dreaming runs');
      return reply.status(500).send({ error: 'Failed to list dreaming runs' });
    }
  });

  // GET /api/v1/dreaming/proposals — list pending proposals
  fastify.get('/proposals', {
    preHandler: [requireScope('read'), adminOrPmo],
    schema: { description: 'List dreaming proposals', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { status, limit } = request.query as { status?: string; limit?: string };
      const proposals = await dreamingService.listProposals(status, limit ? parseInt(limit, 10) : undefined);
      return { proposals };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to list dreaming proposals');
      return reply.status(500).send({ error: 'Failed to list dreaming proposals' });
    }
  });

  // POST /api/v1/dreaming/proposals/:id/approve — approve a proposal
  fastify.post('/proposals/:id/approve', {
    preHandler: [requireScope('write'), adminOrPmo],
    schema: { description: 'Approve a dreaming proposal', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = (request as any).user;

      const proposal = await dreamingService.approveProposal(id, user.id);
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
    preHandler: [requireScope('write'), adminOrPmo],
    schema: { description: 'Reject a dreaming proposal', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = (request as any).user;

      const proposal = await dreamingService.rejectProposal(id, user.id);
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
    preHandler: [requireScope('admin'), adminOrPmo],
    schema: { description: 'Manually trigger a dreaming run', tags: ['dreaming'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const run = await dreamingService.triggerRun(user.id);
      return reply.status(202).send({ run });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to trigger dreaming run');
      return reply.status(500).send({ error: 'Failed to trigger dreaming run' });
    }
  });
}
