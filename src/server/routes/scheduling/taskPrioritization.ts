import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess, projectsOfSchedules } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { taskPrioritizationService } from '../../services/TaskPrioritizationService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const applyBodySchema = z.object({
  taskId: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});

const applyAllBodySchema = z.object({
  changes: z.array(
    z.object({
      taskId: z.string(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']),
    }),
  ),
});

/** The URL names a project and a schedule — the schedule must be in that project, and the caller its PM */
const projectAndSchedule = requireProjectAccess('manager', {
  resolve: async (req) => {
    const { projectId, scheduleId } = req.params as { projectId: string; scheduleId: string };
    const projects = await projectsOfSchedules([scheduleId]);
    if (!projects || projects[0] !== projectId) return null; // mismatch → refused
    return projectId;
  },
});

export async function taskPrioritizationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:projectId/:scheduleId/prioritize — get AI-prioritized task list
  fastify.get('/:projectId/:scheduleId/prioritize', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get AI-prioritized task ranking for a schedule', tags: ['task-prioritization'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, scheduleId } = request.params as { projectId: string; scheduleId: string };
      const result = await taskPrioritizationService.prioritizeTasks(projectId, scheduleId);
      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          message: error.issues,
        });
      }
      logger.error('Task prioritization error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to prioritize tasks',
      });
    }
  });

  // POST /:projectId/:scheduleId/apply — apply a single priority change
  fastify.post('/:projectId/:scheduleId/apply', {
    preHandler: [requireScope('write'), projectAndSchedule],
    schema: { description: 'Apply a single AI-suggested priority change', tags: ['task-prioritization'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = applyBodySchema.parse(request.body);
      const applied = await taskPrioritizationService.applyPriorityChange(body.taskId, body.priority);
      if (!applied) {
        return reply.status(404).send({
          error: 'Task not found',
          message: 'The specified task does not exist',
        });
      }
      return { message: 'Priority updated successfully', taskId: body.taskId, priority: body.priority };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          message: error.issues,
        });
      }
      logger.error('Apply priority error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to apply priority change',
      });
    }
  });

  // POST /:projectId/:scheduleId/apply-all — apply all suggested priority changes
  fastify.post('/:projectId/:scheduleId/apply-all', {
    preHandler: [requireScope('write'), projectAndSchedule],
    schema: { description: 'Apply all AI-suggested priority changes', tags: ['task-prioritization'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = applyAllBodySchema.parse(request.body);
      const applied = await taskPrioritizationService.applyAllPriorityChanges(body.changes);
      return { message: `Applied ${applied} priority change(s) successfully`, applied };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          message: error.issues,
        });
      }
      logger.error('Apply all priorities error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to apply priority changes',
      });
    }
  });
}
