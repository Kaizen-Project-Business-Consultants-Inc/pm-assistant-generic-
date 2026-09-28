import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { NLQueryService } from '../../services/NLQueryService';
import { NLQueryRequestSchema } from '../../schemas/nlQuerySchemas';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { checkProjectRole } from '../../middleware/requireProjectAccess';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';
import { rateLimiter } from '../../middleware/rateLimiter';

export async function nlQueryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const nlQueryService = new NLQueryService();

  // POST / — process a natural-language query
  // Trial users get a sample response with an upgrade prompt.
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

        // Trial users get sample NL query response
        if (user.role !== 'admin') {
          const fullUser = await userService.findById(userId);
          if (fullUser && fullUser.subscriptionTier === 'trial') {
            return generateSampleNLResponse(parsed.data.query);
          }
        }

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

function generateSampleNLResponse(query: string) {
  return {
    answer: `**Sample Response** — This is a preview of the Natural Language Query feature.\n\nYour query: *"${query}"*\n\nWith the full version, Mjuzi AI analyzes your actual project data to answer questions like:\n- Which projects are at risk?\n- Show resource utilization across teams\n- Compare project budgets and spending\n- What tasks are overdue this week?\n\nResults include interactive charts and suggested follow-up questions.`,
    charts: [
      {
        type: 'bar' as const,
        title: 'Sample: Project Health Scores',
        labels: ['ERP Migration', 'Mobile App v2', 'Data Platform', 'Website Redesign'],
        datasets: [{
          label: 'Health Score',
          data: [62, 81, 45, 90],
          backgroundColor: ['#f59e0b', '#22c55e', '#ef4444', '#22c55e'],
        }],
      },
    ],
    suggestedFollowUps: [
      'Which projects are behind schedule?',
      'Show budget vs. spending for all projects',
      'Who is over-allocated this month?',
    ],
    sample: true,
  };
}
