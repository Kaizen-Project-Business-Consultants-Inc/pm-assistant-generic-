import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requirePaidTier } from '../../middleware/requireTier';
import { raidReportService } from '../../services/RAIDReportService';
import { reportScheduleService } from '../../services/ReportScheduleService';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';

const filtersSchema = z.object({
  types: z.array(z.enum(['risk', 'issue', 'action', 'decision'])).optional(),
  severities: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional(),
  owners: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
}).optional();

const generateSchema = z.object({
  projectId: z.string().min(1),
  filters: filtersSchema,
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

export async function raidReportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Generate a RAID report
  fastify.post('/generate', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const body = generateSchema.parse(request.body);

      // Trial users get a sample report
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(userId);
        if (user && user.subscriptionTier === 'trial') {
          const sample = raidReportService.generateSample(body.projectId);
          return { report: sample, sample: true };
        }
      }

      const result = await raidReportService.generate(body.projectId, userId, {
        filters: body.filters,
        recipients: body.recipients,
        sendEmail: body.sendEmail,
      });

      return { report: result };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Generate RAID report error', { error });
      return reply.status(500).send({ error: 'Failed to generate RAID report' });
    }
  });

  // Create a recurring schedule for RAID reports
  fastify.post('/schedule', {
    preHandler: [requireScope('write'), requirePaidTier],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const body = scheduleSchema.parse(request.body);

      const schedule = await reportScheduleService.create({
        templateId: `raid-report::${body.projectId}`,
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
      logger.error('Create RAID report schedule error', { error });
      return reply.status(500).send({ error: 'Failed to create schedule' });
    }
  });

  // List schedules for a project
  fastify.get('/schedules/:projectId', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const schedules = await reportScheduleService.getByTemplateId(`raid-report::${projectId}`);
      return { schedules };
    } catch (error) {
      logger.error('List RAID report schedules error', { error });
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
      logger.error('Delete RAID report schedule error', { error });
      return reply.status(500).send({ error: 'Failed to delete schedule' });
    }
  });
}
