import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { reportBuilderService } from '../../services/ReportBuilderService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { readableProjectIds } from '../../utils/readableProjects';
import { requireFeature } from '../../middleware/requireTier';
import logger from '../../utils/logger';
import { sendValidationError } from '../../utils/validationError';
import { heavyActionLimit } from '../../middleware/rateLimiter';

const reportSectionSchema = z.object({
  title: z.string().optional(),
  type: z.enum(['kpi', 'kpi_card', 'table', 'bar_chart', 'line_chart', 'pie_chart']),
  dataSource: z.enum(['projects', 'tasks', 'time_entries', 'budgets', 'resources', 'raid_items', 'meetings', 'action_items']),
  filters: z.object({
    dateRange: z.object({ start: z.string(), end: z.string() }).optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
    projectId: z.string().optional(),
    status: z.string().optional(),
  }).optional(),
  groupBy: z.string().optional(),
  columns: z.array(z.string()).optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  config: z.object({ sections: z.array(reportSectionSchema) }),
  isShared: z.boolean().optional(),
});

const updateTemplateSchema = createTemplateSchema.partial();

const generateReportParamsSchema = z.object({
  dateRange: z.object({ start: z.string(), end: z.string() }).optional(),
  projectId: z.string().optional(),
}).optional();

const exportReportSchema = z.object({
  format: z.enum(['csv', 'pdf'], { message: 'Choose an export format: csv or pdf.' }),
});

export async function reportBuilderRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /templates — create template
  fastify.post('/templates', { preHandler: [requireScope('write'), requireFeature('reports')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = createTemplateSchema.parse(request.body);
      const template = await reportBuilderService.createTemplate(user.userId, body);
      return reply.status(201).send({ template });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Create report template error', { error });
      return reply.status(500).send({ error: 'Failed to create report template' });
    }
  });

  // GET /templates — list templates
  fastify.get('/templates', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const templates = await reportBuilderService.getTemplates(user.userId);
      return { templates };
    } catch (error) {
      logger.error('Get report templates error', { error });
      return reply.status(500).send({ error: 'Failed to fetch report templates' });
    }
  });

  // GET /templates/:id — get template by id
  fastify.get('/templates/:id', { preHandler: [requireScope('read'), requireFeature('reports')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const template = await reportBuilderService.getTemplateById(id);
      if (!template) return reply.status(404).send({ error: 'Not found', message: 'Report template not found' });
      return { template };
    } catch (error) {
      logger.error('Get report template error', { error });
      return reply.status(500).send({ error: 'Failed to fetch report template' });
    }
  });

  // PUT /templates/:id — update template
  fastify.put('/templates/:id', { preHandler: [requireScope('write'), requireFeature('reports')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await reportBuilderService.getTemplateById(id);
      if (!existing) return reply.status(404).send({ error: 'Not found', message: 'Report template not found' });
      if (existing.userId !== user.userId && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'You can only update your own templates' });
      }
      const body = updateTemplateSchema.parse(request.body);
      const template = await reportBuilderService.updateTemplate(id, body);
      return { template };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update report template error', { error });
      return reply.status(500).send({ error: 'Failed to update report template' });
    }
  });

  // DELETE /templates/:id — delete template
  fastify.delete('/templates/:id', { preHandler: [requireScope('write'), requireFeature('reports')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await reportBuilderService.getTemplateById(id);
      if (!existing) return reply.status(404).send({ error: 'Not found', message: 'Report template not found' });
      if (existing.userId !== user.userId && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'You can only delete your own templates' });
      }
      await reportBuilderService.deleteTemplate(id);
      return { message: 'Report template deleted' };
    } catch (error) {
      logger.error('Delete report template error', { error });
      return reply.status(500).send({ error: 'Failed to delete report template' });
    }
  });

  // POST /templates/:id/generate — generate report
  fastify.post('/templates/:id/generate', { preHandler: [requireScope('write'), requireFeature('reports')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = generateReportParamsSchema.parse(request.body);
      const report = await reportBuilderService.generateReport(id, body ?? undefined, await readableProjectIds(request.user!));
      return { report };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error instanceof Error && error.message === 'Report template not found') {
        return reply.status(404).send({ error: 'Not found', message: 'That report template no longer exists.' });
      }
      logger.error('Generate report error', { error });
      return reply.status(500).send({ error: 'Failed to generate report' });
    }
  });

  // POST /templates/:id/export — export report
  fastify.post('/templates/:id/export', { preHandler: [requireScope('write'), requireFeature('reports'), heavyActionLimit('report-export', 30)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { format } = exportReportSchema.parse(request.body ?? {});
      const result = await reportBuilderService.exportReport(id, format, undefined, await readableProjectIds(request.user!));
      return { result };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error instanceof Error && error.message === 'Report template not found') {
        return reply.status(404).send({ error: 'Not found', message: 'That report template no longer exists.' });
      }
      logger.error('Export report error', { error });
      return reply.status(500).send({ error: 'Failed to export report' });
    }
  });
}
