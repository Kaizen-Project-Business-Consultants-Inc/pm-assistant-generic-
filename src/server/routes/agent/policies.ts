import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { policyEngineService } from '../../services/PolicyEngineService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

import { platformAdminOnly } from '../../utils/platformAdmin';
import { checkProjectRole } from '../../middleware/requireProjectAccess';

/** A `?projectId=` filter is that project's data: anyone on the project (2026-10-09 audit, low) */
async function queryProjectViewer(request: FastifyRequest, reply: FastifyReply) {
  const { projectId } = (request.query ?? {}) as { projectId?: string };
  if (!projectId) return;
  const d = await checkProjectRole(request, projectId, 'viewer');
  if (!d.ok) return reply.status(d.status).send(d.body);
}

const createPolicySchema = z.object({
  projectId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional(),
  actionPattern: z.string().min(1),
  conditionExpr: z.object({
    field: z.string(),
    op: z.enum(['>', '<', '>=', '<=', '==', '!=', 'in', 'not_in', 'contains']),
    value: z.any(),
  }),
  enforcement: z.enum(['log_only', 'require_approval', 'block']),
});

const updatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  actionPattern: z.string().min(1).optional(),
  conditionExpr: z.object({
    field: z.string(),
    op: z.enum(['>', '<', '>=', '<=', '==', '!=', 'in', 'not_in', 'contains']),
    value: z.any(),
  }).optional(),
  enforcement: z.enum(['log_only', 'require_approval', 'block']).optional(),
  isActive: z.boolean().optional(),
});

export async function policyRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/policies
  fastify.get('/', {
    preHandler: [requireScope('read'), queryProjectViewer],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.query as { projectId?: string };
      const policies = projectId
        ? await policyEngineService.getProjectPolicies(projectId)
        : await policyEngineService.getAllPolicies();
      return { policies };
    } catch (error) {
      logger.error('Get policies error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/policies/:id
  fastify.get('/:id', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const policy = await policyEngineService.getPolicyById(id);
      if (!policy) {
        return reply.status(404).send({ error: 'Policy not found' });
      }
      return { policy };
    } catch (error) {
      logger.error('Get policy error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/policies
  fastify.post('/', {
    preHandler: [requireScope('admin'), platformAdminOnly],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = createPolicySchema.parse(request.body);
      const userId = request.user!.userId;
      const policy = await policyEngineService.createPolicy({
        ...data,
        createdBy: userId,
      });
      return reply.status(201).send({ policy });
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Create policy error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PUT /api/v1/policies/:id
  fastify.put('/:id', {
    preHandler: [requireScope('admin'), platformAdminOnly],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = updatePolicySchema.parse(request.body);
      const policy = await policyEngineService.updatePolicy(id, data);
      if (!policy) {
        return reply.status(404).send({ error: 'Policy not found' });
      }
      return { policy };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Update policy error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /api/v1/policies/:id
  fastify.delete('/:id', {
    preHandler: [requireScope('admin'), platformAdminOnly],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await policyEngineService.deletePolicy(id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Policy not found' });
      }
      return { message: 'Policy deleted' };
    } catch (error) {
      logger.error('Delete policy error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/policies/stats
  fastify.get('/evaluations/stats', {
    preHandler: [requireScope('read'), queryProjectViewer],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, since } = request.query as { projectId?: string; since?: string };
      const stats = await policyEngineService.getEvaluationStats(projectId, since);
      return { stats };
    } catch (error) {
      logger.error('Get policy stats error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
