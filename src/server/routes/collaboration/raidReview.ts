import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import {
  raidReviewService, RaidReviewInputError, RaidUndoConflictError, RaidReviewNotFoundError,
} from '../../services/RaidReviewService';
import logger from '../../utils/logger';

const applySchema = z.object({
  fixes: z.array(z.object({
    id: z.string().max(100),
    kind: z.string().max(40),
    itemId: z.string().min(1).max(36),
    value: z.string().max(255).optional(),
    toType: z.string().max(20).optional(),
  })).min(1).max(500),
});


const settingsSchema = z.object({ disabledRules: z.array(z.string().max(10)).max(50) });

/**
 * RAID Review — deterministic quality check of a project's RAID log, proposed fixes,
 * one-step undo and per-project switch-off of checks. Mounted under /api/v1/projects.
 * Reading the review needs project access; running it, fixes and settings need the
 * project's Manager/Owner.
 */
export async function raidReviewRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const fail = (reply: FastifyReply, error: unknown, what: string) => {
    if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
    if (error instanceof RaidReviewInputError) return reply.status(400).send({ error: error.message, message: error.message });
    if (error instanceof RaidReviewNotFoundError) return reply.status(404).send({ error: error.message, message: error.message });
    if (error instanceof RaidUndoConflictError) return reply.status(409).send({ error: error.code, message: error.message });
    logger.error(`RAID review: ${what} failed`, { message: (error as Error)?.message, stack: (error as Error)?.stack });
    return reply.status(500).send({ error: 'Internal server error', message: `Failed to ${what}` });
  };

  // GET /:projectId/raid-review — latest stored review
  fastify.get('/:projectId/raid-review', {
    // PM-only (user decision 2026-09-29): the review is the project Manager/Owner's working
    // tool; team members, viewers and executives don't see it (admin/PMO pass as everywhere)
    preHandler: [requireScope('read'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      return { review: await raidReviewService.latest(projectId) };
    } catch (error) { return fail(reply, error, 'load the RAID review'); }
  });

  // POST /:projectId/raid-review/run — run the rules now
  fastify.post('/:projectId/raid-review/run', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      return { review: await raidReviewService.run(projectId, request.user!.userId) };
    } catch (error) { return fail(reply, error, 'run the RAID review'); }
  });

  // GET /:projectId/raid-review/fixes — proposed fixes and the people who can own items
  fastify.get('/:projectId/raid-review/fixes', {
    preHandler: [requireScope('read'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      return await raidReviewService.proposeFixes(projectId);
    } catch (error) { return fail(reply, error, 'propose RAID fixes'); }
  });

  // POST /:projectId/raid-review/fixes/apply — apply the ticked fixes as one undoable batch
  fastify.post('/:projectId/raid-review/fixes/apply', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { fixes } = applySchema.parse(request.body);
      return await raidReviewService.applyFixes(projectId, fixes, request.user!.userId);
    } catch (error) { return fail(reply, error, 'apply RAID fixes'); }
  });

  // POST /:projectId/raid-review/fixes/:batchId/undo — put the items back as they were
  fastify.post('/:projectId/raid-review/fixes/:batchId/undo', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, batchId } = request.params as { projectId: string; batchId: string };
      return await raidReviewService.undo(projectId, batchId, request.user!.userId);
    } catch (error) { return fail(reply, error, 'undo RAID fixes'); }
  });

  // PUT /:projectId/raid-review/settings — switch checks off for this project
  fastify.put('/:projectId/raid-review/settings', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { disabledRules } = settingsSchema.parse(request.body);
      return { disabledRules: await raidReviewService.setDisabledRules(projectId, disabledRules, request.user!.userId) };
    } catch (error) { return fail(reply, error, 'save RAID review settings'); }
  });
}
