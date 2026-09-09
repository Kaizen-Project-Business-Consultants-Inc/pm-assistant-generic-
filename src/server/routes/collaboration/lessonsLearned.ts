import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { lessonsLearnedService } from '../../services/LessonsLearnedService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';

const mitigationsSchema = z.object({
  riskDescription: z.string().min(1),
  projectType: z.string().min(1),
});

const addLessonSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().default(''),
  projectType: z.string().default('other'),
  category: z.enum(['schedule', 'budget', 'quality', 'stakeholder', 'risk', 'communication', 'resource', 'technical']).default('quality'),
  title: z.string().min(1),
  description: z.string().min(1),
  impact: z.enum(['positive', 'negative', 'neutral']).default('neutral'),
  recommendation: z.string().min(1),
  rootCause: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  confidence: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
});

const similarSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().optional(),
});

const updateLessonSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  impact: z.string().min(1).optional(),
  recommendation: z.string().min(1).optional(),
  rootCause: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  isElevated: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'reviewed', 'approved', 'archived', 'pending_elevation']).optional(),
});

const statusSchema = z.object({
  status: z.enum(['draft', 'reviewed', 'approved', 'archived', 'pending_elevation']),
});

const feedbackSchema = z.object({
  action: z.enum(['helpful', 'dismissed', 'outdated']),
  comment: z.string().optional(),
  context: z.string().optional(),
});

const effectivenessSchema = z.object({
  rating: z.number().int().min(0).max(100),
});

export async function lessonsLearnedRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — Paginated list of lessons with optional filters
  fastify.get('/', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { limit = '20', offset = '0', projectId, isElevated, status, category, severity } = request.query as {
        limit?: string; offset?: string; projectId?: string; isElevated?: string; status?: string; category?: string; severity?: string;
      };
      const parsedLimit = parseInt(limit, 10);
      const parsedOffset = parseInt(offset, 10);
      const filters = {
        projectId: projectId || undefined,
        isElevated: isElevated === 'true' ? true : isElevated === 'false' ? false : undefined,
        status: status || undefined,
        category: category || undefined,
        severity: severity || undefined,
      };
      const [lessons, total] = await Promise.all([
        lessonsLearnedService.getLessons(parsedLimit, parsedOffset, filters),
        lessonsLearnedService.countLessons(filters),
      ]);
      return reply.send({ lessons, total, limit: parsedLimit, offset: parsedOffset });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to list lessons');
      return reply.status(500).send({ error: 'Failed to list lessons' });
    }
  });

  // GET /knowledge-base — Aggregated knowledge base overview
  fastify.get('/knowledge-base', {
    preHandler: [requireScope('read')],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const overview = await lessonsLearnedService.getKnowledgeBase();
      return reply.send({ data: overview });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get knowledge base');
      return reply.status(500).send({ error: 'Failed to retrieve knowledge base' });
    }
  });

  // GET /report — PMO lessons report with aggregated stats
  fastify.get('/report', {
    preHandler: [requireScope('read')],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await lessonsLearnedService.getLessonsReport();
      return reply.send({ data: report });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get lessons report');
      return reply.status(500).send({ error: 'Failed to generate lessons report' });
    }
  });

  // POST /extract/:projectId — Extract lessons from a project
  fastify.post('/extract/:projectId', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const userId = String(request.user!.userId);
      const lessons = await lessonsLearnedService.extractLessons(projectId, userId);
      return reply.send({ lessons });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to extract lessons');
      const message = err instanceof Error ? err.message : 'Failed to extract lessons';
      return reply.status(500).send({ error: message });
    }
  });

  // GET /relevant — Find relevant lessons by projectType and/or category
  fastify.get('/relevant', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectType, category } = request.query as { projectType?: string; category?: string };
      const lessons = await lessonsLearnedService.findRelevantLessons(projectType, category);
      return reply.send({ lessons });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to find relevant lessons');
      return reply.status(500).send({ error: 'Failed to find relevant lessons' });
    }
  });

  // POST /patterns — Detect cross-project patterns
  fastify.post('/patterns', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = String(request.user!.userId);
      const patterns = await lessonsLearnedService.detectPatterns(userId);
      return reply.send({ patterns });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to detect patterns');
      return reply.status(500).send({ error: 'Failed to detect patterns' });
    }
  });

  // POST /mitigations — Suggest mitigations for a risk
  fastify.post('/mitigations', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { riskDescription, projectType } = mitigationsSchema.parse(request.body);
      const userId = String(request.user!.userId);
      const suggestions = await lessonsLearnedService.suggestMitigations(riskDescription, projectType, userId);
      return reply.send({ suggestions });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to suggest mitigations');
      return reply.status(500).send({ error: 'Failed to suggest mitigations' });
    }
  });

  // POST / — Add a lesson manually
  fastify.post('/', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = addLessonSchema.parse(request.body);
      const lesson = await lessonsLearnedService.addLesson({
        ...body,
        sourceType: 'manual',
        createdBy: parseInt(String(request.user!.userId), 10),
      });
      return reply.status(201).send({ lesson });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to add lesson');
      return reply.status(500).send({ error: 'Failed to add lesson' });
    }
  });

  // POST /similar — Find semantically similar lessons via RAG
  fastify.post('/similar', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { query, topK } = similarSchema.parse(request.body);
      const lessons = await lessonsLearnedService.findSimilarLessons(query, topK);
      return reply.send({ lessons });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to find similar lessons');
      return reply.status(500).send({ error: 'Failed to find similar lessons' });
    }
  });

  // POST /seed — Seed initial lessons from existing project data
  fastify.post('/seed', {
    preHandler: [requireScope('write')],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const seeded = await lessonsLearnedService.seedFromProjects();
      return reply.send({ seeded });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to seed lessons');
      return reply.status(500).send({ error: 'Failed to seed lessons' });
    }
  });

  // PUT /:id — Update a lesson
  fastify.put('/:id', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = updateLessonSchema.parse(request.body);
      const updated = await lessonsLearnedService.updateLesson(id, data);
      if (!updated) return reply.status(404).send({ error: 'Lesson not found' });
      return { message: 'Lesson updated' };
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to update lesson');
      return reply.status(500).send({ error: 'Failed to update lesson' });
    }
  });

  // PATCH /:id/elevate — Elevate a lesson to org-wide visibility
  fastify.patch('/:id/elevate', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const updated = await lessonsLearnedService.elevateLesson(id);
      if (!updated) return reply.status(404).send({ error: 'Lesson not found' });
      return { message: 'Lesson elevated to org-wide' };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to elevate lesson');
      return reply.status(500).send({ error: 'Failed to elevate lesson' });
    }
  });

  // PATCH /:id/status — Update lesson status (review workflow)
  fastify.patch('/:id/status', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { status } = statusSchema.parse(request.body);
      const updated = await lessonsLearnedService.updateStatus(id, status);
      if (!updated) return reply.status(404).send({ error: 'Lesson not found' });
      return { message: `Lesson status updated to ${status}` };
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to update lesson status');
      return reply.status(500).send({ error: 'Failed to update lesson status' });
    }
  });

  // POST /:id/applied — Increment applied count (when user applies a mitigation suggestion)
  fastify.post('/:id/applied', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await lessonsLearnedService.incrementAppliedCount(id);
      return { message: 'Applied count incremented' };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to increment applied count');
      return reply.status(500).send({ error: 'Failed to update applied count' });
    }
  });

  // PATCH /:id/effectiveness — Rate lesson effectiveness
  fastify.patch('/:id/effectiveness', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { rating } = effectivenessSchema.parse(request.body);
      const updated = await lessonsLearnedService.rateEffectiveness(id, rating);
      if (!updated) return reply.status(404).send({ error: 'Lesson not found' });
      return { message: 'Effectiveness rating updated' };
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to rate effectiveness');
      return reply.status(500).send({ error: 'Failed to rate effectiveness' });
    }
  });

  // POST /:id/feedback — Submit user feedback on a lesson
  fastify.post('/:id/feedback', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { action, comment, context } = feedbackSchema.parse(request.body);
      const userId = parseInt(String(request.user!.userId), 10);
      await lessonsLearnedService.submitFeedback(id, userId, action, comment, context);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to submit lesson feedback');
      return reply.status(500).send({ error: 'Failed to submit feedback' });
    }
  });

  // DELETE /:id — Delete a lesson
  fastify.delete('/:id', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await lessonsLearnedService.deleteLesson(id);
      if (!deleted) return reply.status(404).send({ error: 'Lesson not found' });
      return { message: 'Lesson deleted' };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to delete lesson');
      return reply.status(500).send({ error: 'Failed to delete lesson' });
    }
  });
}
