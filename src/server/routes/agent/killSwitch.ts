import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { killSwitchService } from '../../services/agents/KillSwitchService';

import { platformAdminOnly } from '../../utils/platformAdmin';
const toggleKillSwitchSchema = z.object({
  action: z.enum(['enable', 'disable']),
});

const perAgentSchema = z.object({
  disabled: z.boolean(),
});

const perProjectSchema = z.object({
  disabled: z.boolean(),
});

export async function killSwitchRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Get kill switch state
  fastify.get('/kill-switch', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get agent kill switch state', tags: ['agent'] },
  }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    return killSwitchService.getStatus();
  });

  // Toggle global kill switch
  fastify.post('/kill-switch', {
    preHandler: [requireScope('admin'), platformAdminOnly],
    schema: { description: 'Toggle global agent kill switch (admin only)', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { action } = toggleKillSwitchSchema.parse(request.body);
      const userId = request.user?.userId ?? 'unknown';
      await killSwitchService.setGlobalKillSwitch(action, userId);
      return { success: true, ...killSwitchService.getStatus() };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      throw error;
    }
  });

  // Toggle per-agent kill switch
  fastify.put('/kill-switch/agent/:agentId', {
    preHandler: [requireScope('admin'), platformAdminOnly],
    schema: { description: 'Toggle per-agent kill switch (admin only)', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId } = request.params as { agentId: string };
      const { disabled } = perAgentSchema.parse(request.body);
      const userId = request.user?.userId ?? 'unknown';
      await killSwitchService.setAgentDisabled(agentId, disabled, userId);
      return { success: true, ...killSwitchService.getStatus() };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      throw error;
    }
  });

  // Toggle per-project kill switch
  fastify.put('/kill-switch/project/:projectId', {
    preHandler: [requireScope('admin'), platformAdminOnly],
    schema: { description: 'Toggle per-project kill switch (admin only)', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { disabled } = perProjectSchema.parse(request.body);
      const userId = request.user?.userId ?? 'unknown';
      await killSwitchService.setProjectDisabled(projectId, disabled, userId);
      return { success: true, ...killSwitchService.getStatus() };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      throw error;
    }
  });
}
