import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { meetingService } from '../../services/MeetingService';

const agendaItemSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  presenter: z.string().max(255).optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
});

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(255),
  meetingType: z.enum(['standup', 'sprint_review', 'sprint_retro', 'planning', 'steering', 'kickoff', 'ad_hoc']).optional(),
  scheduledDate: z.string().min(1),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  location: z.string().max(255).optional(),
  attendees: z.array(z.string().max(255)).max(100).optional(),
  agendaItems: z.array(agendaItemSchema).max(50).optional(),
  notes: z.string().max(50000).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  meetingType: z.enum(['standup', 'sprint_review', 'sprint_retro', 'planning', 'steering', 'kickoff', 'ad_hoc']).optional(),
  scheduledDate: z.string().min(1).optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  location: z.string().max(255).optional(),
  attendees: z.array(z.string().max(255)).max(100).optional(),
  agendaItems: z.array(agendaItemSchema).max(50).optional(),
  notes: z.string().max(50000).optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
});

export async function meetingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list meetings for a project
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId, status, type, from, to } = request.query as {
      projectId?: string; status?: string; type?: string; from?: string; to?: string;
    };
    if (!projectId) throw new Error('projectId query parameter is required');
    const meetings = await meetingService.getMeetings(projectId, { status, type, from, to });
    return { meetings };
  });

  // GET /upcoming — upcoming meetings for a project
  fastify.get('/upcoming', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId } = request.query as { projectId?: string };
    if (!projectId) throw new Error('projectId query parameter is required');
    const meetings = await meetingService.getUpcoming(projectId);
    return { meetings };
  });

  // POST / — create a meeting
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const parsed = createSchema.parse(request.body);
    const meeting = await meetingService.createMeeting(parsed.projectId, parsed, user.userId);
    return reply.status(201).send(meeting);
  });

  // GET /:id — get meeting with action items + linked analyses
  fastify.get('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const result = await meetingService.getMeeting(id);
    if (!result) return reply.status(404).send({ error: 'Meeting not found' });
    return result;
  });

  // PUT /:id — update meeting
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.parse(request.body);
    return meetingService.updateMeeting(id, parsed, user.userId);
  });

  // DELETE /:id — delete meeting
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    await meetingService.deleteMeeting(id, user.userId);
    return reply.status(204).send();
  });

  // POST /:id/complete — mark meeting complete
  fastify.post('/:id/complete', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    return meetingService.completeMeeting(id, user.userId);
  });

  // POST /:id/cancel — cancel meeting
  fastify.post('/:id/cancel', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    return meetingService.cancelMeeting(id, user.userId);
  });

  // POST /:id/link-analysis — link an existing analysis to this meeting
  fastify.post('/:id/link-analysis', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const { analysisId } = (request.body as { analysisId?: string }) || {};
    if (!analysisId) throw new Error('analysisId is required');
    await meetingService.linkAnalysis(id, analysisId);
    return { success: true };
  });

  // POST /:id/import-actions — import AI action items from linked analysis
  fastify.post('/:id/import-actions', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { analysisId } = (request.body as { analysisId?: string }) || {};
    if (!analysisId) throw new Error('analysisId is required');
    const imported = await meetingService.importActionItemsFromAnalysis(id, analysisId, user.userId);
    return { imported };
  });
}
