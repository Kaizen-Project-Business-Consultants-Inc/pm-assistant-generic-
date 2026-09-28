import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readableProjectIds } from '../../utils/readableProjects';
import { requireProjectAccess, checkProjectRole } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { actionProposalService } from '../../services/agents/ActionProposalService';
import { actionExecutor } from '../../services/agents/ActionExecutor';

const approveSchema = z.object({
  comment: z.string().max(2000).optional(),
}).optional().default({});

const rejectSchema = z.object({
  reason: z.string().max(2000).optional(),
}).optional().default({});

const feedbackSchema = z.object({
  outcome: z.enum(['effective', 'partially_effective', 'ineffective', 'made_worse', 'rolled_back']),
  comment: z.string().max(2000).optional(),
});

/** An agent proposal changes its project: approve / reject / execute / roll back need its Manager/Owner */
const proposalProject = async (req: FastifyRequest) => (await actionProposalService.getById((req.params as { id: string }).id))?.projectId ?? null;
const proposalPMGate = requireProjectAccess('manager', { resolve: proposalProject });
const proposalMember = requireProjectAccess('viewer', { resolve: proposalProject });

export async function proposalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // List proposals
  fastify.get('/', {
    preHandler: [requireScope('read')],
    schema: { description: 'List agent proposals', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { projectId?: string; status?: string; agentId?: string; limit?: string; offset?: string };
      // Only proposals for projects the caller can open (it listed every project's)
      if (query.projectId) {
        const d = await checkProjectRole(request, query.projectId, 'viewer');
        if (!d.ok) return reply.status(d.status).send(d.body);
      }
      const result = await actionProposalService.list({
        projectId: query.projectId,
        projectIds: await readableProjectIds(request.user!),
        status: query.status as import('../../services/agents/ActionProposalService').ProposalStatus | undefined,
        agentId: query.agentId,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return result;
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to list proposals');
      return reply.status(500).send({ error: 'Failed to list proposals' });
    }
  });

  // Get proposal by ID
  fastify.get('/:id', {
    preHandler: [requireScope('read'), proposalMember],
    schema: { description: 'Get agent proposal by ID', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const proposal = await actionProposalService.getById(id);
      if (!proposal) {
        return reply.status(404).send({ error: 'Not found', message: 'Proposal not found' });
      }
      return { proposal };
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to get proposal');
      return reply.status(500).send({ error: 'Failed to get proposal' });
    }
  });

  // Approve proposal
  fastify.post('/:id/approve', {
    preHandler: [requireScope('write'), proposalPMGate],
    schema: { description: 'Approve an agent proposal', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = approveSchema.parse(request.body);
      const userId = request.user!.userId;

      const proposal = await actionProposalService.getById(id);
      if (!proposal) {
        return reply.status(404).send({ error: 'Not found', message: 'Proposal not found' });
      }
      if (proposal.status !== 'pending') {
        return reply.status(400).send({ error: 'Bad request', message: `Proposal is '${proposal.status}', cannot approve` });
      }

      const review = await actionProposalService.addReview(id, userId, 'approved', body?.comment);
      return { review, message: 'Proposal approved' };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      throw error;
    }
  });

  // Reject proposal
  fastify.post('/:id/reject', {
    preHandler: [requireScope('write'), proposalPMGate],
    schema: { description: 'Reject an agent proposal', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = rejectSchema.parse(request.body);
      const userId = request.user!.userId;

      const proposal = await actionProposalService.getById(id);
      if (!proposal) {
        return reply.status(404).send({ error: 'Not found', message: 'Proposal not found' });
      }
      if (proposal.status !== 'pending') {
        return reply.status(400).send({ error: 'Bad request', message: `Proposal is '${proposal.status}', cannot reject` });
      }

      const review = await actionProposalService.addReview(id, userId, 'rejected', body?.reason);
      return { review, message: 'Proposal rejected' };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      throw error;
    }
  });

  // Execute approved proposal
  fastify.post('/:id/execute', {
    preHandler: [requireScope('admin'), proposalPMGate],
    schema: { description: 'Execute an approved agent proposal', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const proposal = await actionProposalService.getById(id);
    if (!proposal) {
      return reply.status(404).send({ error: 'Not found', message: 'Proposal not found' });
    }
    if (proposal.status !== 'approved') {
      return reply.status(400).send({ error: 'Bad request', message: `Proposal is '${proposal.status}', must be approved to execute` });
    }

    const result = await actionExecutor.execute(id);
    return { result };
  });

  // Rollback executed proposal
  fastify.post('/:id/rollback', {
    preHandler: [requireScope('admin'), proposalPMGate],
    schema: { description: 'Rollback an executed agent proposal', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const result = await actionExecutor.rollbackProposal(id);
    return { result };
  });

  // Get proposal actions
  fastify.get('/:id/actions', {
    preHandler: [requireScope('read'), proposalMember],
    schema: { description: 'Get actions for an agent proposal', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const actions = await actionProposalService.getActions(id);
      return { actions };
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to get proposal actions');
      return reply.status(500).send({ error: 'Failed to get proposal actions' });
    }
  });

  // Submit feedback on executed proposal
  fastify.post('/:id/feedback', {
    preHandler: [requireScope('write'), proposalMember],
    schema: { description: 'Submit feedback on an executed agent proposal', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = feedbackSchema.parse(request.body);
      const userId = request.user!.userId;

      await actionProposalService.submitFeedback(id, userId, body.outcome, body.comment);
      return { message: 'Feedback submitted' };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      throw error;
    }
  });
}
