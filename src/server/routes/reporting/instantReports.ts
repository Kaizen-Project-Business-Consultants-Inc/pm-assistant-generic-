import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = generateSchema.parse(request.body);

    const result = await instantReportService.generate(body.reportType, body.projectId);

    return {
      html: result.html,
      title: result.title,
      reportType: body.reportType,
      generatedAt: new Date().toISOString(),
    };
  });
}
