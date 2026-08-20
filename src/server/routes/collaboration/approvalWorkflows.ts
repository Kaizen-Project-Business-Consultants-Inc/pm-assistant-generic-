import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { approvalWorkflowService } from '../../services/ApprovalWorkflowService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { webhookService } from '../../services/WebhookService';
import { projectMemberService } from '../../services/ProjectMemberService';
import logger from '../../utils/logger';

const workflowStepSchema = z.object({
  name: z.string().min(1),
  approverRole: z.string().min(1),
  order: z.number().int().min(0),
});

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  entityType: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1),
  isActive: z.boolean().optional(),
});

const updateWorkflowSchema = createWorkflowSchema.partial();

const VALID_CATEGORIES = ['scope', 'schedule', 'budget', 'resource', 'other'] as const;

const createChangeRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.enum(VALID_CATEGORIES),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  impactSummary: z.string().max(2000).optional(),
});

const updateChangeRequestSchema = createChangeRequestSchema.partial();

const submitForApprovalSchema = z.object({
  workflowId: z.string().min(1),
});

const actOnStepSchema = z.object({
  action: z.enum(['approve', 'reject', 'return', 'approved', 'rejected', 'returned']),
  comment: z.string().max(2000).optional(),
});

/** Verify the user has project access for a CR-scoped endpoint (where :id is a CR id, not a projectId). */
async function requireCRProjectAccess(request: FastifyRequest, reply: FastifyReply, minRole: 'viewer' | 'editor' = 'viewer') {
  const user = request.user!;
  const { id } = request.params as { id: string };
  const detail = await approvalWorkflowService.getChangeRequestDetail(id).catch(() => null);
  if (!detail) return reply.status(404).send({ error: 'Change request not found' });

  // Global roles bypass
  if (['admin', 'pmo'].includes(user.role)) return;
  if (user.role === 'executive' && minRole === 'viewer') return;

  const membership = await projectMemberService.findMembership(detail.changeRequest.projectId, user.userId);
  if (!membership) return reply.status(404).send({ error: 'Not found' });

  const hierarchy: Record<string, number> = { owner: 4, manager: 3, editor: 2, viewer: 1 };
  if ((hierarchy[membership.role] || 0) < (hierarchy[minRole] || 0)) {
    return reply.status(403).send({ error: 'Insufficient project role' });
  }
}

export async function approvalWorkflowRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /workflows/:projectId — create workflow
  fastify.post('/workflows/:projectId', { preHandler: [requireScope('write'), requireProjectAccess('editor')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { projectId } = request.params as { projectId: string };
      const body = createWorkflowSchema.parse(request.body);
      const workflow = await approvalWorkflowService.createWorkflow(projectId, { ...body, createdBy: user.userId });
      return reply.status(201).send({ workflow });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Create workflow error', { error });
      return reply.status(500).send({ error: 'Failed to create workflow' });
    }
  });

  // GET /workflows/:projectId — list workflows
  fastify.get('/workflows/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const workflows = await approvalWorkflowService.getWorkflows(projectId);
      return { workflows };
    } catch (error) {
      logger.error('Get workflows error', { error });
      return reply.status(500).send({ error: 'Failed to fetch workflows' });
    }
  });

  // PUT /workflows/:id — update workflow
  fastify.put('/workflows/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateWorkflowSchema.parse(request.body);
      const workflow = await approvalWorkflowService.updateWorkflow(id, body);
      return { workflow };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update workflow error', { error });
      return reply.status(500).send({ error: 'Failed to update workflow' });
    }
  });

  // DELETE /workflows/:id — delete workflow
  fastify.delete('/workflows/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await approvalWorkflowService.deleteWorkflow(id);
      return { message: 'Workflow deleted' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Cannot delete')) return reply.status(409).send({ error: msg });
      logger.error('Delete workflow error', { error });
      return reply.status(500).send({ error: 'Failed to delete workflow' });
    }
  });

  // POST /change-requests/:projectId — create change request
  fastify.post('/change-requests/:projectId', { preHandler: [requireScope('write'), requireProjectAccess('editor')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { projectId } = request.params as { projectId: string };
      const body = createChangeRequestSchema.parse(request.body);
      const changeRequest = await approvalWorkflowService.createChangeRequest(projectId, { ...body, requestedBy: user.userId });
      webhookService.dispatch('change_request.created', { changeRequest, projectId }, user.userId);
      return reply.status(201).send({ changeRequest });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Create change request error', { error });
      return reply.status(500).send({ error: 'Failed to create change request' });
    }
  });

  // GET /change-requests/:projectId — list change requests
  fastify.get('/change-requests/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { status, priority, sortBy, sortDir } = request.query as { status?: string; priority?: string; sortBy?: string; sortDir?: string };
      const changeRequests = await approvalWorkflowService.getChangeRequests(projectId, { status, priority, sortBy, sortDir });
      return { changeRequests };
    } catch (error) {
      logger.error('Get change requests error', { error });
      return reply.status(500).send({ error: 'Failed to fetch change requests' });
    }
  });

  // GET /change-requests/:id/detail — get change request detail
  fastify.get('/change-requests/:id/detail', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await requireCRProjectAccess(request, reply, 'viewer');
      if (reply.sent) return;
      const { id } = request.params as { id: string };
      const detail = await approvalWorkflowService.getChangeRequestDetail(id);
      return detail;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) return reply.status(404).send({ error: msg });
      logger.error('Get change request detail error', { error });
      return reply.status(500).send({ error: 'Failed to fetch change request detail' });
    }
  });

  // PUT /change-requests/:id — update draft change request
  fastify.put('/change-requests/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = updateChangeRequestSchema.parse(request.body);
      const changeRequest = await approvalWorkflowService.updateChangeRequest(id, body, user.userId);
      return { changeRequest };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) return reply.status(404).send({ error: msg });
      if (msg.includes('Only draft')) return reply.status(409).send({ error: msg });
      logger.error('Update change request error', { error });
      return reply.status(500).send({ error: 'Failed to update change request' });
    }
  });

  // DELETE /change-requests/:id — delete draft change request
  fastify.delete('/change-requests/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      await approvalWorkflowService.deleteChangeRequest(id, user.userId);
      return { message: 'Change request deleted' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) return reply.status(404).send({ error: msg });
      if (msg.includes('Only draft')) return reply.status(409).send({ error: msg });
      logger.error('Delete change request error', { error });
      return reply.status(500).send({ error: 'Failed to delete change request' });
    }
  });

  // POST /change-requests/:id/submit — submit for approval
  fastify.post('/change-requests/:id/submit', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await requireCRProjectAccess(request, reply, 'editor');
      if (reply.sent) return;
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { workflowId } = submitForApprovalSchema.parse(request.body);
      const result = await approvalWorkflowService.submitForApproval(id, workflowId, user.userId);
      return { result };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Only draft')) return reply.status(409).send({ error: msg });
      logger.error('Submit for approval error', { error });
      return reply.status(500).send({ error: 'Failed to submit for approval' });
    }
  });

  // POST /change-requests/:id/action — act on step
  fastify.post('/change-requests/:id/action', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await requireCRProjectAccess(request, reply, 'editor');
      if (reply.sent) return;
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { action, comment } = actOnStepSchema.parse(request.body);
      const result = await approvalWorkflowService.actOnStep(id, user.userId, action, comment, user.role);
      const eventMap: Record<string, string> = {
        approve: 'change_request.approved', approved: 'change_request.approved',
        reject: 'change_request.rejected', rejected: 'change_request.rejected',
        return: 'change_request.returned', returned: 'change_request.returned',
      };
      const eventName = eventMap[action] || 'change_request.updated';
      webhookService.dispatch(eventName, { changeRequestId: id, action, comment }, user.userId);
      return { result };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not awaiting') || msg.includes('requires role')) return reply.status(409).send({ error: msg });
      logger.error('Act on step error', { error });
      return reply.status(500).send({ error: 'Failed to process action' });
    }
  });

  // POST /change-requests/:id/withdraw — withdraw change request
  fastify.post('/change-requests/:id/withdraw', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await requireCRProjectAccess(request, reply, 'editor');
      if (reply.sent) return;
      const user = request.user!;
      const { id } = request.params as { id: string };
      const result = await approvalWorkflowService.withdrawChangeRequest(id, user.userId);
      webhookService.dispatch('change_request.withdrawn', { changeRequestId: id }, user.userId);
      return { result };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) return reply.status(404).send({ error: msg });
      if (msg.includes('Only pending')) return reply.status(409).send({ error: msg });
      logger.error('Withdraw change request error', { error });
      return reply.status(500).send({ error: 'Failed to withdraw change request' });
    }
  });
}
