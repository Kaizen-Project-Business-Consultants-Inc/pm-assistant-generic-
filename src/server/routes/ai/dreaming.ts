import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { dreamingService } from '../../services/context/DreamingService';

export async function dreamingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/dreaming/runs — list dreaming runs
  fastify.get('/runs', {
    preHandler: [requireScope('read')],
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
    preHandler: [requireScope('read')],
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
    preHandler: [requireScope('write')],
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
    preHandler: [requireScope('write')],
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
    preHandler: [requireScope('admin')],
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
