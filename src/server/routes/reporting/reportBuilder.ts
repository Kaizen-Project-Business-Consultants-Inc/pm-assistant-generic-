import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { reportBuilderService } from '../../services/ReportBuilderService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { readableProjectIds } from '../../utils/readableProjects';
import { requireFeature, hasFeature } from '../../middleware/requireTier';
import logger from '../../utils/logger';
import { sendValidationError } from '../../utils/validationError';
import { heavyActionLimit } from '../../middleware/rateLimiter';
import { reportSectionSchema, MAX_DRAFT_SECTIONS, GROUP_BY_CHOICES } from '../../services/reportBuilder/reportSections';
import { draftReportFromWords, MAX_REQUEST_CHARS } from '../../services/reportBuilder/reportFromWords';
import { AIBudgetExceededError } from '../../services/AIBudgetService';
import { AIPromptTooLargeError, isAIUnavailableError } from '../../services/claudeService';

/** Who builds reports (the Report Builder page is shown to these roles only — roleRoutes NON_VIEWER_ROLES) */
const REPORT_BUILDER_ROLES = ['admin', 'executive', 'project_manager', 'pmo'];

const draftSchema = z.object({
  request: z.string().trim().min(1, 'Say what the report should show.').max(MAX_REQUEST_CHARS, `Keep it under ${MAX_REQUEST_CHARS} characters.`),
  /** "Change it by typing": the draft as it is now */
  current: z.array(reportSectionSchema).max(MAX_DRAFT_SECTIONS).optional(),
});

const previewSchema = z.object({
  sections: z.array(reportSectionSchema).min(1).max(MAX_DRAFT_SECTIONS),
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
      // whether "Describe the report you want" is shown: hidden, not refused, where it can't run
      const canDraft = REPORT_BUILDER_ROLES.includes(user.role) && await hasFeature(request, 'ai_assistant');
      return { templates, canDraft };
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

  // POST /draft — turn typed words into a draft report (not saved): one AI call (2026-10-20)
  fastify.post('/draft', { preHandler: [requireScope('write'), requireFeature('reports'), requireFeature('ai_assistant'), heavyActionLimit('report-draft', 30)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!REPORT_BUILDER_ROLES.includes(user.role)) return reply.status(403).send({ error: 'Insufficient role', message: 'Only a project manager, PMO or executive can build reports.' });
      const body = draftSchema.parse(request.body);
      const draft = await draftReportFromWords(body.request, body.current, user);
      return { draft };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error instanceof AIBudgetExceededError || error instanceof AIPromptTooLargeError) {
        return reply.status((error as { statusCode?: number }).statusCode ?? 402).send({ error: 'AI unavailable', message: error.message });
      }
      if (isAIUnavailableError(error)) return reply.status(503).send({ error: 'AI unavailable', message: 'The AI is not available right now. Try again in a few minutes, or build the report by hand.' });
      logger.error('Draft report error', { error });
      return reply.status(500).send({ error: 'Failed to draft report', message: 'The draft could not be made. Try again, or build the report by hand.' });
    }
  });

  // POST /preview — run sections that are not saved yet (a draft), limited to what this person may read
  fastify.post('/preview', { preHandler: [requireScope('write'), requireFeature('reports'), heavyActionLimit('report-preview', 60)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!REPORT_BUILDER_ROLES.includes(user.role)) return reply.status(403).send({ error: 'Insufficient role', message: 'Only a project manager, PMO or executive can build reports.' });
      const { sections } = previewSchema.parse(request.body);
      // a grouping the builder doesn't offer would fall back to a column the source may not have
      const badGroup = sections.find(s => s.groupBy && !GROUP_BY_CHOICES[s.dataSource].includes(s.groupBy));
      if (badGroup) return reply.status(400).send({ error: 'Validation error', message: `"${badGroup.title ?? 'A section'}" can't be grouped by ${badGroup.groupBy}.` });
      const report = await reportBuilderService.generateSections(sections, undefined, await readableProjectIds(user));
      return { report };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      logger.error('Preview report error', { error });
      return reply.status(500).send({ error: 'Failed to preview report' });
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
