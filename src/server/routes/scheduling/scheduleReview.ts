import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { scheduleReviewService, ScheduleReviewNotFoundError } from '../../services/ScheduleReviewService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { scheduleService } from '../../services/ScheduleService';
import { projectService } from '../../services/ProjectService';
import { organizationRepository } from '../../database/OrganizationRepository';
import { buildScheduleReviewDocx } from '../../utils/scheduleReviewDocxBuilder';
import logger from '../../utils/logger';

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

/**
 * Schedule Review — deterministic schedule quality check.
 * Mounted under /api/v1/schedules.
 */
export async function scheduleReviewRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /:scheduleId/review — run the rules, store a row, return the result
  fastify.post('/:scheduleId/review', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Run Schedule Review and store the result', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      return await scheduleReviewService.run(scheduleId, 'manual', request.user!.userId);
    } catch (error) {
      if (error instanceof ScheduleReviewNotFoundError) {
        return reply.status(404).send({ error: 'Schedule not found' });
      }
      logger.error('Schedule review error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to review schedule' });
    }
  });

  // GET /:scheduleId/review/latest — most recent stored run (204 when none)
  fastify.get('/:scheduleId/review/latest', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Latest Schedule Review result', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const latest = await scheduleReviewService.latest(scheduleId);
      if (!latest) return reply.status(204).send();
      return latest;
    } catch (error) {
      logger.error('Schedule review latest error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to load schedule review' });
    }
  });

  // GET /:scheduleId/review/export/docx — the review as a Word document
  //
  // This is the one artefact that leaves the product: attached to a proposal, or
  // sent to a sponsor arguing about a plan. The recipient never logs in, so the
  // document has to carry its own context — see scheduleReviewDocxBuilder.
  fastify.get('/:scheduleId/review/export/docx', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Schedule Review as a Word document', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const review = await scheduleReviewService.latest(scheduleId);
      if (!review) {
        return reply.status(404).send({
          error: 'No review yet',
          message: 'Run the schedule review first, then download it.',
        });
      }

      const schedule = await scheduleService.findById(scheduleId);
      const project = schedule ? await projectService.findById(schedule.projectId).catch(() => null) : null;
      // The consultancy's name, so the document reads as theirs.
      let preparedBy: string | null = null;
      try {
        preparedBy = (await organizationRepository.findByUserId(request.user!.userId))?.name ?? null;
      } catch { /* a missing name must not stop the download */ }

      const buf = await buildScheduleReviewDocx({
        projectName: project?.name || 'Project',
        scheduleName: schedule?.name ?? null,
        score: review.score,
        band: review.band,
        counts: review.counts,
        leafTaskCount: review.leafTaskCount,
        findings: review.findings,
        skippedRules: review.skippedRules,
        rulesVersion: review.rulesVersion,
        reviewedAt: review.createdAt,
        preparedBy,
      });

      const safeName = (project?.name || 'project')
        .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
      const filename = `schedule-review-${safeName}-${String(review.createdAt).slice(0, 10)}.docx`;
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buf);
    } catch (error: any) {
      logger.error('Schedule review export error', { message: error?.message, stack: error?.stack });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to build the document' });
    }
  });

  // GET /:scheduleId/review/history?limit=8 — score trend, newest first
  fastify.get('/:scheduleId/review/history', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Schedule Review score history', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const { limit } = historyQuerySchema.parse(request.query ?? {});
      return { runs: await scheduleReviewService.history(scheduleId, limit) };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Schedule review history error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to load schedule review history' });
    }
  });
}
