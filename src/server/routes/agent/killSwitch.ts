import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { killSwitchService, STOPPABLE_AGENTS } from '../../services/agents/KillSwitchService';

import { platformAdminOnly } from '../../utils/platformAdmin';
import { config } from '../../config';
const toggleKillSwitchSchema = z.object({
  action: z.enum(['enable', 'disable']),
});

const perAgentSchema = z.object({
  disabled: z.boolean(),
});

const perProjectSchema = z.object({
  disabled: z.boolean(),
  // the project's company: project ids repeat across companies (omit on a single-company install)
  companyId: z.string().min(1).optional(),
});

export async function killSwitchRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Get kill switch state — the platform admin only: it lists other companies' stopped projects
  fastify.get('/kill-switch', {
    preHandler: [requireScope('read'), platformAdminOnly],
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
      return { success: true, ...(await killSwitchService.getStatus()) };
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
      if (!(STOPPABLE_AGENTS as readonly string[]).includes(agentId)) {
        return reply.status(400).send({ error: 'Validation error', message: `Unknown agent. Agents that can be stopped: ${STOPPABLE_AGENTS.join(', ')}` });
      }
      const { disabled } = perAgentSchema.parse(request.body);
      const userId = request.user?.userId ?? 'unknown';
      await killSwitchService.setAgentDisabled(agentId, disabled, userId);
      return { success: true, ...(await killSwitchService.getStatus()) };
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
      const { disabled, companyId } = perProjectSchema.parse(request.body);
      // with several companies the stop is checked as company:project, so without the company it
      // would be saved yet never apply — an emergency stop must not quietly do nothing
      if (config.MULTI_TENANT_ENABLED && !companyId) {
        return reply.status(400).send({ error: 'Validation error', message: "Give the project's companyId: project ids repeat across companies." });
      }
      const userId = request.user?.userId ?? 'unknown';
      await killSwitchService.setProjectDisabled(companyId ?? null, projectId, disabled, userId);
      return { success: true, ...(await killSwitchService.getStatus()) };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      throw error;
    }
  });
}
