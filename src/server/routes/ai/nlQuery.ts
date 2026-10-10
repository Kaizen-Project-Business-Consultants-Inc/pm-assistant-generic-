import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { NLQueryService } from '../../services/NLQueryService';
import { NLQueryRequestSchema } from '../../schemas/nlQuerySchemas';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { checkProjectRole } from '../../middleware/requireProjectAccess';
import { requireFeature } from '../../middleware/requireTier';
import { rateLimiter } from '../../middleware/rateLimiter';
import { aiRefusalReply } from '../../services/AIBudgetService';

export async function nlQueryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const nlQueryService = new NLQueryService();

  // POST / — process a natural-language query
  fastify.post('/', {
    preHandler: [requireScope('write')],
    schema: {
      description: 'Process a natural-language query about project data and return an answer with optional chart visualizations',
      tags: ['nl-query'],
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 3 },
          context: {
            type: 'object',
            properties: {
              projectId: { type: 'string' },
            },
          },
        },
      },
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as any;

        // Validate with Zod for stricter checks
        const parsed = NLQueryRequestSchema.safeParse(body);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
          return reply.code(400).send({ error: `Validation failed: ${issues}` });
        }

        const user = request.user!;
        const userId = user.userId;

        // Rate limit: 30 NL queries per hour
        const rl = rateLimiter.check(`ai:nlquery:${userId}`, 30, 3600_000);
        if (!rl.allowed) {
          return reply.code(429).send({ error: 'Rate limit exceeded. Please try again later.' });
        }

        // A question "about" a project needs access to it; answers only use projects the user can open
        if (parsed.data.context?.projectId) {
          const d = await checkProjectRole(request, parsed.data.context.projectId, 'viewer');
          if (!d.ok) return reply.status(d.status).send(d.body);
        }

        const result = await nlQueryService.processQuery(
          parsed.data.query,
          parsed.data.context,
          { userId, role: user.role },
        );

        return result;
      } catch (error) {
        fastify.log.error(
          { err: error instanceof Error ? error : new Error(String(error)) },
          'NL query processing failed',
        );

        // A refusal (plan without AI 403, AI budget 429, account's AI paused 503, question too
        // big 422) says why, with its code: it is not a failure (it was a 500 "Failed to process query")
        const aiRefusal = aiRefusalReply(error);
        if (aiRefusal) return reply.code(aiRefusal.status).send(aiRefusal.body);
        const refusal = error as { statusCode?: number; code?: string; message?: string };
        if (refusal?.statusCode && refusal.statusCode < 500) {
          return reply.code(refusal.statusCode).send({ error: refusal.message, message: refusal.message, code: refusal.code });
        }

        // Distinguish AI-unavailable errors from unexpected errors
        const message = error instanceof Error ? error.message : 'Unknown error';
        const isServiceError =
          message.includes('AI features are disabled') ||
          message.includes('AI service is unavailable');

        return reply.code(isServiceError ? 503 : 500).send({
          error: isServiceError ? 'AI service unavailable' : 'Failed to process query',
          message,
        });
      }
    },
  });
}
