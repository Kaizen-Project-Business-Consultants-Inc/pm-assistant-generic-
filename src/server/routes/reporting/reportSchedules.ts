import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { reportScheduleService } from '../../services/ReportScheduleService';
import logger from '../../utils/logger';

const createScheduleSchema = z.object({
  templateId: z.string().min(1),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  timeOfDay: z.string().optional(),
  recipients: z.array(z.string().min(1)).min(1),
  isActive: z.boolean().optional(),
});

const updateScheduleSchema = createScheduleSchema.partial();

export async function reportScheduleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Create schedule
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const body = createScheduleSchema.parse(request.body);

      const schedule = await reportScheduleService.create({
        ...body,
        createdBy: userId,
      });

      return reply.status(201).send({ schedule });
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Create report schedule error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // List schedules for current user
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const schedules = await reportScheduleService.listByUser(userId);
      return { schedules };
    } catch (error) {
      logger.error('List report schedules error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Admin: list all schedules across all users
  fastify.get('/admin/all', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (request.user!.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }
      const schedules = await reportScheduleService.listAll();
      return { schedules };
    } catch (error) {
      logger.error('Admin list report schedules error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Run a schedule immediately
  fastify.post('/:id/run-now', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const schedule = await reportScheduleService.getById(id);
      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

      // Only owner or admin can trigger
      if (schedule.createdBy !== request.user!.userId && request.user!.role !== 'admin') {
        return reply.status(403).send({ error: 'Not authorized' });
      }

      await reportScheduleService.executeOne(id);
      return { success: true };
    } catch (error: any) {
      logger.error('Run now report schedule error', { error });
      return reply.status(500).send({ error: error.message || 'Failed to execute schedule' });
    }
  });

  // Get by id
  fastify.get('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const schedule = await reportScheduleService.getById(id);
      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });
      return { schedule };
    } catch (error) {
      logger.error('Get report schedule error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get schedules for a template
  fastify.get('/template/:templateId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { templateId } = request.params as { templateId: string };
      const schedules = await reportScheduleService.getByTemplateId(templateId);
      return { schedules };
    } catch (error) {
      logger.error('Get template schedules error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Update schedule
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateScheduleSchema.parse(request.body);
      const schedule = await reportScheduleService.update(id, body);
      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });
      return { schedule };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update report schedule error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Delete schedule
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await reportScheduleService.delete(id);
      return { success: true };
    } catch (error) {
      logger.error('Delete report schedule error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
