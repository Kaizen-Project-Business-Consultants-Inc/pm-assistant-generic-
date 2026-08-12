import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { calendarService } from '../../services/CalendarService';

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
