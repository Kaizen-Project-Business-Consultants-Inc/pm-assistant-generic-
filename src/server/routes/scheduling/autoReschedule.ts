import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { autoRescheduleService } from '../../services/AutoRescheduleService';
import { ProposedChangeSchema } from '../../schemas/autoRescheduleSchemas';
import { webhookService } from '../../services/WebhookService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';

const rejectBodySchema = z.object({
  feedback: z.string().optional(),
});

const modifyBodySchema = z.object({
  modifications: z.array(ProposedChangeSchema),
});

export async function autoRescheduleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:scheduleId/delays — detect delayed tasks
  // Trial users get sample delay data with an upgrade prompt.
  fastify.get('/:scheduleId/delays', {
    preHandler: [requireScope('read')],
    schema: { description: 'Detect delayed tasks in a schedule', tags: ['auto-reschedule'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Trial users get sample delays
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(request.user!.userId);
        if (user && user.subscriptionTier === 'trial') {
          return { delayedTasks: generateSampleDelays(), sample: true };
        }
      }

      const { scheduleId } = request.params as { scheduleId: string };
      const delayedTasks = await autoRescheduleService.detectDelays(scheduleId);
      return { delayedTasks };
    } catch (error) {
      logger.error('Detect delays error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to detect delays',
      });
    }
  });

  // GET /:scheduleId/proposals — list proposals for a schedule
  // Trial users get sample proposals with an upgrade prompt.
  fastify.get('/:scheduleId/proposals', {
    preHandler: [requireScope('read')],
    schema: { description: 'List reschedule proposals for a schedule', tags: ['auto-reschedule'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Trial users get sample proposals
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(request.user!.userId);
        if (user && user.subscriptionTier === 'trial') {
          return { proposals: generateSampleProposals(), sample: true };
        }
      }

      const { scheduleId } = request.params as { scheduleId: string };
      const proposals = await autoRescheduleService.getProposals(scheduleId);
      return { proposals };
    } catch (error) {
      logger.error('Get proposals error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to fetch proposals',
      });
    }
  });

  // POST /:scheduleId/propose — generate a reschedule proposal
  fastify.post('/:scheduleId/propose', {
    preHandler: [requireScope('write'), requireFeature('auto_reschedule')],
    schema: { description: 'Generate an AI-powered reschedule proposal', tags: ['auto-reschedule'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const user = request.user!;
      const userId = user.userId;
      const proposal = await autoRescheduleService.generateProposal(scheduleId, userId);
      webhookService.dispatch('proposal.created', { proposal }, userId);
      return { proposal };
    } catch (error: any) {
      logger.error('Generate proposal error: ' + (error?.message || error), { stack: error?.stack });
      return reply.status(500).send({
        error: 'Internal server error',
        message: error?.message || 'Failed to generate reschedule proposal',
      });
    }
  });

  // POST /proposals/:id/accept — accept a proposal and apply changes
  fastify.post('/proposals/:id/accept', {
    preHandler: [requireScope('write'), requireFeature('auto_reschedule')],
    schema: { description: 'Accept a reschedule proposal and apply changes', tags: ['auto-reschedule'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const accepted = await autoRescheduleService.acceptProposal(id);
      if (!accepted) {
        return reply.status(404).send({
          error: 'Proposal not found',
          message: 'Proposal does not exist or is not in pending status',
        });
      }
      const user = request.user!;
      webhookService.dispatch('proposal.accepted', { proposalId: id }, user.userId);
      return { message: 'Proposal accepted and changes applied successfully' };
    } catch (error) {
      logger.error('Accept proposal error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to accept proposal',
      });
    }
  });

  // POST /proposals/:id/reject — reject a proposal with optional feedback
  fastify.post('/proposals/:id/reject', {
    preHandler: [requireScope('write'), requireFeature('auto_reschedule')],
    schema: { description: 'Reject a reschedule proposal', tags: ['auto-reschedule'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = rejectBodySchema.parse(request.body ?? {});
      const rejected = await autoRescheduleService.rejectProposal(id, body.feedback);
      if (!rejected) {
        return reply.status(404).send({
          error: 'Proposal not found',
          message: 'Proposal does not exist or is not in pending status',
        });
      }
      return { message: 'Proposal rejected successfully' };
    } catch (error) {
      logger.error('Reject proposal error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to reject proposal',
      });
    }
  });

  // POST /proposals/:id/modify — modify a proposal with new changes
  fastify.post('/proposals/:id/modify', {
    preHandler: [requireScope('write'), requireFeature('auto_reschedule')],
    schema: { description: 'Modify a reschedule proposal with updated changes', tags: ['auto-reschedule'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = modifyBodySchema.parse(request.body);
      const modified = await autoRescheduleService.modifyProposal(id, body.modifications);
      if (!modified) {
        return reply.status(404).send({
          error: 'Proposal not found',
          message: 'Proposal does not exist or is not in pending status',
        });
      }
      return { message: 'Proposal modified successfully' };
    } catch (error) {
      logger.error('Modify proposal error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to modify proposal',
      });
    }
  });
}

function generateSampleDelays() {
  return [
    { taskId: 's1', taskName: 'API Integration', delayDays: 8, severity: 'critical' as const, reason: 'Third-party API documentation incomplete; team waiting on vendor response.', isCriticalPath: true },
    { taskId: 's2', taskName: 'Database Migration', delayDays: 5, severity: 'high' as const, reason: 'Data volume larger than estimated; migration scripts need optimization.', isCriticalPath: true },
    { taskId: 's3', taskName: 'UI Redesign', delayDays: 3, severity: 'medium' as const, reason: 'Design review required additional iteration with stakeholders.', isCriticalPath: false },
  ];
}

function generateSampleProposals() {
  const today = new Date();
  const addDays = (n: number) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  return [
    {
      id: 'sample-prop-1',
      status: 'pending',
      rationale: 'Shift downstream tasks to absorb API integration delay while maintaining critical path integrity.',
      changes: [
        { taskId: 's4', taskName: 'Integration Testing', currentStart: addDays(5), currentEnd: addDays(15), proposedStart: addDays(13), proposedEnd: addDays(23), reason: 'Delayed due to API integration dependency' },
        { taskId: 's5', taskName: 'User Acceptance Testing', currentStart: addDays(16), currentEnd: addDays(25), proposedStart: addDays(24), proposedEnd: addDays(33), reason: 'Cascading delay from integration testing' },
      ],
      estimatedImpact: { originalEndDate: addDays(25), proposedEndDate: addDays(33), daysChange: 8 },
      createdAt: new Date().toISOString(),
    },
  ];
}
