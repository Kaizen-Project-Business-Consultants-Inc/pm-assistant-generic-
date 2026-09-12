import { FastifyInstance } from 'fastify';
import { automationService } from '../../services/automation/AutomationService';
import { automationEventBus } from '../../services/automation/AutomationEventBus';
import { automationAiService } from '../../services/automation/automationAiService';
import { automationSuggestionService } from '../../services/automation/automationSuggestionService';
import { AUTOMATION_EVENT_TYPES } from '../../services/automation/eventTypes';
import { FIELD_CATALOG } from '../../services/automation/fieldCatalog';
import { createAutomationSchema, updateAutomationSchema, testAutomationSchema } from '../../schemas/automationSchemas';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { GOVERNANCE_PACKS } from '../../services/automation/governancePacks';
import { parsePagination } from '../../schemas/paginationSchema';
import type { AutomationEvent } from '../../services/automation/types';

export async function automationRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authMiddleware);

  // GET /projects/:projectId/automations/event-types
  fastify.get('/:projectId/automations/event-types', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async () => {
    return { eventTypes: AUTOMATION_EVENT_TYPES, fieldCatalog: FIELD_CATALOG };
  });

  // GET /projects/:projectId/automations/suggestions
  fastify.get('/:projectId/automations/suggestions', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const user = request.user!;
    const suggestions = await automationSuggestionService.getSuggestions(projectId, user.userId);
    return { suggestions };
  });

  // POST /projects/:projectId/automations/suggestions/:suggestionId/dismiss
  fastify.post('/:projectId/automations/suggestions/:suggestionId/dismiss', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request) => {
    const { projectId, suggestionId } = request.params as { projectId: string; suggestionId: string };
    const user = request.user!;
    await automationSuggestionService.dismiss(user.userId, projectId, suggestionId);
    return { message: 'Suggestion dismissed' };
  });

  // POST /projects/:projectId/automations/suggestions/:suggestionId/apply
  fastify.post('/:projectId/automations/suggestions/:suggestionId/apply', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request, reply) => {
    const { projectId, suggestionId } = request.params as { projectId: string; suggestionId: string };
    const user = request.user!;
    const automationId = await automationSuggestionService.apply(projectId, user.userId, suggestionId);
    if (!automationId) return reply.status(404).send({ error: 'Suggestion not found or already dismissed' });
    return reply.status(201).send({ automationId, message: 'Automation created as draft' });
  });

  // POST /projects/:projectId/automations/ai-generate
  fastify.post('/:projectId/automations/ai-generate', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const { description } = request.body as { description: string };
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      throw Object.assign(new Error('Description is required'), { statusCode: 400 });
    }
    const preview = await automationAiService.generateFromNaturalLanguage(projectId, description.trim());
    return { preview };
  });

  // GET /projects/:projectId/automations
  fastify.get('/:projectId/automations', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const automations = await automationService.findByProject(projectId);
    return { automations };
  });

  // GET /projects/:projectId/automations/:id
  fastify.get('/:projectId/automations/:id', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request, reply) => {
    const { id } = request.params as { projectId: string; id: string };
    const automation = await automationService.findById(id);
    if (!automation) return reply.status(404).send({ error: 'Automation not found' });
    return { automation };
  });

  // POST /projects/:projectId/automations
  fastify.post('/:projectId/automations', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const user = request.user!;
    const body = createAutomationSchema.parse(request.body);
    const automation = await automationService.create(projectId, {
      ...body,
      ownerUserId: user.userId,
    });
    return reply.status(201).send({ automation });
  });

  // PUT /projects/:projectId/automations/:id
  fastify.put('/:projectId/automations/:id', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request, reply) => {
    const { id } = request.params as { projectId: string; id: string };
    const body = updateAutomationSchema.parse(request.body);
    const automation = await automationService.update(id, body);
    if (!automation) return reply.status(404).send({ error: 'Automation not found' });
    return { automation };
  });

  // DELETE /projects/:projectId/automations/:id
  fastify.delete('/:projectId/automations/:id', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request) => {
    const { id } = request.params as { projectId: string; id: string };
    await automationService.delete(id);
    return { message: 'Automation deleted' };
  });

  // POST /projects/:projectId/automations/:id/enable
  fastify.post('/:projectId/automations/:id/enable', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request, reply) => {
    const { id } = request.params as { projectId: string; id: string };
    const automation = await automationService.enable(id);
    return { automation };
  });

  // POST /projects/:projectId/automations/:id/disable
  fastify.post('/:projectId/automations/:id/disable', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request) => {
    const { id } = request.params as { projectId: string; id: string };
    const automation = await automationService.disable(id);
    return { automation };
  });

  // GET /projects/:projectId/automations/:id/executions
  fastify.get('/:projectId/automations/:id/executions', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request) => {
    const { id } = request.params as { projectId: string; id: string };
    const { limit, offset } = parsePagination(request.query as any);
    const { rows, total } = await automationService.getExecutions(id, limit, offset);
    return { executions: rows, total, limit, offset };
  });

  // GET /projects/:projectId/automations/:id/analytics
  fastify.get('/:projectId/automations/:id/analytics', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request) => {
    const { id } = request.params as { projectId: string; id: string };
    const analytics = await automationService.getAnalytics(id);
    return { analytics };
  });

  // GET /projects/:projectId/automations/portfolio
  fastify.get('/:projectId/automations/portfolio', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async () => {
    const automations = await automationService.findPortfolioAutomations();
    return { automations };
  });

  // GET /projects/:projectId/automations/governance-packs
  fastify.get('/:projectId/automations/governance-packs', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async () => {
    return { packs: GOVERNANCE_PACKS };
  });

  // POST /projects/:projectId/automations/governance-packs/:packId/apply
  fastify.post('/:projectId/automations/governance-packs/:packId/apply', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request, reply) => {
    const { projectId, packId } = request.params as { projectId: string; packId: string };
    const user = request.user!;
    const ids = await automationService.applyGovernancePack(projectId, packId, user.userId);
    return reply.status(201).send({ automationIds: ids, message: `Applied ${ids.length} automations from governance pack` });
  });

  // GET /projects/:projectId/automations/marketplace
  fastify.get('/:projectId/automations/marketplace', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request) => {
    const { limit, offset } = parsePagination(request.query as any);
    const { category } = request.query as { category?: string };
    const { automationMarketplaceRepository } = await import('../../database/AutomationMarketplaceRepository');
    const { rows, total } = await automationMarketplaceRepository.findAll(limit, offset, category);
    return { automations: rows, total, limit, offset };
  });

  // POST /projects/:projectId/automations/:id/publish
  fastify.post('/:projectId/automations/:id/publish', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request, reply) => {
    const { id } = request.params as { projectId: string; id: string };
    const user = request.user!;
    // Resolve org info from user record
    const { organizationRepository } = await import('../../database/OrganizationRepository');
    let orgId = 'unknown';
    let orgName = 'Unknown Organization';
    const org = await organizationRepository.findByUserId(user.userId);
    if (org) {
      orgId = org.id;
      orgName = org.name;
    }
    const entry = await automationService.publishToMarketplace(id, orgId, orgName, user.userId);
    return reply.status(201).send({ marketplaceEntry: entry, message: 'Automation published to marketplace' });
  });

  // POST /projects/:projectId/automations/marketplace/:marketplaceId/import
  fastify.post('/:projectId/automations/marketplace/:marketplaceId/import', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request, reply) => {
    const { projectId, marketplaceId } = request.params as { projectId: string; marketplaceId: string };
    const user = request.user!;
    const automation = await automationService.importFromMarketplace(marketplaceId, projectId, user.userId);
    return reply.status(201).send({ automation, message: 'Automation imported as draft' });
  });

  // POST /projects/:projectId/automations/:id/test (dry-run)
  fastify.post('/:projectId/automations/:id/test', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const user = request.user!;
    const body = testAutomationSchema.parse(request.body || {});
    const automation = await automationService.findById(id);
    if (!automation) return reply.status(404).send({ error: 'Automation not found' });

    const event: AutomationEvent = {
      type: automation.triggerEventType,
      entityType: automation.triggerEntityType || 'unknown',
      entityId: body.entityId || 'test-entity',
      projectId,
      userId: user.userId,
      payload: body.eventPayload || {},
      timestamp: new Date().toISOString(),
    };

    const result = await automationEventBus.dryRun(automation, event);
    return { dryRun: result };
  });
}
