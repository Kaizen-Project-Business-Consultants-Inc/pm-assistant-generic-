import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { calendarTemplateService } from '../../services/CalendarTemplateService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';

const createSchema = z.object({
  name: z.string({ message: 'Enter a name for the calendar.' }).trim().min(1, 'Enter a name for the calendar.').max(100, 'Keep the calendar name under 100 characters.'),
  workingDays: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], { message: 'Working days must be mon, tue, wed, thu, fri, sat or sun.' }), { message: 'Choose at least one working day.' }).min(1, 'Choose at least one working day.'),
  hoursPerDay: z.number({ message: 'Enter the working hours per day (0.5 to 24).' }).min(0.5, 'Enter the working hours per day (0.5 to 24).').max(24, 'Enter the working hours per day (0.5 to 24).'),
  isDefault: z.boolean().default(false),
});

// createSchema.partial() alone would silently reset isDefault to false on any update
// that doesn't resend it — this project's Zod version doesn't clear .default(...)
// through .partial() (same bug class as updateProjectSchema). Override it bare.
export const updateSchema = createSchema.partial().extend({
  isDefault: z.boolean().optional(),
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
    const data = createSchema.parse(request.body ?? {});
    const template = await calendarTemplateService.create(data);
    return reply.status(201).send({ template });
  });

  // PUT /resources/calendar-templates/:id
  fastify.put('/:id', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const data = updateSchema.parse(request.body ?? {});
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
