import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { resourceLevelingService } from '../../services/ResourceLevelingService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const taskAdjustmentSchema = z.object({
  taskId: z.string().min(1),
  taskName: z.string().min(1),
  originalStart: z.string(),
  originalEnd: z.string(),
  newStart: z.string(),
  newEnd: z.string(),
  reason: z.string(),
});

const applyAdjustmentsSchema = z.object({
  adjustments: z.array(taskAdjustmentSchema).min(1),
});

export async function resourceLevelingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:scheduleId/histogram — resource histogram
  fastify.get('/:scheduleId/histogram', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const histogram = await resourceLevelingService.getResourceHistogram(scheduleId);
      return { histogram };
    } catch (error) {
      logger.error('Get resource histogram error', { error });
      return reply.status(500).send({ error: 'Failed to fetch resource histogram' });
    }
  });

  // POST /:scheduleId/level — level resources
  fastify.post('/:scheduleId/level', { preHandler: [requireScope('write'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const result = await resourceLevelingService.levelResources(scheduleId);
      return { result };
    } catch (error) {
      logger.error('Level resources error', { error });
      return reply.status(500).send({ error: 'Failed to level resources' });
    }
  });

  // POST /:scheduleId/apply — apply leveled dates
  fastify.post('/:scheduleId/apply', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const { adjustments } = applyAdjustmentsSchema.parse(request.body);
      const result = await resourceLevelingService.applyLeveledDates(scheduleId, adjustments);
      return { result };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Apply leveled dates error', { error });
      return reply.status(500).send({ error: 'Failed to apply leveled dates' });
    }
  });
}
