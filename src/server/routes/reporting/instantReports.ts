import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { instantReportService } from '../../services/InstantReportService';
import logger from '../../utils/logger';

const generateSchema = z.object({
  reportType: z.string().min(1),
  projectId: z.string().min(1),
});

export async function instantReportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.post('/generate', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer', { resolve: async (req) => (req.body as { projectId?: string } | undefined)?.projectId ?? null })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = generateSchema.parse(request.body);

    // The viewer decides which other projects can be named (Overallocated Resources)
    const result = await instantReportService.generate(body.reportType, body.projectId, request.user!);

    return {
      html: result.html,
      title: result.title,
      reportType: body.reportType,
      generatedAt: new Date().toISOString(),
    };
  });
}
