import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { agentScheduler } from '../../services/AgentSchedulerService';
import { agentRepository } from '../../database/AgentRepository';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import logger from '../../utils/logger';

const updateAgentSchema = z.object({
  isEnabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /registry — list all registered agents
  fastify.get('/registry', {
    preHandler: [requireScope('read')],
    schema: { description: 'List all registered agents', tags: ['agent'] },
  }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    const agents = await agentRepository.findAll();
    return { agents };
  });

  // GET /registry/:id — get a single agent
  fastify.get('/registry/:id', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get agent details by ID', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const agent = await agentRepository.findById(id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    return { agent };
  });

  // PATCH /registry/:id — update agent (enable/disable, config)
  fastify.patch('/registry/:id', {
    preHandler: [requireScope('admin')],
    schema: { description: 'Update agent configuration', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = updateAgentSchema.parse(request.body);

    const agent = await agentRepository.findById(id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    if (body.isEnabled !== undefined) {
      await agentRepository.setEnabled(id, body.isEnabled);
    }
    if (body.config !== undefined) {
      await agentRepository.updateConfig(id, body.config);
    }

    const updated = await agentRepository.findById(id);
    return { agent: updated };
  });

  // POST /trigger — manually trigger an agent scan
  // With projectId: requires write scope + project manager access
  // Without projectId: requires admin scope (full portfolio scan)
  fastify.post('/trigger', {
    schema: { description: 'Manually trigger an agent scan (optionally scoped to a project)', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = z.object({ projectId: z.string().optional() }).parse(request.body ?? {});

    if (body.projectId) {
      // Per-project scan: write scope + project manager access
      await requireScope('write')(request, reply);
      if (reply.sent) return;
      await requireProjectAccess('manager')(request, reply);
      if (reply.sent) return;
    } else {
      // Full portfolio scan: admin only
      await requireScope('admin')(request, reply);
      if (reply.sent) return;
    }

    try {
      const stats = await agentScheduler.runScan(body.projectId);
      return { message: 'Agent scan completed', stats };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Agent trigger error:', error);
      return reply.status(500).send({ error: 'Agent scan failed' });
    }
  });
}
