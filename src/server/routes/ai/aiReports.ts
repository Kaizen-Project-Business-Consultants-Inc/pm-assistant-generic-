import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AIReportService, ReportType } from '../../services/aiReportService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';

const VALID_REPORT_TYPES: ReportType[] = [
  'weekly-status',
  'risk-assessment',
  'budget-forecast',
  'resource-utilization',
];

const generateReportSchema = z.object({
  reportType: z.enum(['weekly-status', 'risk-assessment', 'budget-forecast', 'resource-utilization']),
  projectId: z.string().optional(),
});

export async function aiReportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const reportService = new AIReportService();

  // POST /generate — generate a report
  fastify.post('/generate', {
    preHandler: [requireScope('write')],
    schema: {
      description: 'Generate an AI report',
      tags: ['ai-reports'],
      body: {
        type: 'object',
        required: ['reportType'],
        properties: {
          reportType: {
            type: 'string',
            enum: VALID_REPORT_TYPES,
          },
          projectId: { type: 'string' },
        },
      },
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = generateReportSchema.parse(request.body);
        const user = request.user!;

        const report = await reportService.generateReport(
          body.reportType,
          { projectId: body.projectId },
          user.userId,
        );

        return report;
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation error', details: error.issues });
        fastify.log.error(
          { err: error instanceof Error ? error : new Error(String(error)) },
          'Report generation failed',
        );
        return reply.code(500).send({
          error: 'Failed to generate report',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  });

  // DELETE /:id — soft-delete a report
  fastify.delete('/:id', {
    preHandler: [requireScope('write')],
    schema: {
      description: 'Delete a generated report',
      tags: ['ai-reports'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const user = request.user!;
        await reportService.deleteReport(request.params.id, user.userId);
        return { success: true };
      } catch (error) {
        fastify.log.error(
          { err: error instanceof Error ? error : new Error(String(error)) },
          'Failed to delete report',
        );
        return reply.code(500).send({
          error: 'Failed to delete report',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  });

  // GET /history — list past generated reports
  fastify.get('/history', {
    preHandler: [requireScope('read')],
    schema: {
      description: 'List past generated reports',
      tags: ['ai-reports'],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const reports = await reportService.getReportHistory(user.userId);
        return { reports };
      } catch (error) {
        fastify.log.error(
          { err: error instanceof Error ? error : new Error(String(error)) },
          'Failed to list report history',
        );
        return reply.code(500).send({
          error: 'Failed to list report history',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  });
}
