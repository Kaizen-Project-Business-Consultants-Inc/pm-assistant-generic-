import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requirePaidTier } from '../../middleware/requireTier';
import { projectStatusReportService } from '../../services/ProjectStatusReportService';
import { reportScheduleService } from '../../services/ReportScheduleService';
import { userService } from '../../services/UserService';
import { emailService } from '../../services/EmailService';
import { renderStatusReportHtml, type StructuredStatusReport } from '../../utils/statusReportRenderer';
import { buildStatusReportDocx } from '../../utils/statusReportDocxBuilder';
import { WebSocketService } from '../../services/WebSocketService';
import { getTenantContext, runWithTenantContext } from '../../middleware/requestContext';
import logger from '../../utils/logger';
import crypto from 'crypto';

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

export async function statusReportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Generate a status report (background mode via WebSocket)
  // Trial users get a sample report synchronously (no AI tokens consumed).
  fastify.post('/generate', {
    preHandler: [requireScope('write')],
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
      const data = request.body as StructuredStatusReport;
      if (!data || !data.projectName) {
        return reply.status(400).send({ error: 'Invalid report data' });
      }
      const html = renderStatusReportHtml(data);
      return { html };
    } catch (error: any) {
      logger.error('Render status report error', { error });
      return reply.status(500).send({ error: 'Failed to render report' });
    }
  });

  // Export report as Word (.docx)
  fastify.post('/export/docx', {
    preHandler: [requireScope('write'), requirePaidTier],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as StructuredStatusReport;
      if (!data || !data.projectName) {
        return reply.status(400).send({ error: 'Invalid report data' });
      }

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
      });
      const body = schema.parse(request.body);
      await emailService.sendStatusReportEmail(body.recipients, body.projectName, body.html);
      return { success: true };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Email status report error', { error });
      return reply.status(500).send({ error: 'Failed to email report' });
    }
  });

  // Create a recurring schedule
  fastify.post('/schedule', {
    preHandler: [requireScope('write'), requirePaidTier],
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
    preHandler: [requireScope('read')],
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
      if (schedule.createdBy !== userId && request.user!.role !== 'admin') {
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
