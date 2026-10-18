import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { changeHistoryService, NotLatestChangeError } from '../../services/ChangeHistoryService';
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
import { aiRefusalReply } from '../../services/AIBudgetService';
import { sendValidationError } from '../../utils/validationError';
import { heavyActionLimit } from '../../middleware/rateLimiter';
import { ScheduleReviewNotFoundError } from '../../services/ScheduleReviewService';

/** New names the PM typed for rename fixes, by fix id */
const namesSchema = z.record(
  z.string().max(300),
  z.string({ message: 'A new name must be text.' }).trim()
    .min(1, 'A new name cannot be empty. Type a name, or untick that rename.')
    .max(255, 'A new name can be at most 255 characters.'),
).refine(r => Object.keys(r).length <= 200, 'Rename up to 200 headings at a time.').optional();
const applySchema = z.object({
  fixIds: z.array(z.string(), { message: 'Choose the fixes to apply.' })
    .min(1, 'Choose at least one fix to apply.')
    .max(200, 'Choose up to 200 fixes at a time.'),
  names: namesSchema,
});
/** Ticking nothing is a fair question too (the box then says nothing moves) */
const previewSchema = z.object({
  fixIds: z.array(z.string().max(300), { message: 'Choose the fixes to preview.' })
    .max(200, 'Choose up to 200 fixes at a time.'),
  names: namesSchema,
});
const rejectSchema = z.object({ feedback: z.string().max(2000).optional() });

/** Map AI infra errors to their conventional status codes. */
function handleAiError(error: any, reply: FastifyReply): FastifyReply | null {
  const refusal = aiRefusalReply(error, 'AI token budget exceeded. Rules-based fixes are still available.');
  if (refusal) return reply.status(refusal.status).send(refusal.body);
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
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Propose structural schedule fixes', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const useAi = (request.query as { ai?: string })?.ai === 'true' || (request.query as { ai?: string })?.ai === '1';
      return await scheduleFixProposerService.propose(scheduleId, request.user!.userId, useAi);
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
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Apply selected schedule fixes', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, proposalId } = request.params as { scheduleId: string; proposalId: string };
      const { fixIds, names } = applySchema.parse(request.body);
      return await scheduleFixProposerService.apply(scheduleId, proposalId, fixIds, request.user!.userId, names);
    } catch (error: any) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error instanceof ScheduleFixNotFoundError) return reply.status(404).send({ error: 'Proposal not found' });
      if (error instanceof ScheduleFixStateError) return reply.status(409).send({ error: error.message });
      logger.error('Schedule fix apply error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to apply fixes' });
    }
  });

  // POST /:scheduleId/review/proposals/:proposalId/preview — the date and score effect of the
  // ticked fixes, worked out on a copy; nothing is saved. The panel asks as the PM ticks (debounced).
  fastify.post('/:scheduleId/review/proposals/:proposalId/preview', {
    preHandler: [requireScope('write'), requireProjectAccess('manager'), heavyActionLimit('schedule-fix-preview', 120)],
    schema: { description: 'Preview the date effect of selected schedule fixes (saves nothing)', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, proposalId } = request.params as { scheduleId: string; proposalId: string };
      const { fixIds, names } = previewSchema.parse(request.body);
      return await scheduleFixProposerService.preview(scheduleId, proposalId, fixIds, names);
    } catch (error: any) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error instanceof ScheduleFixNotFoundError) return reply.status(404).send({ error: 'Proposal not found' });
      if (error instanceof ScheduleReviewNotFoundError) return reply.status(404).send({ error: 'Schedule not found' });
      if (error instanceof ScheduleFixStateError) return reply.status(409).send({ error: error.message });
      logger.error('Schedule fix preview error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to work out the effect of these fixes' });
    }
  });

  // POST /:scheduleId/review/proposals/:proposalId/undo
  fastify.post('/:scheduleId/review/proposals/:proposalId/undo', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Undo an applied schedule fix proposal', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, proposalId } = request.params as { scheduleId: string; proposalId: string };
      // Same rule as Schedule History: only the newest change, while nothing has changed since
      await changeHistoryService.assertLatestByRef(scheduleId, 'review_fix', proposalId);
      const result = await scheduleFixProposerService.undo(scheduleId, proposalId, request.user!.userId);
      await changeHistoryService.markUndoneByRef('review_fix', proposalId); // keep History in step
      return result;
    } catch (error: any) {
      if (error instanceof NotLatestChangeError) return reply.status(409).send({ error: 'not_latest', message: error.message });
      if (error instanceof ScheduleFixNotFoundError) return reply.status(404).send({ error: 'Proposal not found' });
      if (error instanceof ScheduleFixStateError) return reply.status(409).send({ error: error.message });
      logger.error('Schedule fix undo error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to undo fixes' });
    }
  });

  // POST /:scheduleId/review/proposals/:proposalId/reject
  fastify.post('/:scheduleId/review/proposals/:proposalId/reject', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Reject a schedule fix proposal', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, proposalId } = request.params as { scheduleId: string; proposalId: string };
      const { feedback } = rejectSchema.parse(request.body ?? {});
      await scheduleFixProposerService.reject(scheduleId, proposalId, feedback, request.user!.userId);
      return { ok: true };
    } catch (error: any) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error instanceof ScheduleFixNotFoundError) return reply.status(404).send({ error: 'Proposal not found' });
      if (error instanceof ScheduleFixStateError) return reply.status(409).send({ error: error.message });
      logger.error('Schedule fix reject error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to reject proposal' });
    }
  });
}
