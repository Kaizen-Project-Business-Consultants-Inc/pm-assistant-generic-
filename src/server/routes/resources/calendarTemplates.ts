import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { calendarTemplateService } from '../../services/CalendarTemplateService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  workingDays: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).min(1),
  hoursPerDay: z.number().min(0.5).max(24),
  isDefault: z.boolean().default(false),
});

export async function calendarTemplateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /resources/calendar-templates
  fastify.get('/', { preHandler: [requireScope('read')] }, async () => {
    const templates = await calendarTemplateService.list();
    return { templates };
  });

  // GET /resources/calendar-templates/:id
  fastify.get('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const template = await calendarTemplateService.get(id);
    if (!template) return reply.status(404).send({ error: 'Calendar template not found' });
    return { template };
  });

  // POST /resources/calendar-templates
  fastify.post('/', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = createSchema.parse(request.body);
    const template = await calendarTemplateService.create(data);
    return reply.status(201).send({ template });
  });

  // PUT /resources/calendar-templates/:id
  fastify.put('/:id', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const data = createSchema.partial().parse(request.body);
    const template = await calendarTemplateService.update(id, data);
    if (!template) return reply.status(404).send({ error: 'Calendar template not found' });
    return { template };
  });

  // DELETE /resources/calendar-templates/:id
  fastify.delete('/:id', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const deleted = await calendarTemplateService.delete(id);
    if (!deleted) return reply.status(404).send({ error: 'Calendar template not found' });
    return { message: 'Calendar template deleted' };
  });
}
