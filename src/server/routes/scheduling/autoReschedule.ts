import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess, projectsOfSchedules } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { autoRescheduleService, StaleProposalError } from '../../services/AutoRescheduleService';
import { ProposedChangeSchema } from '../../schemas/autoRescheduleSchemas';
import { webhookService } from '../../services/WebhookService';
import { automationEventBus } from '../../services/automation/AutomationEventBus';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';
import { weekdaysOnly, onOrAfterWorking, shiftWorking, utcDay, ymdOf } from '../../utils/workingDays';

const rejectBodySchema = z.object({
  feedback: z.string().optional(),
});

const modifyBodySchema = z.object({
  modifications: z.array(ProposedChangeSchema),
});

/** Accepting / rejecting / changing a proposal is a change to its schedule — PM only */
const proposalPM = requireProjectAccess('manager', {
  resolve: async (req) => {
    const { id } = req.params as { id: string };
    const scheduleId = await autoRescheduleService.findProposalScheduleId(id);
    return scheduleId ? projectsOfSchedules([scheduleId]) : null;
  },
});

export async function autoRescheduleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:scheduleId/delays — detect delayed tasks
  // Trial users get sample delay data with an upgrade prompt.
  fastify.get('/:scheduleId/delays', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
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
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
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
    preHandler: [requireScope('write'), requireFeature('auto_reschedule'), requireProjectAccess('manager')],
    schema: { description: 'Generate an AI-powered reschedule proposal', tags: ['auto-reschedule'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const user = request.user!;
      const userId = user.userId;
      const proposal = await autoRescheduleService.generateProposal(scheduleId, userId);
      webhookService.dispatch('proposal.created', { proposal }, userId);
      automationEventBus.emit({ type: 'proposal.created', entityType: 'proposal', entityId: proposal.id, projectId: '', userId, payload: proposal as any, timestamp: new Date().toISOString() }).catch(() => {});
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
    preHandler: [requireScope('write'), requireFeature('auto_reschedule'), proposalPM],
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
      automationEventBus.emit({ type: 'proposal.accepted', entityType: 'proposal', entityId: id, projectId: '', userId: user.userId, payload: { proposalId: id }, timestamp: new Date().toISOString() }).catch(() => {});
      return { message: 'Proposal accepted and changes applied successfully' };
    } catch (error) {
      if (error instanceof StaleProposalError) {
        return reply.status(409).send({ error: 'Proposal out of date', message: error.message });
      }
      logger.error('Accept proposal error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to accept proposal',
      });
    }
  });

  // POST /proposals/:id/reject — reject a proposal with optional feedback
  fastify.post('/proposals/:id/reject', {
    preHandler: [requireScope('write'), requireFeature('auto_reschedule'), proposalPM],
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
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Reject proposal error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to reject proposal',
      });
    }
  });

  // POST /proposals/:id/modify — modify a proposal with new changes
  fastify.post('/proposals/:id/modify', {
    preHandler: [requireScope('write'), requireFeature('auto_reschedule'), proposalPM],
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
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
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
  // n working days (Mon–Fri) from today — the sample never lands on a weekend
  const addDays = (n: number) => ymdOf(shiftWorking(onOrAfterWorking(utcDay(today), weekdaysOnly), n, weekdaysOnly));
  return [
    {
      id: 'sample-prop-1',
      status: 'pending',
      rationale: 'Shift downstream tasks to absorb API integration delay while maintaining critical path integrity.',
      changes: [
        { taskId: 's4', taskName: 'Integration Testing', currentStart: addDays(4), currentEnd: addDays(11), proposedStart: addDays(12), proposedEnd: addDays(19), reason: 'Delayed due to API integration dependency' },
        { taskId: 's5', taskName: 'User Acceptance Testing', currentStart: addDays(12), currentEnd: addDays(18), proposedStart: addDays(20), proposedEnd: addDays(26), reason: 'Cascading delay from integration testing' },
      ],
      estimatedImpact: { originalEndDate: addDays(18), proposedEndDate: addDays(26), daysChange: 8 },
      createdAt: new Date().toISOString(),
    },
  ];
}
