import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { heavyActionLimit } from '../../middleware/rateLimiter';
import { textSimplificationService } from '../../services/TextSimplificationService';
import { analyzeReadingLevel } from '../../utils/readingLevel';
import logger from '../../utils/logger';

/** Longest text the AI rewrites: its reply is about as long, and must fit one bounded answer (audit 2026-10-10 M3) */
const SIMPLIFY_MAX_CHARS = 10_000;

const simplifySchema = z.object({
  text: z.string().min(1).max(SIMPLIFY_MAX_CHARS),
  level: z.enum(['mild', 'strong']),
});

const readingLevelSchema = z.object({
  text: z.string().min(1).max(50000),
});

export async function accessibilityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // No screen calls this (API keys only); limited until the user decides whether to keep it (audit 2026-10-10 M3)
  fastify.post('/simplify', {
    preHandler: [requireScope('read'), heavyActionLimit('ai-simplify', 10)],
    schema: { description: 'Simplify text using AI', tags: ['accessibility'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { text, level } = simplifySchema.parse(request.body);
      const simplified = await textSimplificationService.simplify(text, level);
      const readingLevel = analyzeReadingLevel(simplified);
      return { simplified, readingLevel };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.issues });
      }
      logger.error('Text simplification error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/reading-level', {
    preHandler: [requireScope('read')],
    schema: { description: 'Analyze reading level of text', tags: ['accessibility'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { text } = readingLevelSchema.parse(request.body);
      const result = analyzeReadingLevel(text);
      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.issues });
      }
      logger.error('Reading level analysis error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
