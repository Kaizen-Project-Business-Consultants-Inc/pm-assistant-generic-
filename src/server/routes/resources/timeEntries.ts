import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { timeEntryService } from '../../services/TimeEntryService';
import { timeAnomalyService } from '../../services/TimeAnomalyService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { automationEventBus } from '../../services/automation/AutomationEventBus';
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
      automationEventBus.emit({ type: 'time_entry.created', entityType: 'time_entry', entityId: entry.id, projectId: body.projectId, userId: user.userId, payload: entry, timestamp: new Date().toISOString() }).catch(() => {});
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

  // GET /project/:projectId — entries for a project (optionally filtered by userId)
  fastify.get('/project/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { startDate, endDate, userId } = request.query as { startDate?: string; endDate?: string; userId?: string };
      const rawEntries = await timeEntryService.getByProject(projectId, startDate, endDate, userId);
      const entries = rawEntries.map((e: any) => ({
        ...e,
        category: timeAnomalyService.categorizeEntry(e.taskName || '', e.description || ''),
      }));
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
      automationEventBus.emit({ type: 'timesheet.submitted', entityType: 'timesheet', entityId: submission.id, projectId: body.projectId, userId: user.userId, payload: submission, timestamp: new Date().toISOString() }).catch(() => {});
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

  // GET /burndown/:projectId — burndown forecast
  fastify.get('/burndown/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const forecast = await timeAnomalyService.getBurndownForecast(projectId);
      return { forecast };
    } catch (error) {
      logger.error('Get burndown forecast error', { error });
      return reply.status(500).send({ error: 'Failed to get burndown forecast' });
    }
  });

  // GET /trends/:projectId — trend analysis
  fastify.get('/trends/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { weeks } = request.query as { weeks?: string };
      const trends = await timeAnomalyService.getTrendAnalysis(projectId, weeks ? parseInt(weeks, 10) : 12);
      return { trends };
    } catch (error) {
      logger.error('Get trend analysis error', { error });
      return reply.status(500).send({ error: 'Failed to get trend analysis' });
    }
  });

  // GET /heatmap/:projectId — utilization heatmap
  fastify.get('/heatmap/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
      const end = endDate || new Date().toISOString().slice(0, 10);
      const start = startDate || (() => { const d = new Date(); d.setDate(d.getDate() - 28); return d.toISOString().slice(0, 10); })();
      const heatmap = await timeAnomalyService.getUtilizationHeatmap(projectId, start, end);
      return { heatmap };
    } catch (error) {
      logger.error('Get utilization heatmap error', { error });
      return reply.status(500).send({ error: 'Failed to get utilization heatmap' });
    }
  });

  // GET /suggest — AI time suggestion
  fastify.get('/suggest', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { projectId, date } = request.query as { projectId?: string; date?: string };
      if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
      const suggestion = await timeAnomalyService.getTimeSuggestion(user.userId, projectId, date || new Date().toISOString().slice(0, 10));
      return { suggestion };
    } catch (error) {
      logger.error('Get time suggestion error', { error });
      return reply.status(500).send({ error: 'Failed to get time suggestion' });
    }
  });

  // POST /anomaly-explain — AI anomaly explanation
  fastify.post('/anomaly-explain', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { anomaly, projectId } = request.body as { anomaly: any; projectId: string };
      if (!anomaly || !projectId) return reply.status(400).send({ error: 'anomaly and projectId are required' });
      const explanation = await timeAnomalyService.explainAnomaly(anomaly, projectId);
      return { explanation };
    } catch (error) {
      logger.error('Explain anomaly error', { error });
      return reply.status(500).send({ error: 'Failed to explain anomaly' });
    }
  });

  // GET /anomalies/:projectId — detect time anomalies
  fastify.get('/anomalies/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
      // Default to last 30 days if no range specified
      const end = endDate || new Date().toISOString().slice(0, 10);
      const start = startDate || (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();
      const anomalies = await timeAnomalyService.detectAnomalies(projectId, start, end);
      return { anomalies };
    } catch (error) {
      logger.error('Get time anomalies error', { error });
      return reply.status(500).send({ error: 'Failed to detect anomalies' });
    }
  });

  // GET /compliance/:projectId — compliance status for a week
  fastify.get('/compliance/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { weekStart } = request.query as { weekStart?: string };
      // Default to current week's Monday
      const ws = weekStart || (() => {
        const d = new Date();
        const day = d.getDay();
        d.setDate(d.getDate() - ((day + 6) % 7));
        return d.toISOString().slice(0, 10);
      })();
      const compliance = await timeAnomalyService.getComplianceStatus(projectId, ws);
      return { compliance, weekStart: ws };
    } catch (error) {
      logger.error('Get compliance status error', { error });
      return reply.status(500).send({ error: 'Failed to get compliance status' });
    }
  });

  // GET /weekly-review/:projectId — weekly review pack
  fastify.get('/weekly-review/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { weekStart } = request.query as { weekStart?: string };
      // Default to current week's Monday
      const ws = weekStart || (() => {
        const d = new Date();
        const day = d.getDay();
        d.setDate(d.getDate() - ((day + 6) % 7));
        return d.toISOString().slice(0, 10);
      })();
      const review = await timeAnomalyService.generateWeeklyReview(projectId, ws);
      return { review };
    } catch (error) {
      logger.error('Get weekly review error', { error });
      return reply.status(500).send({ error: 'Failed to generate weekly review' });
    }
  });

  // PUT /:id — update
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateTimeEntrySchema.parse(request.body);
      const entry = await timeEntryService.update(id, body);
      const user = request.user!;
      automationEventBus.emit({ type: 'time_entry.updated', entityType: 'time_entry', entityId: id, projectId: entry?.projectId || '', userId: user.userId, payload: entry, timestamp: new Date().toISOString() }).catch(() => {});
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
      const user = request.user!;
      automationEventBus.emit({ type: 'time_entry.deleted', entityType: 'time_entry', entityId: id, projectId: '', userId: user.userId, payload: { id }, timestamp: new Date().toISOString() }).catch(() => {});
      await timeEntryService.delete(id);
      return { message: 'Time entry deleted' };
    } catch (error: any) {
      if (error.statusCode === 409) return reply.status(409).send({ error: error.message });
      logger.error('Delete time entry error', { error });
      return reply.status(500).send({ error: 'Failed to delete time entry' });
    }
  });
}
