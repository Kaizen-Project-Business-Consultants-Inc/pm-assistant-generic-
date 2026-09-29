import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { calendarService } from '../../services/CalendarService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { workingCalendarService, CalendarChangeError } from '../../services/WorkingCalendarService';
import { organizationService } from '../../services/OrganizationService';

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

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-25');
const projectChangeSchema = z.union([
  z.object({ workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'Keep at least one working day in the week').max(7) }),
  z.object({ add: z.object({ date: ymd, type: z.enum(['holiday', 'working']), name: z.string().max(255).optional() }) }),
  z.object({ removeId: z.string().min(1).max(64) }),
]);
const companyChangeSchema = z.union([
  z.object({ add: z.object({ date: ymd, name: z.string().max(255).optional() }) }),
  z.object({ removeId: z.string().min(1).max(64) }),
]);

function badChange(reply: any, err: any) {
  if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', message: err.issues[0]?.message ?? 'Check the date and try again' });
  if (err instanceof CalendarChangeError) return reply.status(400).send({ error: 'Validation error', message: err.message });
  throw err;
}

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

  // Working calendar screen: the project's weekdays, its own days off / working days, the company holidays
  fastify.get('/api/v1/projects/:projectId/working-calendar', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return workingCalendarService.get(projectId);
  });

  // Which tasks a calendar change would move (nothing is saved)
  fastify.post('/api/v1/projects/:projectId/working-calendar/preview', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    try {
      return await workingCalendarService.previewProjectChange(projectId, projectChangeSchema.parse(req.body));
    } catch (err) { return badChange(reply, err); }
  });

  // Save the change and move the tasks (one Schedule History line per plan, with Undo)
  fastify.post('/api/v1/projects/:projectId/working-calendar/apply', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    try {
      return await workingCalendarService.applyProjectChange(projectId, projectChangeSchema.parse(req.body));
    } catch (err) { return badChange(reply, err); }
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

/** Company owner, admin or PMO — the people who may change the company holidays */
async function orgAdminOnly(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  if (['admin', 'pmo'].includes(user.role)) return;
  const org = await organizationService.findByUserId(user.userId).catch(() => null);
  if (org && org.ownerUserId === user.userId) return;
  return reply.status(403).send({ error: 'Forbidden', message: 'Only the company owner or an admin can change the company holidays.' });
}

async function canEditCompanyHolidays(request: FastifyRequest): Promise<boolean> {
  const user = request.user!;
  if (['admin', 'pmo'].includes(user.role)) return true;
  const org = await organizationService.findByUserId(user.userId).catch(() => null);
  return !!org && org.ownerUserId === user.userId;
}

/** Company holidays: one list per company, used by every project's working calendar */
export async function companyHolidayRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/api/v1/company-holidays', { preHandler: [requireScope('read')] }, async (req) => {
    const { calendarService } = await import('../../services/CalendarService');
    return { holidays: await calendarService.listCompanyHolidays(), canEdit: await canEditCompanyHolidays(req) };
  });

  fastify.post('/api/v1/company-holidays/preview', { preHandler: [requireScope('write'), orgAdminOnly] }, async (req, reply) => {
    try {
      return await workingCalendarService.previewCompanyChange(companyChangeSchema.parse(req.body));
    } catch (err) { return badChange(reply, err); }
  });

  fastify.post('/api/v1/company-holidays/apply', { preHandler: [requireScope('write'), orgAdminOnly] }, async (req, reply) => {
    try {
      return await workingCalendarService.applyCompanyChange(companyChangeSchema.parse(req.body), req.user!.userId);
    } catch (err) { return badChange(reply, err); }
  });
}
