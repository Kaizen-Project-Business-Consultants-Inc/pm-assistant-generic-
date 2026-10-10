import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { narrativeService, type Narrative } from '../../services/NarrativeService';
import { heavyActionLimit } from '../../middleware/rateLimiter';
import { cachedAIResult } from '../../utils/aiResultCache';
import logger from '../../utils/logger';

/**
 * The narrative, reused for 30 minutes (the dashboard banner asked the AI again on every visit —
 * audit 2026-10-10 M1). Only one the AI actually wrote is kept: the rules' sentence (AI off, or
 * the AI call failed) costs nothing to rebuild, and the next visit may get the AI's.
 */
async function cachedNarrative(key: string, make: () => Promise<Narrative>): Promise<string> {
  return (await cachedAIResult(key, make)).narrative;
}

export async function narrativeRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // No screen calls this (API keys only): limited until the user decides whether to keep it (audit 2026-10-10 M3)
  fastify.get('/project/:projectId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer'), heavyActionLimit('ai-narrative-project', 10)],
    schema: { description: 'Get AI narrative for a specific project', tags: ['narratives'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const role = request.user!.role || 'team_member';
      const narrative = await cachedNarrative(`narrative:project:${projectId}:${role}`, () => narrativeService.generateProjectNarrative(projectId, role as any));
      return { narrative };
    } catch (error) {
      logger.error('Generate project narrative error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/portfolio', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get AI narrative for portfolio overview', tags: ['narratives'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const role = request.user!.role || 'team_member';
      const userId = request.user!.userId;
      const narrative = await cachedNarrative(`narrative:portfolio:${userId}`, () => narrativeService.generatePortfolioNarrative(role as any, { userId, role }));
      return { narrative };
    } catch (error) {
      logger.error('Generate portfolio narrative error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
