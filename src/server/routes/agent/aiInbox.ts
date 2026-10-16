import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { aiSuggestionRepository } from '../../database/AiSuggestionRepository';
import { sendValidationError } from '../../utils/validationError';
import { aiInboxService, AiInboxNotFoundError, AiInboxStateError, REJECT_REASONS } from '../../services/aiInbox/AiInboxService';
import logger from '../../utils/logger';

const idParams = z.object({ id: z.string().min(1).max(64) });
const acceptSchema = z.object({
  subject: z.string().trim().min(1, 'Write a subject.').max(200).optional(),
  body: z.string().trim().min(1, 'Write a message.').max(5000).optional(),
}).strict();
const rejectSchema = z.object({ reason: z.enum(REJECT_REASONS, { message: 'Say why: not a problem, already handled, or the facts are wrong.' }) });

/**
 * The AI inbox (Phase 2): the agents' suggestions waiting for the PM. Each project's suggestions
 * are its PM's only (manager role on that project, checked per suggestion); deciding needs the
 * 'write' scope. Mounted under /api/v1/ai-inbox.
 */
/** The project a suggestion belongs to — its PM (manager) alone may decide it */
async function suggestionProject(request: FastifyRequest): Promise<string | null> {
  const parsed = idParams.safeParse(request.params);
  if (!parsed.success) return null;
  return (await aiSuggestionRepository.findById(parsed.data.id))?.projectId ?? null;
}
const suggestionPM = requireProjectAccess('manager', { resolve: suggestionProject });

export async function aiInboxRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const fail = (reply: FastifyReply, error: unknown, what: string) => {
    if (error instanceof z.ZodError) return sendValidationError(reply, error);
    if (error instanceof AiInboxNotFoundError) return reply.status(404).send({ error: 'Not found', message: error.message });
    if (error instanceof AiInboxStateError) return reply.status(409).send({ error: 'Conflict', message: error.message });
    logger.error(`AI inbox: ${what} failed`, { message: (error as Error)?.message, stack: (error as Error)?.stack });
    return reply.status(500).send({ error: 'Internal server error', message: `Could not ${what}.` });
  };

  // GET /?view=waiting|done — the caller's suggestions (projects they manage)
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const view = (request.query as { view?: string }).view === 'done' ? 'done' : 'waiting';
      return { suggestions: await aiInboxService.list(request.user!, view) };
    } catch (error) { return fail(reply, error, 'load your AI inbox'); }
  });

  // GET /count — how many wait for the caller (side menu)
  fastify.get('/count', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return { waiting: await aiInboxService.count(request.user!) };
    } catch (error) { return fail(reply, error, 'count your AI inbox'); }
  });

  // GET /projects/:projectId/count — how many wait on one project (its review card)
  fastify.get('/projects/:projectId/count', { preHandler: [requireScope('read'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      return { waiting: await aiInboxService.countForProject(projectId) };
    } catch (error) { return fail(reply, error, 'count this project’s suggestions'); }
  });

  fastify.post('/:id/accept', { preHandler: [requireScope('write'), suggestionPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = idParams.parse(request.params);
      const edits = acceptSchema.parse(request.body ?? {});
      return { suggestion: await aiInboxService.accept(request.user!, id, edits) };
    } catch (error) { return fail(reply, error, 'apply this suggestion'); }
  });

  fastify.post('/:id/reject', { preHandler: [requireScope('write'), suggestionPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = idParams.parse(request.params);
      const { reason } = rejectSchema.parse(request.body ?? {});
      return { suggestion: await aiInboxService.reject(request.user!, id, reason) };
    } catch (error) { return fail(reply, error, 'reject this suggestion'); }
  });

  fastify.post('/:id/undo', { preHandler: [requireScope('write'), suggestionPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = idParams.parse(request.params);
      return { suggestion: await aiInboxService.undo(request.user!, id) };
    } catch (error) { return fail(reply, error, 'undo this suggestion'); }
  });
}
