import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { requireScope } from '../middleware/requireScope';
import { goalService } from '../services/GoalService';
import logger from '../utils/logger';

const createGoalSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  ownerId: z.string().optional(),
  parentId: z.string().optional(),
  goalType: z.enum(['objective', 'key_result']),
  status: z.enum(['on_track', 'at_risk', 'behind', 'completed']).optional(),
  progress: z.number().min(0).max(100).optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().optional(),
  unit: z.string().max(50).optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  projectId: z.string().optional(),
});

const updateGoalSchema = createGoalSchema.partial();

export async function goalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list goals with optional filters
  fastify.get('/', {
    preHandler: [requireScope('read')],
    schema: { description: 'List goals', tags: ['goals'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ownerId, projectId, goalType, status } = request.query as {
        ownerId?: string;
        projectId?: string;
        goalType?: string;
        status?: string;
      };
      const goals = await goalService.list({ ownerId, projectId, goalType, status });
      return { goals };
    } catch (error) {
      logger.error('List goals error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to list goals' });
    }
  });

  // GET /:id — get single goal
  fastify.get('/:id', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get a goal by ID', tags: ['goals'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const goal = await goalService.findById(id);
      if (!goal) {
        return reply.status(404).send({ error: 'Not found', message: 'Goal not found' });
      }
      return { goal };
    } catch (error) {
      logger.error('Get goal error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch goal' });
    }
  });

  // POST / — create goal
  fastify.post('/', {
    preHandler: [requireScope('write')],
    schema: { description: 'Create a goal', tags: ['goals'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = createGoalSchema.parse(request.body);
      const userId = request.user?.userId as string;
      const goal = await goalService.create({
        ...body,
        ownerId: body.ownerId || userId,
      });

      // Auto-recalculate parent objective if creating a key_result
      if (goal.goalType === 'key_result' && goal.parentId) {
        await goalService.recalculateObjectiveProgress(goal.parentId);
      }

      return reply.status(201).send({ goal });
    } catch (error) {
      logger.error('Create goal error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to create goal' });
    }
  });

  // PUT /:id — update goal
  fastify.put('/:id', {
    preHandler: [requireScope('write')],
    schema: { description: 'Update a goal', tags: ['goals'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateGoalSchema.parse(request.body);

      const goal = await goalService.update(id, body);
      if (!goal) {
        return reply.status(404).send({ error: 'Not found', message: 'Goal not found' });
      }

      // Auto-recalculate parent objective if this is a key_result
      if (goal.goalType === 'key_result' && goal.parentId) {
        await goalService.recalculateObjectiveProgress(goal.parentId);
      }

      return { goal };
    } catch (error) {
      logger.error('Update goal error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to update goal' });
    }
  });

  // DELETE /:id — delete goal (admin only)
  fastify.delete('/:id', {
    preHandler: [requireScope('write')],
    schema: { description: 'Delete a goal', tags: ['goals'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      // Look up the goal before deleting to check for parent recalculation
      const existing = await goalService.findById(id);
      if (!existing) {
        return reply.status(404).send({ error: 'Not found', message: 'Goal not found' });
      }

      const deleted = await goalService.delete(id);
      if (!deleted) {
        return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete goal' });
      }

      // Auto-recalculate parent objective if deleted goal was a key_result
      if (existing.goalType === 'key_result' && existing.parentId) {
        await goalService.recalculateObjectiveProgress(existing.parentId);
      }

      return { success: true };
    } catch (error) {
      logger.error('Delete goal error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete goal' });
    }
  });
}
