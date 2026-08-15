import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dagWorkflowService } from '../../services/DagWorkflowService';
import { scheduleService } from '../../services/ScheduleService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';
import { claudeService } from '../../services/claudeService';
import { workflowGenerateRequestSchema, workflowGenerationOutputSchema, WORKFLOW_GENERATION_SYSTEM_PROMPT } from '../../schemas/workflowGenerationSchemas';
import logger from '../../utils/logger';

// ── Zod schemas ────────────────────────────────────────────────────────────

const nodeSchema = z.object({
  nodeType: z.enum(['trigger', 'condition', 'action', 'approval', 'delay', 'agent']),
  name: z.string().min(1),
  config: z.record(z.string(), z.any()),
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
});

const edgeSchema = z.object({
  sourceIndex: z.number().int().min(0),
  targetIndex: z.number().int().min(0),
  conditionExpr: z.record(z.string(), z.any()).optional(),
  label: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const createDefinitionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  projectId: z.string().optional().nullable(),
  nodes: z.array(nodeSchema).min(1),
  edges: z.array(edgeSchema),
});

const updateDefinitionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  projectId: z.string().optional().nullable(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
});

const triggerSchema = z.object({
  entityType: z.string().default('task'),
  entityId: z.string().min(1),
});

const resumeSchema = z.object({
  nodeId: z.string().min(1),
  result: z.record(z.string(), z.any()).default({}),
});

// ── Routes ─────────────────────────────────────────────────────────────────

export async function workflowRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /api/v1/workflows/generate — AI-generate workflow from natural language
  fastify.post('/generate', {
    preHandler: [requireScope('write'), requireFeature('workflows')],
    schema: { description: 'Generate a workflow definition from natural language', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { description, projectId } = workflowGenerateRequestSchema.parse(request.body);
      const user = request.user!;

      const result = await claudeService.completeWithJsonSchema({
        systemPrompt: WORKFLOW_GENERATION_SYSTEM_PROMPT,
        userMessage: description,
        schema: workflowGenerationOutputSchema,
        maxTokens: 2000,
        temperature: 0.7,
        userId: user.userId,
      });

      const workflow = result.data;

      // Validate edge indices are within bounds
      for (const edge of workflow.edges) {
        if (edge.sourceIndex >= workflow.nodes.length || edge.targetIndex >= workflow.nodes.length) {
          return reply.status(422).send({ error: 'AI generated invalid edge indices. Please try again.' });
        }
      }

      // Validate first node is a trigger
      if (workflow.nodes.length > 0 && workflow.nodes[0].nodeType !== 'trigger') {
        return reply.status(422).send({ error: 'AI generated workflow without trigger as first node. Please try again.' });
      }

      return { workflow: { ...workflow, projectId } };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      logger.error('Generate workflow error', { error });
      return reply.status(500).send({ error: 'Failed to generate workflow' });
    }
  });

  // GET /api/v1/workflows — list definitions
  // Trial users get sample workflow definitions with an upgrade prompt.
  fastify.get('/', {
    preHandler: [requireScope('read')],
    schema: { description: 'List workflow definitions', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Trial users get sample workflows
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(request.user!.userId);
        if (user && user.subscriptionTier === 'trial') {
          return { definitions: generateSampleWorkflows(), sample: true };
        }
      }

      const { projectId } = request.query as { projectId?: string };
      const definitions = await dagWorkflowService.listDefinitions(projectId);
      return { definitions };
    } catch (error) {
      logger.error('List workflows error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/workflows/:id — get definition with nodes + edges
  fastify.get('/:id', {
    preHandler: [requireScope('read'), requireFeature('workflows')],
    schema: { description: 'Get workflow definition with graph', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const definition = await dagWorkflowService.getDefinition(id);
      if (!definition) return reply.status(404).send({ error: 'Workflow not found' });
      return { definition };
    } catch (error) {
      logger.error('Get workflow error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/workflows — create definition
  fastify.post('/', {
    preHandler: [requireScope('write'), requireFeature('workflows')],
    schema: { description: 'Create a workflow definition', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const data = createDefinitionSchema.parse(request.body);
      const definition = await dagWorkflowService.createDefinition({
        ...data,
        createdBy: user.userId,
      });
      return reply.status(201).send({ definition });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      logger.error('Create workflow error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PUT /api/v1/workflows/:id — update definition
  fastify.put('/:id', {
    preHandler: [requireScope('write'), requireFeature('workflows')],
    schema: { description: 'Update a workflow definition', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = updateDefinitionSchema.parse(request.body);
      const definition = await dagWorkflowService.updateDefinition(id, data);
      if (!definition) return reply.status(404).send({ error: 'Workflow not found' });
      return { definition };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      logger.error('Update workflow error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /api/v1/workflows/:id — delete definition
  fastify.delete('/:id', {
    preHandler: [requireScope('write'), requireFeature('workflows')],
    schema: { description: 'Delete a workflow definition', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await dagWorkflowService.deleteDefinition(id);
      if (!deleted) return reply.status(404).send({ error: 'Workflow not found' });
      return { message: 'Workflow deleted' };
    } catch (error) {
      logger.error('Delete workflow error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /api/v1/workflows/:id/toggle — enable/disable
  fastify.patch('/:id/toggle', {
    preHandler: [requireScope('write'), requireFeature('workflows')],
    schema: { description: 'Toggle workflow enabled/disabled', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { enabled } = (request.body as { enabled: boolean }) || {};
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ error: 'enabled (boolean) is required' });
      }
      const definition = await dagWorkflowService.toggleEnabled(id, enabled);
      if (!definition) return reply.status(404).send({ error: 'Workflow not found' });
      return { definition };
    } catch (error) {
      logger.error('Toggle workflow error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/workflows/:id/trigger — manual trigger
  fastify.post('/:id/trigger', {
    preHandler: [requireScope('write'), requireFeature('workflows')],
    schema: { description: 'Manually trigger a workflow', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = triggerSchema.parse(request.body);
      const execution = await dagWorkflowService.triggerManual(id, data.entityType, data.entityId, scheduleService);
      if (!execution) return reply.status(404).send({ error: 'Workflow not found or no trigger node' });
      return reply.status(201).send({ execution });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      logger.error('Trigger workflow error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/workflows/executions — list executions
  fastify.get('/executions', {
    preHandler: [requireScope('read'), requireFeature('workflows')],
    schema: { description: 'List workflow executions', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { workflowId, entityType, entityId, status, limit } = request.query as Record<string, string>;
      const executions = await dagWorkflowService.listExecutions({
        workflowId, entityType, entityId, status,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return { executions };
    } catch (error) {
      logger.error('List executions error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/workflows/executions/:id — get execution detail
  fastify.get('/executions/:id', {
    preHandler: [requireScope('read'), requireFeature('workflows')],
    schema: { description: 'Get workflow execution details', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const execution = await dagWorkflowService.getExecution(id);
      if (!execution) return reply.status(404).send({ error: 'Execution not found' });
      return { execution };
    } catch (error) {
      logger.error('Get execution error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/workflows/executions/:id/resume — resume waiting execution
  fastify.post('/executions/:id/resume', {
    preHandler: [requireScope('write'), requireFeature('workflows')],
    schema: { description: 'Resume a waiting workflow execution', tags: ['workflows'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = resumeSchema.parse(request.body);
      const execution = await dagWorkflowService.resumeExecution(id, data.nodeId, data.result, scheduleService);
      if (!execution) return reply.status(404).send({ error: 'Execution not found or not in waiting state' });
      return { execution };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      logger.error('Resume execution error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

function generateSampleWorkflows() {
  return [
    {
      id: 'sample-wf-1',
      name: 'Task Status Change Notification',
      description: 'Sends notifications when critical tasks change status. Includes an approval gate for high-priority changes.',
      isEnabled: true,
      version: 1,
      createdBy: 'demo',
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
    {
      id: 'sample-wf-2',
      name: 'Overdue Task Escalation',
      description: 'Automatically escalates tasks that are more than 5 days overdue. Notifies the project manager and logs the escalation.',
      isEnabled: true,
      version: 2,
      createdBy: 'demo',
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    },
    {
      id: 'sample-wf-3',
      name: 'Budget Threshold Alert',
      description: 'Triggers when project spending exceeds 80% of allocated budget. Routes approval through finance officer.',
      isEnabled: false,
      version: 1,
      createdBy: 'demo',
      createdAt: new Date(Date.now() - 21 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 21 * 86400000).toISOString(),
    },
  ];
}
