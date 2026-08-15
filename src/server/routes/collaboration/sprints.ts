import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sprintService } from '../../services/SprintService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { webhookService } from '../../services/WebhookService';
import { slackEventDispatcher } from '../../services/integrations/SlackEventDispatcher';
import { paginate } from '../../dto/responses';
import { parsePagination } from '../../schemas/paginationSchema';
import logger from '../../utils/logger';

const createSprintSchema = z.object({
  projectId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  name: z.string().min(1).max(200),
  goal: z.string().max(2000).optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  velocityCommitment: z.number().int().positive().optional(),
});

const updateSprintSchema = createSprintSchema.omit({ projectId: true, scheduleId: true }).partial();

export async function sprintRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST / — create sprint
  fastify.post('/', { preHandler: [requireScope('write'), requireProjectAccess('editor')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = createSprintSchema.parse(request.body);
      const sprint = await sprintService.create(body.projectId, body.scheduleId, body, user.userId);
      webhookService.dispatch('sprint.created', { sprint }, user.userId);
      return reply.status(201).send({ sprint });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Create sprint error', { error });
      return reply.status(500).send({ error: 'Failed to create sprint' });
    }
  });

  // GET /project/:projectId — list sprints by project
  fastify.get('/project/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { limit, offset } = parsePagination(request.query as Record<string, unknown>);
      const { rows, total } = await sprintService.getByProjectPaginated(projectId, limit, offset);
      const sprintIds = rows.map((s) => s.id);
      const taskStats = sprintIds.length > 0 ? await sprintService.getTaskStatsBySprintIds(sprintIds) : {};
      const enriched = rows.map((s) => ({
        ...s,
        taskStats: taskStats[s.id] || { totalTasks: 0, completedTasks: 0, totalPoints: 0, completedPoints: 0 },
      }));
      const page = Math.floor(offset / limit) + 1;
      return paginate(enriched, total, page, limit);
    } catch (error) {
      logger.error('Get sprints error', { error });
      return reply.status(500).send({ error: 'Failed to fetch sprints' });
    }
  });

  // GET /:id — get sprint by id
  fastify.get('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const sprint = await sprintService.getById(id);
      if (!sprint) return reply.status(404).send({ error: 'Not found', message: 'Sprint not found' });
      return { sprint };
    } catch (error) {
      logger.error('Get sprint error', { error });
      return reply.status(500).send({ error: 'Failed to fetch sprint' });
    }
  });

  // PUT /:id — update sprint
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateSprintSchema.parse(request.body);
      const sprint = await sprintService.update(id, body);
      return { sprint };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update sprint error', { error });
      return reply.status(500).send({ error: 'Failed to update sprint' });
    }
  });

  // DELETE /:id — delete sprint
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await sprintService.delete(id);
      return { message: 'Sprint deleted' };
    } catch (error) {
      logger.error('Delete sprint error', { error });
      return reply.status(500).send({ error: 'Failed to delete sprint' });
    }
  });

  // POST /:id/tasks — add task to sprint
  fastify.post('/:id/tasks', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { taskId, storyPoints } = request.body as { taskId: string; storyPoints?: number };
      const result = await sprintService.addTask(id, taskId, storyPoints);
      return reply.status(201).send({ result });
    } catch (error) {
      logger.error('Add task to sprint error', { error });
      return reply.status(500).send({ error: 'Failed to add task to sprint' });
    }
  });

  // DELETE /:id/tasks/:taskId — remove task from sprint
  fastify.delete('/:id/tasks/:taskId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, taskId } = request.params as { id: string; taskId: string };
      await sprintService.removeTask(id, taskId);
      return { message: 'Task removed from sprint' };
    } catch (error) {
      logger.error('Remove task from sprint error', { error });
      return reply.status(500).send({ error: 'Failed to remove task from sprint' });
    }
  });

  // POST /:id/start — start sprint
  fastify.post('/:id/start', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const sprint = await sprintService.startSprint(id);
      webhookService.dispatch('sprint.started', { sprint }, request.user!.userId);
      slackEventDispatcher.dispatchToSlack('sprint.started', { sprint }, sprint.projectId);
      return { sprint };
    } catch (error) {
      logger.error('Start sprint error', { error });
      return reply.status(500).send({ error: 'Failed to start sprint' });
    }
  });

  // POST /:id/complete — complete sprint
  fastify.post('/:id/complete', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const sprint = await sprintService.completeSprint(id);
      webhookService.dispatch('sprint.completed', { sprint }, request.user!.userId);
      slackEventDispatcher.dispatchToSlack('sprint.completed', { sprint }, sprint.projectId);
      return { sprint };
    } catch (error) {
      logger.error('Complete sprint error', { error });
      return reply.status(500).send({ error: 'Failed to complete sprint' });
    }
  });

  // GET /:id/board — sprint board
  fastify.get('/:id/board', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const sprint = await sprintService.getById(id);
      if (!sprint) return reply.status(404).send({ error: 'Not found', message: 'Sprint not found' });
      const board = await sprintService.getSprintBoard(id);
      return { board };
    } catch (error) {
      logger.error('Get sprint board error', { error });
      return reply.status(500).send({ error: 'Failed to fetch sprint board' });
    }
  });

  // GET /:id/burndown — sprint burndown
  fastify.get('/:id/burndown', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const sprint = await sprintService.getById(id);
      if (!sprint) return reply.status(404).send({ error: 'Not found', message: 'Sprint not found' });
      const burndown = await sprintService.getSprintBurndown(id);
      return { burndown };
    } catch (error) {
      logger.error('Get sprint burndown error', { error });
      return reply.status(500).send({ error: 'Failed to fetch sprint burndown' });
    }
  });

  // GET /backlog/:scheduleId — tasks not assigned to any sprint
  fastify.get('/backlog/:scheduleId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const tasks = await sprintService.getBacklogTasks(scheduleId);
      return { tasks };
    } catch (error) {
      logger.error('Get backlog tasks error', { error });
      return reply.status(500).send({ error: 'Failed to fetch backlog tasks' });
    }
  });

  // POST /:id/retrospective — AI-generated sprint retrospective
  fastify.post('/:id/retrospective', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const sprint = await sprintService.getById(id);
      if (!sprint) return reply.status(404).send({ error: 'Not found', message: 'Sprint not found' });
      if (sprint.status !== 'completed') return reply.status(400).send({ error: 'Sprint must be completed to generate retrospective' });

      const board = await sprintService.getSprintBoard(id);
      const burndown = await sprintService.getSprintBurndown(id);
      const velocity = await sprintService.getVelocityHistory(sprint.projectId);

      // Build context for Claude
      const tasks = board.tasks || [];
      const completed = tasks.filter((t: any) => t.status === 'completed');
      const incomplete = tasks.filter((t: any) => t.status !== 'completed');
      const totalPoints = tasks.reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
      const completedPoints = completed.reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
      const velocities = velocity.sprints.map(s => s.velocity);
      const avgVelocity = velocities.length > 0 ? Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length) : 0;

      const prompt = `Generate a sprint retrospective summary for this completed sprint.

Sprint: ${sprint.name}
Goal: ${sprint.goal || 'No goal set'}
Dates: ${sprint.startDate} to ${sprint.endDate}
Velocity Commitment: ${sprint.velocityCommitment || 'Not set'} pts
Actual Velocity: ${completedPoints} pts (${completed.length}/${tasks.length} tasks completed)
Incomplete Tasks: ${incomplete.map((t: any) => t.name).join(', ') || 'None'}
Historical Avg Velocity: ${avgVelocity} pts/sprint (over ${velocities.length} sprints)
Burndown: ${burndown.totalPoints} total points, final actual: ${burndown.actual?.[burndown.actual.length - 1] ?? 'N/A'}

Provide a structured retrospective with these sections:
1. **Summary** — one paragraph overview of the sprint
2. **What Went Well** — 2-3 bullet points
3. **What Needs Improvement** — 2-3 bullet points
4. **Velocity Analysis** — compare to commitment and historical average
5. **Recommendations** — 2-3 actionable items for the next sprint

Keep it concise and actionable. Use markdown formatting.`;

      try {
        const { claudeService } = await import('../../services/claudeService');
        const result = await claudeService.complete({
          systemPrompt: 'You are an agile coach helping a team reflect on their sprint. Be constructive and specific.',
          userMessage: prompt,
          temperature: 0.5,
          maxTokens: 1000,
        });
        return { retrospective: result.content, sprint: { id, name: sprint.name, status: sprint.status } };
      } catch (aiError: any) {
        logger.warn('AI retrospective generation failed, returning data only', { error: aiError.message });
        return {
          retrospective: null,
          sprint: { id, name: sprint.name, status: sprint.status },
          stats: { totalTasks: tasks.length, completed: completed.length, completedPoints, totalPoints, avgVelocity },
        };
      }
    } catch (error) {
      logger.error('Sprint retrospective error', { error });
      return reply.status(500).send({ error: 'Failed to generate retrospective' });
    }
  });

  // GET /:id/cumulative-flow — cumulative flow diagram data
  fastify.get('/:id/cumulative-flow', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const sprint = await sprintService.getById(id);
      if (!sprint) return reply.status(404).send({ error: 'Not found', message: 'Sprint not found' });
      const flow = await sprintService.getCumulativeFlow(id);
      return { flow };
    } catch (error) {
      logger.error('Get cumulative flow error', { error });
      return reply.status(500).send({ error: 'Failed to fetch cumulative flow data' });
    }
  });

  // GET /:id/capacity — capacity recommendation
  fastify.get('/:id/capacity', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const sprint = await sprintService.getById(id);
      if (!sprint) return reply.status(404).send({ error: 'Not found', message: 'Sprint not found' });
      const capacity = await sprintService.getCapacityRecommendation(id);
      return { capacity };
    } catch (error) {
      logger.error('Get capacity recommendation error', { error });
      return reply.status(500).send({ error: 'Failed to fetch capacity recommendation' });
    }
  });

  // GET /velocity/:projectId — velocity history
  fastify.get('/velocity/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const velocity = await sprintService.getVelocityHistory(projectId);
      return { velocity };
    } catch (error) {
      logger.error('Get velocity history error', { error });
      return reply.status(500).send({ error: 'Failed to fetch velocity history' });
    }
  });
}
