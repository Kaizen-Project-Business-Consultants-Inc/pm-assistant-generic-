import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { checkEntityProjectAccess } from '../../middleware/checkEntityProjectAccess';
import { meetingService } from '../../services/MeetingService';
import { meetingIntelligenceService } from '../../services/MeetingIntelligenceService';
import { meetingActionItemService } from '../../services/MeetingActionItemService';
import { meetingRepository } from '../../database/MeetingRepository';
import { emailService, EmailRejectedError } from '../../services/EmailService';

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
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, status, type, from, to } = request.query as {
      projectId?: string; status?: string; type?: string; from?: string; to?: string;
    };
    if (!projectId) return reply.status(400).send({ error: 'projectId query parameter is required' });

    const allowed = await checkEntityProjectAccess(projectId, request.user!.userId, request.user!.role, 'viewer', reply);
    if (!allowed) return;

    const meetings = await meetingService.getMeetings(projectId, { status, type, from, to });
    return { meetings };
  });

  // GET /upcoming — upcoming meetings for a project
  fastify.get('/upcoming', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.query as { projectId?: string };
    if (!projectId) return reply.status(400).send({ error: 'projectId query parameter is required' });

    const allowed = await checkEntityProjectAccess(projectId, request.user!.userId, request.user!.role, 'viewer', reply);
    if (!allowed) return;

    const meetings = await meetingService.getUpcoming(projectId);
    return { meetings };
  });

  // POST / — create a meeting
  fastify.post('/', { preHandler: [requireScope('write'), requireProjectAccess('editor')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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

    const allowed = await checkEntityProjectAccess(result.meeting.projectId, request.user!.userId, request.user!.role, 'viewer', reply);
    if (!allowed) return;

    return result;
  });

  // PUT /:id — update meeting (editor)
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const meeting = await meetingRepository.findById(id);
    if (!meeting) return reply.status(404).send({ error: 'Meeting not found' });

    const allowed = await checkEntityProjectAccess(meeting.projectId, user.userId, user.role, 'editor', reply);
    if (!allowed) return;

    const parsed = updateSchema.parse(request.body);
    return meetingService.updateMeeting(id, parsed, user.userId);
  });

  // DELETE /:id — delete meeting (editor for own, manager for others)
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const meeting = await meetingRepository.findById(id);
    if (!meeting) return reply.status(404).send({ error: 'Meeting not found' });

    const isOwner = meeting.createdBy === user.userId;
    const minRole = isOwner ? 'editor' : 'manager';
    const allowed = await checkEntityProjectAccess(meeting.projectId, user.userId, user.role, minRole as any, reply);
    if (!allowed) return;

    await meetingService.deleteMeeting(id, user.userId);
    return reply.status(204).send();
  });

  // POST /:id/complete — mark meeting complete (editor)
  fastify.post('/:id/complete', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const meeting = await meetingRepository.findById(id);
    if (!meeting) return reply.status(404).send({ error: 'Meeting not found' });

    const allowed = await checkEntityProjectAccess(meeting.projectId, user.userId, user.role, 'editor', reply);
    if (!allowed) return;

    return meetingService.completeMeeting(id, user.userId);
  });

  // POST /:id/cancel — cancel meeting (editor)
  fastify.post('/:id/cancel', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const meeting = await meetingRepository.findById(id);
    if (!meeting) return reply.status(404).send({ error: 'Meeting not found' });

    const allowed = await checkEntityProjectAccess(meeting.projectId, user.userId, user.role, 'editor', reply);
    if (!allowed) return;

    return meetingService.cancelMeeting(id, user.userId);
  });

  // POST /:id/link-analysis — link an existing analysis to this meeting (editor)
  fastify.post('/:id/link-analysis', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const meeting = await meetingRepository.findById(id);
    if (!meeting) return reply.status(404).send({ error: 'Meeting not found' });

    const allowed = await checkEntityProjectAccess(meeting.projectId, request.user!.userId, request.user!.role, 'editor', reply);
    if (!allowed) return;

    const { analysisId } = (request.body as { analysisId?: string }) || {};
    if (!analysisId) return reply.status(400).send({ error: 'analysisId is required' });
    await meetingService.linkAnalysis(id, analysisId);
    return { success: true };
  });

  // POST /:id/import-actions — import AI action items from linked analysis (editor)
  fastify.post('/:id/import-actions', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const meeting = await meetingRepository.findById(id);
    if (!meeting) return reply.status(404).send({ error: 'Meeting not found' });

    const allowed = await checkEntityProjectAccess(meeting.projectId, user.userId, user.role, 'editor', reply);
    if (!allowed) return;

    const { analysisId } = (request.body as { analysisId?: string }) || {};
    if (!analysisId) return reply.status(400).send({ error: 'analysisId is required' });
    const imported = await meetingService.importActionItemsFromAnalysis(id, analysisId, user.userId);
    return { imported };
  });

  // POST /sync-external — import a meeting from an external source
  fastify.post('/sync-external', { preHandler: [requireScope('write'), requireProjectAccess('editor')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const syncSchema = z.object({
      projectId: z.string().min(1),
      title: z.string().min(1).max(255),
      scheduledDate: z.string().min(1),
      durationMinutes: z.number().int().min(1).max(1440).optional(),
      location: z.string().max(255).optional(),
      attendees: z.array(z.string().max(255)).max(100).optional(),
      summary: z.string().min(1).max(50000),
      actionItems: z.array(z.object({
        description: z.string().min(1).max(2000),
        assigneeName: z.string().max(255).optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      })).max(100).optional(),
      source: z.string().max(100).optional(),
    });

    const parsed = syncSchema.parse(request.body);

    const meeting = await meetingService.createMeeting(parsed.projectId, {
      title: parsed.title,
      meetingType: 'ad_hoc',
      scheduledDate: parsed.scheduledDate,
      durationMinutes: parsed.durationMinutes || 60,
      location: parsed.location,
      attendees: parsed.attendees,
      notes: parsed.summary,
    }, user.userId);

    await meetingService.completeMeeting(meeting.id, user.userId);

    const createdItems = [];
    if (parsed.actionItems && parsed.actionItems.length > 0) {
      for (const ai of parsed.actionItems) {
        const item = await meetingActionItemService.createItem(meeting.id, {
          description: ai.description,
          assigneeName: ai.assigneeName,
          priority: ai.priority || 'medium',
        }, user.userId);
        createdItems.push(item);
      }
    }

    return reply.status(201).send({
      meeting,
      actionItems: createdItems,
      source: parsed.source || 'external',
    });
  });

  // POST /:id/send-minutes — email formatted meeting minutes (editor)
  fastify.post('/:id/send-minutes', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { analysisId?: string; recipientEmails?: string[] };

      if (!body.analysisId) return reply.status(400).send({ error: 'analysisId is required' });
      if (!body.recipientEmails || body.recipientEmails.length === 0) {
        return reply.status(400).send({ error: 'At least one recipient email is required' });
      }
      if (body.recipientEmails.length > 50) {
        return reply.status(400).send({ error: 'Maximum 50 recipients allowed' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const email of body.recipientEmails) {
        if (!emailRegex.test(email)) {
          return reply.status(400).send({ error: `Invalid email address: ${email}` });
        }
      }

      const meetingData = await meetingService.getMeeting(id);
      if (!meetingData) return reply.status(404).send({ error: 'Meeting not found' });

      const allowed = await checkEntityProjectAccess(meetingData.meeting.projectId, request.user!.userId, request.user!.role, 'editor', reply);
      if (!allowed) return;

      const analysis = await meetingIntelligenceService.getAnalysis(body.analysisId);
      if (!analysis) return reply.status(404).send({ error: 'Analysis not found' });

      const meeting = meetingData.meeting;
      const meetingDate = new Date(meeting.scheduledDate).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

      await emailService.sendMeetingMinutes(
        body.recipientEmails,
        meeting.title,
        meetingDate,
        analysis.summary,
        analysis.actionItems || [],
        analysis.decisions || [],
        meeting.attendees || [],
      );

      return { success: true, recipientCount: body.recipientEmails.length };
    } catch (err) {
      // Minutes go to typed-in addresses too, so a refused recipient is the
      // sender's mistake to fix — not an internal error.
      if (err instanceof EmailRejectedError) {
        return reply.status(400).send({
          error: 'Recipient refused',
          message: `The minutes could not be sent: ${err.providerMessage}`,
        });
      }
      fastify.log.error({ err }, 'Failed to send meeting minutes');
      return reply.status(500).send({ error: 'Failed to send meeting minutes' });
    }
  });
}
