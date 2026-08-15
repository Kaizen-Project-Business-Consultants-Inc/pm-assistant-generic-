import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { timeEntryService } from '../../services/TimeEntryService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const createTimeEntrySchema = z.object({
  taskId: z.string().min(1),
  scheduleId: z.string().min(1),
  projectId: z.string().min(1),
  date: z.string().min(1),
  hours: z.number().positive().max(24),
  description: z.string().max(2000).optional(),
  billable: z.boolean().optional(),
});

const updateTimeEntrySchema = z.object({
  date: z.string().optional(),
  hours: z.number().positive().max(24).optional(),
  description: z.string().max(2000).optional(),
  billable: z.boolean().optional(),
});

export async function timeEntryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST / — log entry
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = createTimeEntrySchema.parse(request.body);
      const entry = await timeEntryService.create({ ...body, userId: user.userId });
      return { entry };
    } catch (error) {
      logger.error('Create time entry error', { error });
      return reply.status(500).send({ error: 'Failed to create time entry' });
    }
  });

  // GET /task/:taskId — entries for a task
  fastify.get('/task/:taskId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { taskId } = request.params as { taskId: string };
      const entries = await timeEntryService.getByTask(taskId);
      return { entries };
    } catch (error) {
      logger.error('Get task time entries error', { error });
      return reply.status(500).send({ error: 'Failed to fetch time entries' });
    }
  });

  // GET /project/:projectId — entries for a project
  fastify.get('/project/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
      const entries = await timeEntryService.getByProject(projectId, startDate, endDate);
      return { entries };
    } catch (error) {
      logger.error('Get project time entries error', { error });
      return reply.status(500).send({ error: 'Failed to fetch time entries' });
    }
  });

  // GET /timesheet — weekly timesheet for current user
  fastify.get('/timesheet', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { weekStart } = request.query as { weekStart: string };
      if (!weekStart) return reply.status(400).send({ error: 'weekStart is required' });

      const timesheet = await timeEntryService.getWeeklyTimesheet(user.userId, weekStart);
      return timesheet;
    } catch (error) {
      logger.error('Get timesheet error', { error });
      return reply.status(500).send({ error: 'Failed to fetch timesheet' });
    }
  });

  // GET /actual-vs-estimated/:scheduleId
  fastify.get('/actual-vs-estimated/:scheduleId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const data = await timeEntryService.getActualVsEstimated(scheduleId);
      return data;
    } catch (error) {
      logger.error('Get actual vs estimated error', { error });
      return reply.status(500).send({ error: 'Failed to fetch comparison data' });
    }
  });

  // PUT /:id — update
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateTimeEntrySchema.parse(request.body);
      const entry = await timeEntryService.update(id, body);
      return { entry };
    } catch (error) {
      logger.error('Update time entry error', { error });
      return reply.status(500).send({ error: 'Failed to update time entry' });
    }
  });

  // DELETE /:id
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await timeEntryService.delete(id);
      return { message: 'Time entry deleted' };
    } catch (error) {
      logger.error('Delete time entry error', { error });
      return reply.status(500).send({ error: 'Failed to delete time entry' });
    }
  });
}
