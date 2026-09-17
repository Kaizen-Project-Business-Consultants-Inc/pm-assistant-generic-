import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  scheduleFixProposerService,
  ScheduleFixNotFoundError,
  ScheduleFixStateError,
} from '../../services/ScheduleFixProposerService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import logger from '../../utils/logger';

const applySchema = z.object({ fixIds: z.array(z.string()).min(1).max(200) });
const rejectSchema = z.object({ feedback: z.string().max(2000).optional() });

/** Map AI infra errors to their conventional status codes. */
function handleAiError(error: any, reply: FastifyReply): FastifyReply | null {
  if (error?.constructor?.name === 'AIBudgetExceededError') {
    return reply.status(429).send({ error: 'AI token budget exceeded. Rules-based fixes are still available.' });
  }
  if (error?.constructor?.name === 'AICircuitBreakerError') {
    return reply.status(503).send({ error: 'AI service temporarily unavailable. Please try again in a moment.' });
  }
  return null;
}

/**
 * Schedule Review Phase 3 — structural fix proposals.
 * Mounted under /api/v1/schedules.
 */
export async function scheduleFixRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /:scheduleId/review/propose — generate a fix proposal (AI when budget allows, else rules)
  fastify.post('/:scheduleId/review/propose', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Propose structural schedule fixes', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      return await scheduleFixProposerService.propose(scheduleId, request.user!.userId);
    } catch (error: any) {
      if (error instanceof ScheduleFixNotFoundError) return reply.status(404).send({ error: 'Schedule not found' });
      const handled = handleAiError(error, reply);
      if (handled) return handled;
      logger.error('Schedule fix propose error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to propose fixes' });
    }
  });

  // GET /:scheduleId/review/proposal — latest proposal (204 when none)
  fastify.get('/:scheduleId/review/proposal', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Latest schedule fix proposal', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const latest = await scheduleFixProposerService.getLatest(scheduleId);
      if (!latest) return reply.status(204).send();
      return latest;
    } catch (error) {
      logger.error('Schedule fix latest error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to load proposal' });
    }
  });

  // POST /:scheduleId/review/proposals/:proposalId/apply
  fastify.post('/:scheduleId/review/proposals/:proposalId/apply', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Apply selected schedule fixes', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, proposalId } = request.params as { scheduleId: string; proposalId: string };
      const { fixIds } = applySchema.parse(request.body);
      return await scheduleFixProposerService.apply(scheduleId, proposalId, fixIds, request.user!.userId);
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      if (error instanceof ScheduleFixNotFoundError) return reply.status(404).send({ error: 'Proposal not found' });
      if (error instanceof ScheduleFixStateError) return reply.status(409).send({ error: error.message });
      logger.error('Schedule fix apply error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to apply fixes' });
    }
  });

  // POST /:scheduleId/review/proposals/:proposalId/undo
  fastify.post('/:scheduleId/review/proposals/:proposalId/undo', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Undo an applied schedule fix proposal', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, proposalId } = request.params as { scheduleId: string; proposalId: string };
      return await scheduleFixProposerService.undo(scheduleId, proposalId, request.user!.userId);
    } catch (error: any) {
      if (error instanceof ScheduleFixNotFoundError) return reply.status(404).send({ error: 'Proposal not found' });
      if (error instanceof ScheduleFixStateError) return reply.status(409).send({ error: error.message });
      logger.error('Schedule fix undo error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to undo fixes' });
    }
  });

  // POST /:scheduleId/review/proposals/:proposalId/reject
  fastify.post('/:scheduleId/review/proposals/:proposalId/reject', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Reject a schedule fix proposal', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, proposalId } = request.params as { scheduleId: string; proposalId: string };
      const { feedback } = rejectSchema.parse(request.body ?? {});
      await scheduleFixProposerService.reject(scheduleId, proposalId, feedback, request.user!.userId);
      return { ok: true };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      if (error instanceof ScheduleFixNotFoundError) return reply.status(404).send({ error: 'Proposal not found' });
      if (error instanceof ScheduleFixStateError) return reply.status(409).send({ error: error.message });
      logger.error('Schedule fix reject error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to reject proposal' });
    }
  });
}
