import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { timeEntryService } from '../../services/TimeEntryService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const submitTimesheetSchema = z.object({
  projectId: z.string().min(1),
  weekStart: z.string().min(1),
});

const rejectTimesheetSchema = z.object({
  reason: z.string().min(1).max(2000),
});

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

  // POST /submit — submit timesheet for approval
  fastify.post('/submit', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = submitTimesheetSchema.parse(request.body);
      const submission = await timeEntryService.submitTimesheet(user.userId, body.projectId, body.weekStart);
      return { submission };
    } catch (error: any) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message });
      logger.error('Submit timesheet error', { error });
      return reply.status(500).send({ error: 'Failed to submit timesheet' });
    }
  });

  // POST /recall/:submissionId — recall submitted timesheet
  fastify.post('/recall/:submissionId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { submissionId } = request.params as { submissionId: string };
      await timeEntryService.recallTimesheet(submissionId, user.userId);
      return { message: 'Timesheet recalled' };
    } catch (error: any) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message });
      logger.error('Recall timesheet error', { error });
      return reply.status(500).send({ error: 'Failed to recall timesheet' });
    }
  });

  // GET /submissions — user's submission history
  fastify.get('/submissions', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
      const submissions = await timeEntryService.getSubmissions(user.userId, startDate, endDate);
      return { submissions };
    } catch (error) {
      logger.error('Get submissions error', { error });
      return reply.status(500).send({ error: 'Failed to fetch submissions' });
    }
  });

  // GET /pending-approvals — manager's pending approvals
  fastify.get('/pending-approvals', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const submissions = await timeEntryService.getPendingApprovals(user.userId);
      return { submissions };
    } catch (error) {
      logger.error('Get pending approvals error', { error });
      return reply.status(500).send({ error: 'Failed to fetch pending approvals' });
    }
  });

  // POST /approve/:submissionId — approve submission
  fastify.post('/approve/:submissionId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { submissionId } = request.params as { submissionId: string };
      await timeEntryService.approveTimesheet(submissionId, user.userId);
      return { message: 'Timesheet approved' };
    } catch (error: any) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message });
      logger.error('Approve timesheet error', { error });
      return reply.status(500).send({ error: 'Failed to approve timesheet' });
    }
  });

  // POST /reject/:submissionId — reject submission
  fastify.post('/reject/:submissionId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { submissionId } = request.params as { submissionId: string };
      const body = rejectTimesheetSchema.parse(request.body);
      await timeEntryService.rejectTimesheet(submissionId, user.userId, body.reason);
      return { message: 'Timesheet rejected' };
    } catch (error: any) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message });
      logger.error('Reject timesheet error', { error });
      return reply.status(500).send({ error: 'Failed to reject timesheet' });
    }
  });

  // GET /timesheet-status — enhanced weekly timesheet with submission status
  fastify.get('/timesheet-status', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { weekStart } = request.query as { weekStart: string };
      if (!weekStart) return reply.status(400).send({ error: 'weekStart is required' });
      const result = await timeEntryService.getWeeklyTimesheetStatus(user.userId, weekStart);
      return result;
    } catch (error) {
      logger.error('Get timesheet status error', { error });
      return reply.status(500).send({ error: 'Failed to fetch timesheet status' });
    }
  });

  // PUT /:id — update
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateTimeEntrySchema.parse(request.body);
      const entry = await timeEntryService.update(id, body);
      return { entry };
    } catch (error: any) {
      if (error.statusCode === 409) return reply.status(409).send({ error: error.message });
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
    } catch (error: any) {
      if (error.statusCode === 409) return reply.status(409).send({ error: error.message });
      logger.error('Delete time entry error', { error });
      return reply.status(500).send({ error: 'Failed to delete time entry' });
    }
  });
}
