import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { reportBuilderService } from '../../services/ReportBuilderService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';

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
  format: z.enum(['csv', 'pdf']),
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
  // Trial users get sample templates with an upgrade prompt.
  fastify.get('/templates', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Trial users get sample report templates
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(request.user!.userId);
        if (user && user.subscriptionTier === 'trial') {
          return { templates: generateSampleTemplates(), sample: true };
        }
      }

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
      const report = await reportBuilderService.generateReport(id, body ?? undefined);
      return { report };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Generate report error', { error });
      return reply.status(500).send({ error: 'Failed to generate report' });
    }
  });

  // POST /templates/:id/export — export report
  fastify.post('/templates/:id/export', { preHandler: [requireScope('write'), requireFeature('reports')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { format } = exportReportSchema.parse(request.body);
      const result = await reportBuilderService.exportReport(id, format);
      return { result };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Export report error', { error });
      return reply.status(500).send({ error: 'Failed to export report' });
    }
  });
}

function generateSampleTemplates() {
  return [
    {
      id: 'sample-1',
      name: 'Weekly Status Report',
      description: 'Summarize project progress, risks, and upcoming milestones for the week.',
      isShared: true,
      createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      sections: [
        { type: 'kpi', dataSource: 'projects', title: 'Key Metrics' },
        { type: 'table', dataSource: 'tasks', title: 'Task Summary' },
        { type: 'bar_chart', dataSource: 'tasks', title: 'Tasks by Status' },
      ],
    },
    {
      id: 'sample-2',
      name: 'Budget Overview',
      description: 'Track budget allocation vs. spending across all projects.',
      isShared: false,
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      sections: [
        { type: 'kpi', dataSource: 'budgets', title: 'Budget KPIs' },
        { type: 'pie_chart', dataSource: 'budgets', title: 'Spending Breakdown' },
      ],
    },
    {
      id: 'sample-3',
      name: 'Time Tracking Summary',
      description: 'Analyze team time entries and utilization rates.',
      isShared: true,
      createdAt: new Date(Date.now() - 21 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      sections: [
        { type: 'line_chart', dataSource: 'time_entries', title: 'Hours by Week' },
        { type: 'table', dataSource: 'time_entries', title: 'Time Entry Details' },
      ],
    },
  ];
}
