import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { weeklyReviewService, WeeklyReviewNotFoundError, DISMISS_REASONS } from '../../services/WeeklyReviewService';
import { today } from '../../utils/calendarDate';
import logger from '../../utils/logger';

const dismissSchema = z.object({
  itemKey: z.string().min(1).max(100),
  reason: z.enum(DISMISS_REASONS),
});

/**
 * Weekly PM review — every Friday (or when the PM asks) the project's plan, people, hours,
 * money and risks are checked and at most 5 decisions are listed. PM-only like the other
 * PM working tools (team members, viewers and executives don't see it). Mounted under
 * /api/v1/projects.
 */
export async function weeklyReviewRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const fail = (reply: FastifyReply, error: unknown, what: string) => {
    if (error instanceof z.ZodError) throw error;
    if (error instanceof WeeklyReviewNotFoundError) return reply.status(404).send({ error: error.message, message: error.message });
    logger.error(`Weekly review: ${what} failed`, { message: (error as Error)?.message, stack: (error as Error)?.stack });
    return reply.status(500).send({ error: 'Internal server error', message: `Failed to ${what}` });
  };

  // GET /weekly-reviews/mine — "This week's reviews" on the dashboard: only the projects
  // the caller manages (owner/manager member), filtered in the query
  fastify.get('/weekly-reviews/mine', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return { reviews: await weeklyReviewService.mine(request.user!.userId, today()) };
    } catch (error) { return fail(reply, error, 'load your weekly reviews'); }
  });

  // GET /:projectId/weekly-review — the latest review and what the PM did with it
  fastify.get('/:projectId/weekly-review', {
    preHandler: [requireScope('read'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      return { review: await weeklyReviewService.latest(projectId) };
    } catch (error) { return fail(reply, error, 'load the weekly review'); }
  });

  // POST /:projectId/weekly-review/run — "Run my weekly review" (any day)
  fastify.post('/:projectId/weekly-review/run', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      return { review: await weeklyReviewService.run(projectId, 'manual', request.user!.userId) };
    } catch (error) { return fail(reply, error, 'run the weekly review'); }
  });

  // POST /:projectId/weekly-review/:reviewId/dismiss — "Not useful? Tell Kovarti why"
  fastify.post('/:projectId/weekly-review/:reviewId/dismiss', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, reviewId } = request.params as { projectId: string; reviewId: string };
      const { itemKey, reason } = dismissSchema.parse(request.body);
      return { responses: await weeklyReviewService.dismiss(projectId, reviewId, itemKey, reason, request.user!.userId) };
    } catch (error) { return fail(reply, error, 'dismiss the item'); }
  });
}
