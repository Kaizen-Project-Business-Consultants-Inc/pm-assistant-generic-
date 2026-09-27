import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { calendarService } from '../../services/CalendarService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

const createCalendarSchema = z.object({
  name: z.string().min(1).max(255),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  hoursPerDay: z.number().min(1).max(24).default(8),
});

const updateCalendarSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  hoursPerDay: z.number().min(1).max(24).optional(),
});

const addExceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['holiday', 'working']).default('holiday'),
  name: z.string().max(255).optional(),
});

export async function calendarRoutes(fastify: FastifyInstance) {
  // These routes had no login check at all (Sep 2026 audit). Without a login the server
  // didn't know which account's database to use, so calendars failed for everyone too.
  // Now: signed in; reading needs project access; changing needs the project's Manager/Owner.
  fastify.addHook('preHandler', authMiddleware);
  const readGate = [requireScope('read'), requireProjectAccess('viewer')];
  const writeGate = [requireScope('write'), requireProjectAccess('manager')];
  fastify.addHook('preHandler', async (request, reply) => {
    if (reply.sent) return;
    for (const gate of request.method === 'GET' ? readGate : writeGate) {
      await (gate as any)(request, reply);
      if (reply.sent) return;
    }
    // The calendar must be this project's, and the exception this calendar's
    const p = request.params as { projectId?: string; calendarId?: string; exceptionId?: string };
    if (p.calendarId) {
      const cal = await calendarService.findById(p.calendarId);
      if (!cal || cal.projectId !== p.projectId) return reply.status(404).send({ error: 'Calendar not found' });
      if (p.exceptionId) {
        const ex = await calendarService.getExceptions(p.calendarId);
        if (!ex.some(e => e.id === p.exceptionId)) return reply.status(404).send({ error: 'Exception not found' });
      }
    }
  });

  // List calendars for a project
  fastify.get('/api/projects/:projectId/calendars', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const calendars = await calendarService.findByProject(projectId);
    return { calendars };
  });

  // Get or create default calendar
  fastify.get('/api/projects/:projectId/calendars/default', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const calendar = await calendarService.getOrCreateDefault(projectId);
    const exceptions = await calendarService.getExceptions(calendar.id);
    return { calendar, exceptions };
  });

  // Create calendar
  fastify.post('/api/projects/:projectId/calendars', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const data = createCalendarSchema.parse(req.body);
    const calendar = await calendarService.create({ projectId, ...data });
    return reply.status(201).send({ calendar });
  });

  // Update calendar
  fastify.put('/api/projects/:projectId/calendars/:calendarId', async (req) => {
    const { calendarId } = req.params as { calendarId: string };
    const data = updateCalendarSchema.parse(req.body);
    const calendar = await calendarService.update(calendarId, data);
    if (!calendar) return { error: 'Calendar not found' };
    return { calendar };
  });

  // Delete calendar (non-default only)
  fastify.delete('/api/projects/:projectId/calendars/:calendarId', async (req, reply) => {
    const { calendarId } = req.params as { calendarId: string };
    const deleted = await calendarService.delete(calendarId);
    if (!deleted) return reply.status(400).send({ error: 'Cannot delete default calendar' });
    return { success: true };
  });

  // Get exceptions for a calendar
  fastify.get('/api/projects/:projectId/calendars/:calendarId/exceptions', async (req) => {
    const { calendarId } = req.params as { calendarId: string };
    const exceptions = await calendarService.getExceptions(calendarId);
    return { exceptions };
  });

  // Add exception
  fastify.post('/api/projects/:projectId/calendars/:calendarId/exceptions', async (req, reply) => {
    const { calendarId } = req.params as { calendarId: string };
    const data = addExceptionSchema.parse(req.body);
    const exception = await calendarService.addException(calendarId, data.date, data.type, data.name);
    return reply.status(201).send({ exception });
  });

  // Remove exception
  fastify.delete('/api/projects/:projectId/calendars/:calendarId/exceptions/:exceptionId', async (req) => {
    const { exceptionId } = req.params as { exceptionId: string };
    const deleted = await calendarService.removeException(exceptionId);
    return { success: deleted };
  });

  // Get non-working dates for Gantt shading
  fastify.get('/api/v1/projects/:projectId/non-working-dates', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { start, end } = req.query as { start?: string; end?: string };
    if (!start || !end) return { dates: [] };
    const dates = await calendarService.getNonWorkingDates(projectId, start, end);
    return { dates };
  });
}
