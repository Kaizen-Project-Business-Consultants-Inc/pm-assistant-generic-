// C:\Users\gerog\Documents\pm-assistant-generic\src\server\routes\alerts.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { proactiveAlertService } from '../../services/proactiveAlertService';
import { AIActionExecutor } from '../../services/aiActionExecutor';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const executeActionSchema = z.object({
  toolName: z.string().min(1),
  params: z.record(z.string(), z.any()),
});

export async function alertRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const actionExecutor = new AIActionExecutor();

  // GET / — Get all proactive alerts
  fastify.get('/', {
    preHandler: [requireScope('read')],
    schema: {
      description: 'Get all proactive alerts across projects',
      tags: ['alerts'],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const alerts = await proactiveAlertService.generateAlerts(request.user!);
        return { alerts, count: alerts.length };
      } catch (error) {
        logger.error('Failed to generate alerts', { error });
        return reply.status(500).send({ error: 'Failed to generate alerts' });
      }
    },
  });

  // GET /summary — Get alert summary counts
  fastify.get('/summary', {
    preHandler: [requireScope('read')],
    schema: {
      description: 'Get alert summary with counts by severity and type',
      tags: ['alerts'],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const summary = await proactiveAlertService.getAlertsSummary(request.user!);
        return summary;
      } catch (error) {
        logger.error('Failed to get alert summary', { error });
        return reply.status(500).send({ error: 'Failed to get alert summary' });
      }
    },
  });

  // GET /project/:projectId — Get alerts for a specific project
  fastify.get('/project/:projectId', {
    preHandler: [requireScope('read')],
    schema: {
      description: 'Get alerts for a specific project',
      tags: ['alerts'],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { projectId } = request.params as { projectId: string };
        const alerts = await proactiveAlertService.getAlertsByProject(projectId);
        return { alerts, count: alerts.length };
      } catch (error) {
        logger.error('Failed to get project alerts', { error });
        return reply.status(500).send({ error: 'Failed to get project alerts' });
      }
    },
  });

  // POST /execute-action — Execute a suggested action from an alert
  // project check: AIActionExecutor.checkProjectWrite → checkProjectRoleFor (Manager/Owner)
  fastify.post('/execute-action', {
    preHandler: [requireScope('write')],
    schema: {
      description: 'Execute a suggested action from a proactive alert',
      tags: ['alerts'],
      body: {
        type: 'object',
        required: ['toolName', 'params'],
        properties: {
          toolName: { type: 'string' },
          params: { type: 'object' },
        },
      },
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { toolName, params } = executeActionSchema.parse(request.body);
        const user = request.user!;

        const result = await actionExecutor.execute(toolName, params, {
          userId: user.userId,
          userRole: user.role || 'team_member',
        });

        return result;
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation error', details: error.issues });
        fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Alert action execution failed');
        return reply.code(500).send({
          error: 'Failed to execute action',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  });
}
