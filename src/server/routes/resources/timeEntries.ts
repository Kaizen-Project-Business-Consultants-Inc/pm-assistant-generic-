import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { projectService } from '../../services/ProjectService';
import { timeEntryService } from '../../services/TimeEntryService';
import { timeAnomalyService } from '../../services/TimeAnomalyService';
import { timeEntryRepository } from '../../database/TimeEntryRepository';
import { weeklyTimesheetService, TimesheetError } from '../../services/WeeklyTimesheetService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess, projectsOfSchedules } from '../../middleware/requireProjectAccess';
import { viewerWriteBypass, ownWorkScope } from '../../middleware/viewerWriteBypass';
import { checkEntityProjectAccess } from '../../middleware/checkEntityProjectAccess';
import { automationEventBus } from '../../services/automation/AutomationEventBus';
import { scheduleService } from '../../services/ScheduleService';
import logger from '../../utils/logger';
import { sendValidationError } from '../../utils/validationError';

const flagSchema = z.object({
  taskId: z.string({ message: 'Say which task line you are flagging.' }).min(1, 'Say which task line you are flagging.'),
  note: z.string({ message: 'Say what is wrong with the line.' }).trim().min(1, 'Say what is wrong with the line.').max(1000, 'Keep the note under 1000 characters.'),
});

/** A calendar day from the query/body, else today (UTC) */
function dayOrToday(date?: string): string {
  return date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function timesheetError(reply: FastifyReply, error: unknown, fallback: string) {
  if (error instanceof TimesheetError) return reply.status(error.statusCode).send({ error: error.message, message: error.message });
  logger.error(fallback, { error });
  return reply.status(500).send({ error: fallback, message: `${fallback}. Try again in a minute.` });
}

const rejectTimesheetSchema = z.object({
  reason: z.string({ message: 'Give a reason for sending the timesheet back.' }).min(1, 'Give a reason for sending the timesheet back.').max(2000, 'Keep the reason under 2000 characters.'),
});

const HOURS_MESSAGE = 'Enter the hours worked — more than 0 and at most 24.';
const createTimeEntrySchema = z.object({
  taskId: z.string({ message: 'Choose the task you worked on.' }).min(1, 'Choose the task you worked on.'),
  scheduleId: z.string({ message: "Say which schedule the task is in (scheduleId)." }).min(1, "Say which schedule the task is in (scheduleId)."),
  projectId: z.string({ message: 'Say which project the time is for (projectId).' }).min(1, 'Say which project the time is for (projectId).'),
  date: z.string({ message: 'Enter the date you worked.' }).min(1, 'Enter the date you worked.'),
  hours: z.number({ message: HOURS_MESSAGE }).positive(HOURS_MESSAGE).max(24, HOURS_MESSAGE),
  description: z.string().max(2000, 'Keep the description under 2000 characters.').optional(),
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

  // POST / — log your OWN time (any member of the project; the PM approves). userId is
  // always the caller, so nobody can log time for someone else.
  fastify.post('/', { preHandler: [viewerWriteBypass('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = createTimeEntrySchema.parse(request.body ?? {});
      // The task and schedule must belong to the project the access check was made for
      const schedule = await scheduleService.findById(body.scheduleId);
      const task = await scheduleService.findTaskById(body.taskId);
      if (!schedule || schedule.projectId !== body.projectId || !task || task.scheduleId !== body.scheduleId) {
        return reply.status(400).send({ error: 'mismatch', message: "That task isn't in this project's schedule." });
      }
      // The sample project is read-only — approved hours would change its tasks (2026-10-05 audit)
      const project = await projectService.findById(body.projectId);
      if (project?.isDemo) {
        return reply.status(400).send({ error: 'sample_read_only', message: "The sample project is read-only — time can't be logged on it." });
      }
      // Hours can't be added to a week that's been sent for approval or approved
      await weeklyTimesheetService.assertWeekOpen(user.userId, body.date);
      const entry = await timeEntryService.create({ ...body, userId: user.userId });
      automationEventBus.emit({ type: 'time_entry.created', entityType: 'time_entry', entityId: entry.id, projectId: body.projectId, userId: user.userId, payload: entry, timestamp: new Date().toISOString() }).catch(() => {});
      return { entry };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error instanceof TimesheetError) return reply.status(error.statusCode).send({ error: error.message, message: error.message });
      logger.error('Create time entry error', { error });
      return reply.status(500).send({ error: 'Failed to create time entry' });
    }
  });

  // GET /task/:taskId — entries for a task
  fastify.get('/task/:taskId', { preHandler: [requireScope('read'), requireProjectAccess('viewer', {
    resolve: async (req) => {
      const t = await scheduleService.findTaskById((req.params as { taskId: string }).taskId);
      return t ? projectsOfSchedules([t.scheduleId]) : null;
    },
  })] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.get('/project/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.get('/actual-vs-estimated/:scheduleId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const data = await timeEntryService.getActualVsEstimated(scheduleId);
      return data;
    } catch (error) {
      logger.error('Get actual vs estimated error', { error });
      return reply.status(500).send({ error: 'Failed to fetch comparison data' });
    }
  });

  // ── Weekly timesheets (2026-10-02): one per person per week, approved by their line manager ──

  // GET /week?date= — my week: a line per task (planned this week, hours by day, task so far)
  fastify.get('/week', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { date } = request.query as { date?: string };
    try {
      return await weeklyTimesheetService.weekView(request.user!.userId, dayOrToday(date));
    } catch (error) { return timesheetError(reply, error, 'Failed to load the timesheet'); }
  });

  // POST /week/submit { date } — send my week to my line manager
  fastify.post('/week/submit', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { date } = (request.body ?? {}) as { date?: string };
    try {
      const view = await weeklyTimesheetService.submit(request.user!.userId, dayOrToday(date));
      automationEventBus.emit({ type: 'timesheet.submitted', entityType: 'timesheet', entityId: view.sheet?.id ?? '', projectId: '', userId: request.user!.userId, payload: { weekStart: view.weekStart, totalHours: view.totals.worked }, timestamp: new Date().toISOString() }).catch(() => {});
      return view;
    } catch (error) { return timesheetError(reply, error, 'Failed to submit the timesheet'); }
  });

  // POST /week/recall { date } — take my week back while it's waiting for approval
  fastify.post('/week/recall', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { date } = (request.body ?? {}) as { date?: string };
    try {
      return await weeklyTimesheetService.recall(request.user!.userId, dayOrToday(date));
    } catch (error) { return timesheetError(reply, error, 'Failed to recall the timesheet'); }
  });

  // GET /approvals — timesheets waiting for me as line manager
  fastify.get('/approvals', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [timesheets, isApprover] = await Promise.all([
        weeklyTimesheetService.pendingFor(request.user!.userId),
        weeklyTimesheetService.isApprover(request.user!.userId),
      ]);
      // "To approve" shows only for line managers (hide controls a role can never use)
      return { timesheets, isApprover: isApprover || timesheets.length > 0 };
    } catch (error) { return timesheetError(reply, error, 'Failed to load timesheets to approve'); }
  });

  // GET /timesheets/:id — one timesheet (its approver, its owner, or the company owner)
  fastify.get('/timesheets/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await weeklyTimesheetService.sheetDetail((request.params as { id: string }).id, request.user!.userId);
    } catch (error) { return timesheetError(reply, error, 'Failed to load the timesheet'); }
  });

  // POST /timesheets/:id/approve — the line manager approves the week
  fastify.post('/timesheets/:id/approve', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await weeklyTimesheetService.approve((request.params as { id: string }).id, request.user!.userId);
      return { message: 'Timesheet approved', approved: result.approvedEntryIds.length };
    } catch (error) { return timesheetError(reply, error, 'Failed to approve the timesheet'); }
  });

  // POST /timesheets/:id/reject { reason } — the line manager sends the week back
  fastify.post('/timesheets/:id/reject', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = rejectTimesheetSchema.parse(request.body ?? {});
      await weeklyTimesheetService.reject((request.params as { id: string }).id, request.user!.userId, body.reason);
      return { message: 'Timesheet sent back' };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      return timesheetError(reply, error, 'Failed to send the timesheet back');
    }
  });

  // POST /timesheets/:id/flags { taskId, note } — a project's PM flags a line for the line manager
  fastify.post('/timesheets/:id/flags', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = flagSchema.parse(request.body ?? {});
      await weeklyTimesheetService.flag((request.params as { id: string }).id, body.taskId, body.note, request.user!.userId);
      return { message: 'Flag sent to the line manager' };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      return timesheetError(reply, error, 'Failed to flag the line');
    }
  });

  // GET /project/:projectId/pending — hours waiting for approval on this project (its PM)
  fastify.get('/project/:projectId/pending', { preHandler: [requireScope('read'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return { pending: await weeklyTimesheetService.projectPending((request.params as { projectId: string }).projectId) };
    } catch (error) { return timesheetError(reply, error, 'Failed to load pending hours'); }
  });

  // GET /burndown/:projectId — burndown forecast
  fastify.get('/burndown/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.get('/trends/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.get('/heatmap/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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

      const allowed = await checkEntityProjectAccess(projectId, user.userId, user.role, 'viewer', reply);
      if (!allowed) return;

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

      const allowed = await checkEntityProjectAccess(projectId, request.user!.userId, request.user!.role, 'viewer', reply);
      if (!allowed) return;

      const explanation = await timeAnomalyService.explainAnomaly(anomaly, projectId);
      return { explanation };
    } catch (error) {
      logger.error('Explain anomaly error', { error });
      return reply.status(500).send({ error: 'Failed to explain anomaly' });
    }
  });

  // GET /anomalies/:projectId — detect time anomalies
  fastify.get('/anomalies/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
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
  fastify.get('/compliance/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { weekStart } = request.query as { weekStart?: string };
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
  fastify.get('/weekly-review/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { weekStart, narrative } = request.query as { weekStart?: string; narrative?: string };
      const ws = weekStart || (() => {
        const d = new Date();
        const day = d.getDay();
        d.setDate(d.getDate() - ((day + 6) % 7));
        return d.toISOString().slice(0, 10);
      })();
      // the AI summary only when the panel is opened (?narrative=1)
      const review = await timeAnomalyService.generateWeeklyReview(projectId, ws, { withNarrative: narrative === '1' || narrative === 'true' });
      return { review };
    } catch (error) {
      logger.error('Get weekly review error', { error });
      return reply.status(500).send({ error: 'Failed to generate weekly review' });
    }
  });

  // PUT /:id — update (viewer can edit own entries, others need editor)
  // Own time: any member (team members/viewers only have 'read' scope — the handler checks it's theirs)
  fastify.put('/:id', { preHandler: [ownWorkScope()] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await timeEntryRepository.findById(id);
      if (!existing) return reply.status(404).send({ error: 'Time entry not found' });

      // Viewers can only edit their own entries
      const isOwner = existing.userId === user.userId;
      const minRole = isOwner ? 'viewer' : 'manager'; // own time: any member; others': the PM
      const allowed = await checkEntityProjectAccess(existing.projectId, user.userId, user.role, minRole as any, reply);
      if (!allowed) return;

      const body = updateTimeEntrySchema.parse(request.body ?? {});
      // Neither the day it's on nor a day it moves to may be in a closed month
      await weeklyTimesheetService.assertDayOpen(existing.date);
      if (body.date) await weeklyTimesheetService.assertWeekOpen(existing.userId, body.date);
      const entry = await timeEntryService.update(id, body);
      automationEventBus.emit({ type: 'time_entry.updated', entityType: 'time_entry', entityId: id, projectId: entry?.projectId || '', userId: user.userId, payload: entry, timestamp: new Date().toISOString() }).catch(() => {});
      return { entry };
    } catch (error: any) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error instanceof TimesheetError) return reply.status(error.statusCode).send({ error: error.message, message: error.message });
      if (error.statusCode === 409) return reply.status(409).send({ error: error.message });
      logger.error('Update time entry error', { error });
      return reply.status(500).send({ error: 'Failed to update time entry' });
    }
  });

  // DELETE /:id (editor for own, manager for others — viewers cannot delete)
  fastify.delete('/:id', { preHandler: [ownWorkScope()] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await timeEntryRepository.findById(id);
      if (!existing) return reply.status(404).send({ error: 'Time entry not found' });

      const isOwner = existing.userId === user.userId;
      const minRole = isOwner ? 'viewer' : 'manager'; // own time: any member; others': the PM
      const allowed = await checkEntityProjectAccess(existing.projectId, user.userId, user.role, minRole as any, reply);
      if (!allowed) return;

      try {
        await weeklyTimesheetService.assertDayOpen(existing.date);
      } catch (e) {
        if (e instanceof TimesheetError) return reply.status(e.statusCode).send({ error: e.message, message: e.message });
        throw e;
      }
      automationEventBus.emit({ type: 'time_entry.deleted', entityType: 'time_entry', entityId: id, projectId: existing.projectId, userId: user.userId, payload: { id }, timestamp: new Date().toISOString() }).catch(() => {});
      await timeEntryService.delete(id);
      return { message: 'Time entry deleted' };
    } catch (error: any) {
      if (error.statusCode === 409) return reply.status(409).send({ error: error.message });
      logger.error('Delete time entry error', { error });
      return reply.status(500).send({ error: 'Failed to delete time entry' });
    }
  });
}
