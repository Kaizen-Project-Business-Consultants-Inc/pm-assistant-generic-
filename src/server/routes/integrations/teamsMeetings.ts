import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { requireProjectAccess, projectsOfSchedules } from '../../middleware/requireProjectAccess';
import { teamsMeetingImportService, TeamsImportError } from '../../services/TeamsMeetingImportService';
import { TeamsGraphError } from '../../services/integrations/TeamsMeetingsGraph';
import { OAuthStateUnavailableError } from '../../utils/oauthState';
import logger from '../../utils/logger';

/**
 * Meeting Intelligence → From Teams (2026-09-30). Connecting is per person (your own Microsoft
 * account, your own meetings). Listing, who's who and analyzing are for the project's
 * Manager/Owner only, like the rest of Meeting Intelligence; the schedule must be the project's.
 */
const teamsListPM = requireProjectAccess('manager', {
  resolve: async (req) => (req.query as { projectId?: string })?.projectId ?? null,
});
const teamsSpeakersPM = requireProjectAccess('manager', {
  resolve: async (req) => (req.body as { projectId?: string } | undefined)?.projectId ?? null,
});
const teamsAnalyzePM = requireProjectAccess('manager', {
  resolve: async (req) => {
    const b = req.body as { projectId?: string; scheduleId?: string } | undefined;
    const sched = await projectsOfSchedules([b?.scheduleId]);
    return b?.projectId && sched && sched[0] === b.projectId ? b.projectId : null;
  },
});

const eventIdSchema = z.string().min(1).max(1024);
const speakersSchema = z.object({ projectId: z.string().min(1), eventId: eventIdSchema });
const analyzeSchema = z.object({
  projectId: z.string().min(1),
  scheduleId: z.string().min(1),
  eventId: eventIdSchema,
  mapping: z.record(z.string().max(255), z.string().max(64).nullable()).default({}),
});

function fail(reply: FastifyReply, err: unknown, what: string) {
  if (err instanceof TeamsImportError) return reply.status(err.status).send({ error: err.code, message: err.message });
  if (err instanceof TeamsGraphError) return reply.status(502).send({ error: 'teams', message: err.message });
  if (err instanceof OAuthStateUnavailableError) return reply.status(503).send({ error: 'unavailable', message: err.message });
  if (err instanceof z.ZodError) return reply.status(400).send({ error: 'invalid', message: 'Pick a meeting and try again.' });
  logger.error(`Teams meetings: ${what} failed`, { error: (err as Error)?.message });
  return reply.status(500).send({ error: 'failed', message: `Could not ${what}. Try again.` });
}

export async function teamsMeetingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Your own connection: is Teams set up on this site, and have you connected?
  fastify.get('/status', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) =>
    teamsMeetingImportService.status(request.user!.userId));

  fastify.get('/install', { preHandler: [requireScope('write'), requireFeature('meeting_intelligence')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try { return { url: await teamsMeetingImportService.installUrl(request.user!.userId) }; } catch (err) { return fail(reply, err, 'start the Teams connection'); }
    });

  // The link a PM sends their IT admin
  fastify.get('/admin-approval-url', { preHandler: [requireScope('read')] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try { return { url: teamsMeetingImportService.adminApprovalUrl() }; } catch (err) { return fail(reply, err, 'make the approval link'); }
    });

  fastify.delete('/connection', { preHandler: [requireScope('write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try { await teamsMeetingImportService.disconnect(request.user!.userId); return { ok: true }; } catch (err) { return fail(reply, err, 'disconnect Teams'); }
    });

  fastify.get('/meetings', { preHandler: [requireScope('read'), requireFeature('meeting_intelligence'), teamsListPM] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { projectId } = request.query as { projectId: string };
        return { meetings: await teamsMeetingImportService.listMeetings(request.user!.userId, projectId) };
      } catch (err) { return fail(reply, err, 'list your Teams meetings'); }
    });

  // POST because the Teams event id is long and opaque; nothing is changed
  fastify.post('/speakers', { preHandler: [requireScope('read'), requireFeature('meeting_intelligence'), teamsSpeakersPM] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const b = speakersSchema.parse(request.body);
        return await teamsMeetingImportService.speakers(request.user!.userId, b.projectId, b.eventId);
      } catch (err) { return fail(reply, err, 'read the meeting transcript'); }
    });

  fastify.post('/analyze', { preHandler: [requireScope('write'), requireFeature('meeting_intelligence'), teamsAnalyzePM] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const b = analyzeSchema.parse(request.body);
        return { data: await teamsMeetingImportService.analyze(request.user!.userId, b.projectId, b.scheduleId, b.eventId, b.mapping) };
      } catch (err) { return fail(reply, err, 'analyze the meeting'); }
    });
}
