import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { templateService } from '../../services/TemplateService';
import { createFromTemplateSchema, saveAsTemplateSchema } from '../../schemas/templateSchemas';
import { templateMarketplaceRepository } from '../../database/TemplateMarketplaceRepository';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { paginate } from '../../dto/responses';
import { parsePagination } from '../../schemas/paginationSchema';
import logger from '../../utils/logger';

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  projectType: z.enum(['it', 'construction', 'infrastructure', 'roads', 'other']),
  category: z.string(),
  estimatedDurationDays: z.number().positive(),
  tasks: z.array(z.object({
    refId: z.string(),
    name: z.string(),
    description: z.string().default(''),
    estimatedDays: z.number().min(1),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    parentRefId: z.string().nullable().default(null),
    dependencyRefId: z.string().nullable().default(null),
    dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
    offsetDays: z.number().default(0),
    skills: z.array(z.string()).default([]),
    isSummary: z.boolean().default(false),
    mandatory: z.boolean().optional(),
  })),
  tags: z.array(z.string()).default([]),
});

export async function templateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — List all templates (with optional filters)
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as Record<string, any>;
      const { limit, offset } = parsePagination(query);
      const { rows, total } = await templateService.findAllPaginated(limit, offset, query.projectType, query.category);
      const summaries = rows.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        projectType: t.projectType,
        category: t.category,
        isBuiltIn: t.isBuiltIn,
        estimatedDurationDays: t.estimatedDurationDays,
        taskCount: t.tasks.length,
        phaseCount: t.tasks.filter(task => task.isSummary).length,
        tags: t.tags,
        usageCount: t.usageCount,
      }));
      const page = Math.floor(offset / limit) + 1;
      return paginate(summaries, total, page, limit);
    } catch (error) {
      logger.error('List templates error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch templates' });
    }
  });

  // GET /:id — Get template with full task tree
  fastify.get('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const template = await templateService.findById(id);
      if (!template) {
        return reply.status(404).send({ error: 'Template not found' });
      }
      return { template };
    } catch (error) {
      logger.error('Get template error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch template' });
    }
  });

  // POST / — Create custom template
  fastify.post('/', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = createTemplateSchema.parse(request.body);
      const userId = request.user!.userId;
      const template = await templateService.create({
        ...data,
        isBuiltIn: false,
        createdBy: userId,
      });
      return reply.status(201).send({ template });
    } catch (error) {
      logger.error('Create template error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to create template' });
    }
  });

  // PUT /:id — Update custom template
  fastify.put('/:id', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = createTemplateSchema.partial().parse(request.body);
      const template = await templateService.update(id, data);
      if (!template) {
        return reply.status(404).send({ error: 'Template not found or is built-in' });
      }
      return { template };
    } catch (error) {
      logger.error('Update template error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to update template' });
    }
  });

  // DELETE /:id — Delete custom template
  fastify.delete('/:id', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await templateService.delete(id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Template not found or is built-in' });
      }
      return { message: 'Template deleted successfully' };
    } catch (error) {
      logger.error('Delete template error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete template' });
    }
  });

  // POST /apply — Apply template to create new project
  fastify.post('/apply', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = createFromTemplateSchema.parse(request.body);
      const userId = request.user!.userId;
      const result = await templateService.applyTemplate({
        ...data,
        userId,
        selectedTaskRefIds: data.selectedTaskRefIds,
      });
      return reply.status(201).send(result);
    } catch (error: any) {
      logger.error('Apply template error', { error: error.message, stack: error.stack });
      if (error.message === 'Template not found') {
        return reply.status(404).send({ error: 'Template not found' });
      }
      return reply.status(500).send({ error: 'Internal server error', message: error.message || 'Failed to apply template' });
    }
  });

  // POST /save-from-project — Save existing project as template
  fastify.post('/save-from-project', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = saveAsTemplateSchema.parse(request.body);
      const userId = request.user!.userId;
      const template = await templateService.saveFromProject({
        ...data,
        templateName: data.templateName,
        userId,
      });
      return reply.status(201).send({ template });
    } catch (error: any) {
      logger.error('Save as template error', { error });
      if (error.message === 'Project not found') {
        return reply.status(404).send({ error: 'Project not found' });
      }
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to save as template' });
    }
  });

  // ─── Marketplace Endpoints ──────────────────────────────────────────────────

  // GET /marketplace — List public marketplace templates
  fastify.get('/marketplace', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as Record<string, any>;
      const { limit, offset } = parsePagination(query);
      const { rows, total } = await templateMarketplaceRepository.findAll(limit, offset, query.category);
      const page = Math.floor(offset / limit) + 1;
      const summaries = rows.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        tags: t.tags,
        taskCount: t.taskCount,
        estimatedDays: t.estimatedDays,
        publishedByOrgName: t.publishedByOrgName,
        downloadCount: t.downloadCount,
        createdAt: t.createdAt,
      }));
      return paginate(summaries, total, page, limit);
    } catch (error) {
      logger.error('List marketplace templates error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch marketplace templates' });
    }
  });

  // POST /:id/publish — Publish a custom template to marketplace
  fastify.post('/:id/publish', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      const template = await templateService.findById(id);
      if (!template) {
        return reply.status(404).send({ error: 'Template not found' });
      }

      // Get org info from request context
      const orgId = (request as any).organizationId || 'unknown';
      const orgName = (request as any).organizationName || 'Unknown Organization';

      const published = await templateMarketplaceRepository.create({
        name: template.name,
        description: template.description,
        category: template.category,
        tags: template.tags || null,
        taskCount: template.tasks.length,
        estimatedDays: template.estimatedDurationDays,
        templateData: template,
        publishedByOrgId: orgId,
        publishedByOrgName: orgName,
        publishedByUserId: userId,
      });

      return reply.status(201).send({ marketplaceTemplate: published });
    } catch (error) {
      logger.error('Publish template error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to publish template' });
    }
  });

  // POST /marketplace/:id/import — Import a marketplace template into user's org
  fastify.post('/marketplace/:id/import', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      const mpTemplate = await templateMarketplaceRepository.findById(id);
      if (!mpTemplate || !mpTemplate.templateData) {
        return reply.status(404).send({ error: 'Marketplace template not found' });
      }

      // Create a local copy of the template
      const templateData = mpTemplate.templateData;
      const imported = await templateService.create({
        name: templateData.name || mpTemplate.name,
        description: templateData.description || mpTemplate.description || '',
        projectType: templateData.projectType || 'other',
        category: templateData.category || mpTemplate.category || 'custom',
        isBuiltIn: false,
        createdBy: userId,
        estimatedDurationDays: templateData.estimatedDurationDays || mpTemplate.estimatedDays,
        tasks: templateData.tasks || [],
        tags: templateData.tags || mpTemplate.tags || [],
      });

      // Increment download count
      await templateMarketplaceRepository.incrementDownloadCount(id);

      return reply.status(201).send({ template: imported });
    } catch (error) {
      logger.error('Import marketplace template error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to import template' });
    }
  });
}
