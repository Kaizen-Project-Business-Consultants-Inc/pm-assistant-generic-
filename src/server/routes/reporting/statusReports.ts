import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requirePaidTier } from '../../middleware/requireTier';
import { requireProjectAccess, checkProjectRole } from '../../middleware/requireProjectAccess';
import { checkEntityProjectAccess } from '../../middleware/checkEntityProjectAccess';
import { projectStatusReportService } from '../../services/ProjectStatusReportService';
import { reportScheduleService } from '../../services/ReportScheduleService';
import { userService } from '../../services/UserService';
import { emailService, EmailRejectedError } from '../../services/EmailService';
import { renderStatusReportHtml, type StructuredStatusReport } from '../../utils/statusReportRenderer';
import { buildStatusReportDocx } from '../../utils/statusReportDocxBuilder';
import { WebSocketService } from '../../services/WebSocketService';
import { getTenantContext, runWithTenantContext } from '../../middleware/requestContext';
import logger from '../../utils/logger';
import { sendValidationError } from '../../utils/validationError';
import crypto from 'crypto';
import { clientReportContext } from '../../utils/clientReportContext';
import { heavyActionLimit } from '../../middleware/rateLimiter';

const generateSchema = z.object({
  projectId: z.string().min(1),
  recipients: z.array(z.string().email()).optional(),
  sendEmail: z.boolean().optional(),
});

const scheduleSchema = z.object({
  projectId: z.string().min(1),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  timeOfDay: z.string().optional(),
  recipients: z.array(z.string().email()).min(1),
});

// The edited report sent back for /render and /export/docx (2026-10-07). A partial body used to
// crash the renderer (a missing list or text) and answer 500. Lists default to empty and text in
// table rows to blank, so a half-filled row still renders; the header text is required. Extra
// fields (timeline, timelineToday, projectCode, …) are kept as they are.
const rowText = z.string().nullish().transform(v => v ?? '');
const reportText = (label: string) => z.string({ message: `The report is missing its ${label}.` });
const structuredReportSchema = z.object({
  projectName: z.string({ message: 'The report is missing its project name.' }).min(1, 'The report is missing its project name.'),
  reportNumber: reportText('report number'),
  reportingPeriod: reportText('reporting period'),
  preparedBy: reportText('"prepared by" name'),
  executiveSummary: reportText('executive summary'),
  reportDate: reportText('date'),
  areas: z.array(z.object({ name: rowText, status: z.string({ message: 'Each status area needs a status (green, amber or red).' }), comments: rowText }).passthrough()).default([]),
  milestones: z.array(z.object({
    ref: rowText, name: rowText, schedWeek: rowText, dueDate: rowText, status: rowText, comments: rowText,
  }).passthrough()).default([]),
  achievements: z.array(z.string()).default([]),
  plannedActivities: z.array(z.string()).default([]),
  managementAttention: z.array(z.object({
    ref: rowText, matter: rowText, raised: rowText, owner: rowText, dateNeeded: rowText, impactIfDelayed: rowText,
  }).passthrough()).default([]),
  changeControl: z.array(z.object({
    ref: rowText, description: rowText, status: rowText, scheduleImpact: rowText, costImpact: rowText,
  }).passthrough()).default([]),
}).passthrough();

/** Parse the edited report, or reply 400 saying what is wrong. */
function parseStructuredReport(body: unknown, reply: FastifyReply): StructuredStatusReport | null {
  const parsed = structuredReportSchema.safeParse(body ?? {});
  if (!parsed.success) {
    sendValidationError(reply, parsed.error);
    return null;
  }
  return parsed.data as unknown as StructuredStatusReport;
}

export async function statusReportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Generate a status report (background mode via WebSocket)
  // Trial users get a sample report synchronously (no AI tokens consumed).
  fastify.post('/generate', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const body = generateSchema.parse(request.body);

      // Check if user is on trial tier — return sample report synchronously
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(userId);
        if (user && user.subscriptionTier === 'trial') {
          const sample = projectStatusReportService.generateSample(body.projectId);
          return { report: sample, sample: true };
        }
      }

      // Return immediately with a jobId; generate in background
      const jobId = crypto.randomUUID();
      const tenantCtx = getTenantContext();

      // Fire-and-forget: generate report and send result via WebSocket
      const runGenerate = () => projectStatusReportService.generate(body.projectId, userId, {
        recipients: body.recipients,
        sendEmail: body.sendEmail,
      });

      const generatePromise = tenantCtx
        ? runWithTenantContext(tenantCtx.dbName, tenantCtx.orgId, runGenerate)
        : runGenerate();

      generatePromise.then(result => {
        logger.info('Background status report completed, sending via WebSocket', { jobId, userId, projectId: body.projectId });
        WebSocketService.sendToUser(userId, {
          type: 'status_report_ready',
          payload: { jobId, projectId: body.projectId, report: result },
        });
      }).catch(error => {
        logger.error('Background status report generation failed', { error: error.message, stack: error.stack, jobId });
        WebSocketService.sendToUser(userId, {
          type: 'status_report_failed',
          payload: { jobId, projectId: body.projectId, error: 'Failed to generate status report' },
        });
      });

      return { jobId, status: 'generating' };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Generate status report error', { error });
      return reply.status(500).send({ error: 'Failed to generate status report' });
    }
  });

  // Re-render a report from edited structured data
  fastify.post('/render', {
    preHandler: [requireScope('write'), requirePaidTier],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = parseStructuredReport(request.body, reply);
      if (!data) return reply;
      const html = renderStatusReportHtml(data);
      return { html };
    } catch (error: any) {
      logger.error('Render status report error', { error });
      return reply.status(500).send({ error: 'Failed to render report' });
    }
  });

  // Export report as Word (.docx)
  fastify.post('/export/docx', {
    preHandler: [requireScope('write'), requirePaidTier, heavyActionLimit('status-report-docx', 30)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = parseStructuredReport(request.body, reply);
      if (!data) return reply;

      const docxBuf = await buildStatusReportDocx(data);
      const buf = Buffer.from(docxBuf);
      const safeName = data.projectName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
      const filename = `status-report-${safeName}-${new Date().toISOString().slice(0, 10)}.docx`;
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buf);
    } catch (error: any) {
      logger.error('Export DOCX error', { error: error.message, stack: error.stack });
      return reply.status(500).send({ error: 'Failed to export Word document' });
    }
  });

  // Email a pre-rendered report (allows editing before sending)
  fastify.post('/email', {
    preHandler: [requireScope('write'), requirePaidTier],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const schema = z.object({
        html: z.string().min(1),
        projectName: z.string().min(1),
        recipients: z.array(z.string().email()).min(1),
        // Optional so existing callers keep working; when present it lets the
        // mail carry a portal link the recipient can actually open.
        projectId: z.string().optional(),
      });
      const body = schema.parse(request.body);
      // Emailing a project's status report to its stakeholders: that project's Manager/Owner
      if (body.projectId) {
        const access = await checkProjectRole(request, body.projectId, 'manager');
        if (!access.ok) return reply.status(access.status).send(access.body);
      }
      // These recipients are typed in by hand, so they are routinely the
      // consultant's client rather than a colleague. Address them as such.
      const clientContext = body.projectId
        ? await clientReportContext(body.projectId, request.user?.userId)
        : {};
      await emailService.sendStatusReportEmail(body.recipients, body.projectName, body.html, clientContext);
      return { success: true };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      // A refused recipient is a mistake the sender can fix. Say which.
      if (error instanceof EmailRejectedError) {
        return reply.status(400).send({
          error: 'Recipient refused',
          message: `The report could not be sent: ${error.providerMessage}`,
        });
      }
      // Logging the raw error object serialises to {"name":"Error"} — no
      // message, no stack, nothing to act on.
      logger.error('Email status report error', {
        message: error?.message,
        stack: error?.stack,
      });
      return reply.status(500).send({ error: 'Failed to email report' });
    }
  });

  // Create a recurring schedule
  fastify.post('/schedule', {
    preHandler: [requireScope('write'), requirePaidTier, requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const body = scheduleSchema.parse(request.body);

      const schedule = await reportScheduleService.create({
        templateId: `status-report::${body.projectId}`,
        createdBy: userId,
        frequency: body.frequency,
        dayOfWeek: body.dayOfWeek,
        dayOfMonth: body.dayOfMonth,
        timeOfDay: body.timeOfDay,
        recipients: body.recipients,
      });

      return reply.status(201).send({ schedule });
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Create status report schedule error', { error });
      return reply.status(500).send({ error: 'Failed to create schedule' });
    }
  });

  // List schedules for a project
  fastify.get('/schedules/:projectId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const schedules = await reportScheduleService.getByTemplateId(`status-report::${projectId}`);
      return { schedules };
    } catch (error) {
      logger.error('List status report schedules error', { error });
      return reply.status(500).send({ error: 'Failed to list schedules' });
    }
  });

  // Delete a schedule (owner only)
  fastify.delete('/schedule/:id', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const { id } = request.params as { id: string };

      const schedule = await reportScheduleService.getById(id);
      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

      // Extract projectId from templateId pattern "status-report::<projectId>"
      const projectId = schedule.templateId?.split('::')[1];
      if (projectId) {
        const allowed = await checkEntityProjectAccess(projectId, userId, request.user!.role, 'manager', reply);
        if (!allowed) return reply;
      }

      if (schedule.createdBy !== userId && request.user!.role !== 'admin' && request.user!.role !== 'pmo') {
        return reply.status(403).send({ error: 'Not authorized to delete this schedule' });
      }

      await reportScheduleService.delete(id);
      return { success: true };
    } catch (error) {
      logger.error('Delete status report schedule error', { error });
      return reply.status(500).send({ error: 'Failed to delete schedule' });
    }
  });
}
