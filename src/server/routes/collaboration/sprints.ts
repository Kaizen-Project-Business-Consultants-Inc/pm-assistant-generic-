import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sprintService } from '../../services/SprintService';
import { standupEntryService } from '../../services/StandupEntryService';
import { retrospectiveService } from '../../services/RetrospectiveService';
import { scrumDefinitionService } from '../../services/ScrumDefinitionService';
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

  // PATCH /:id/tasks/:taskId/points — update story points for a sprint task
  fastify.patch('/:id/tasks/:taskId/points', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, taskId } = request.params as { id: string; taskId: string };
      const { storyPoints } = request.body as { storyPoints: number };
      await sprintService.updateTaskStoryPoints(id, taskId, storyPoints);
      return { message: 'Story points updated' };
    } catch (error) {
      logger.error('Update story points error', { error });
      return reply.status(500).send({ error: 'Failed to update story points' });
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

  // =========================================================================
  // Standup Logging
  // =========================================================================

  // POST /:id/standups — submit/update daily standup
  fastify.post('/:id/standups', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = request.user!;
      const body = z.object({
        projectId: z.string().uuid(),
        entryDate: z.string().min(10).max(10),
        yesterday: z.string().max(5000).nullable().optional(),
        today: z.string().max(5000).nullable().optional(),
        blockers: z.array(z.string().max(500)).max(20).nullable().optional(),
      }).parse(request.body);

      const entry = await standupEntryService.submit({
        sprintId: id,
        projectId: body.projectId,
        userId: user.userId,
        entryDate: body.entryDate,
        yesterday: body.yesterday,
        today: body.today,
        blockers: body.blockers,
      });
      return reply.status(201).send({ entry });
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      if (error.message?.includes('must be active')) return reply.status(400).send({ error: error.message });
      logger.error('Submit standup error', { error });
      return reply.status(500).send({ error: 'Failed to submit standup' });
    }
  });

  // GET /:id/standups?date=YYYY-MM-DD — get team standups for date
  fastify.get('/:id/standups', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { date } = request.query as { date?: string };
      const entryDate = date || new Date().toISOString().split('T')[0];
      const entries = await standupEntryService.getByDate(id, entryDate);
      return { entries, date: entryDate };
    } catch (error) {
      logger.error('Get standups error', { error });
      return reply.status(500).send({ error: 'Failed to fetch standups' });
    }
  });

  // GET /:id/standups/timeline — get date list with entry counts
  fastify.get('/:id/standups/timeline', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const timeline = await standupEntryService.getTimeline(id);
      return { timeline };
    } catch (error) {
      logger.error('Get standup timeline error', { error });
      return reply.status(500).send({ error: 'Failed to fetch standup timeline' });
    }
  });

  // PUT /:id/standups/:entryId — update own entry
  fastify.put('/:id/standups/:entryId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { entryId } = request.params as { id: string; entryId: string };
      const user = request.user!;
      const body = z.object({
        yesterday: z.string().max(5000).nullable().optional(),
        today: z.string().max(5000).nullable().optional(),
        blockers: z.array(z.string().max(500)).max(20).nullable().optional(),
      }).parse(request.body);

      const entry = await standupEntryService.update(entryId, user.userId, body);
      return { entry };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      if (error.message?.includes('only update your own')) return reply.status(403).send({ error: error.message });
      if (error.message?.includes('not found')) return reply.status(404).send({ error: error.message });
      logger.error('Update standup error', { error });
      return reply.status(500).send({ error: 'Failed to update standup' });
    }
  });

  // DELETE /:id/standups/:entryId — delete own entry
  fastify.delete('/:id/standups/:entryId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { entryId } = request.params as { id: string; entryId: string };
      const user = request.user!;
      await standupEntryService.delete(entryId, user.userId);
      return { message: 'Standup entry deleted' };
    } catch (error: any) {
      if (error.message?.includes('only delete your own')) return reply.status(403).send({ error: error.message });
      if (error.message?.includes('not found')) return reply.status(404).send({ error: error.message });
      logger.error('Delete standup error', { error });
      return reply.status(500).send({ error: 'Failed to delete standup' });
    }
  });

  // =========================================================================
  // Retrospective Board
  // =========================================================================

  // GET /:id/retro — get retro board (items + user votes)
  fastify.get('/:id/retro', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = request.user!;
      const board = await retrospectiveService.getBoard(id, user.userId);
      return board;
    } catch (error) {
      logger.error('Get retro board error', { error });
      return reply.status(500).send({ error: 'Failed to fetch retro board' });
    }
  });

  // POST /:id/retro — add retro item
  fastify.post('/:id/retro', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = request.user!;
      const body = z.object({
        projectId: z.string().uuid(),
        category: z.enum(['went_well', 'to_improve', 'action_item']),
        content: z.string().min(1).max(2000),
      }).parse(request.body);

      const item = await retrospectiveService.addItem({
        sprintId: id,
        projectId: body.projectId,
        category: body.category,
        content: body.content,
        createdBy: user.userId,
      });
      return reply.status(201).send({ item });
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Add retro item error', { error });
      return reply.status(500).send({ error: 'Failed to add retro item' });
    }
  });

  // DELETE /:id/retro/:itemId — delete own item
  fastify.delete('/:id/retro/:itemId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { itemId } = request.params as { id: string; itemId: string };
      const user = request.user!;
      await retrospectiveService.deleteItem(itemId, user.userId);
      return { message: 'Retro item deleted' };
    } catch (error: any) {
      if (error.message?.includes('only delete your own')) return reply.status(403).send({ error: error.message });
      if (error.message?.includes('not found')) return reply.status(404).send({ error: error.message });
      logger.error('Delete retro item error', { error });
      return reply.status(500).send({ error: 'Failed to delete retro item' });
    }
  });

  // POST /:id/retro/:itemId/vote — vote on item
  fastify.post('/:id/retro/:itemId/vote', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { itemId } = request.params as { id: string; itemId: string };
      const user = request.user!;
      await retrospectiveService.vote(itemId, user.userId);
      return { message: 'Vote recorded' };
    } catch (error) {
      logger.error('Vote retro item error', { error });
      return reply.status(500).send({ error: 'Failed to vote' });
    }
  });

  // DELETE /:id/retro/:itemId/vote — unvote
  fastify.delete('/:id/retro/:itemId/vote', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { itemId } = request.params as { id: string; itemId: string };
      const user = request.user!;
      await retrospectiveService.unvote(itemId, user.userId);
      return { message: 'Vote removed' };
    } catch (error) {
      logger.error('Unvote retro item error', { error });
      return reply.status(500).send({ error: 'Failed to unvote' });
    }
  });

  // POST /:id/retro/seed — AI-seed retro items
  fastify.post('/:id/retro/seed', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = request.user!;
      const { projectId } = request.body as { projectId: string };
      const items = await retrospectiveService.seedFromAI(id, projectId, user.userId);
      return { items };
    } catch (error: any) {
      logger.error('AI seed retro error', { error });
      return reply.status(500).send({ error: error.message || 'Failed to AI-seed retro items' });
    }
  });

  // POST /:id/retro/:itemId/convert — convert action item to task
  fastify.post('/:id/retro/:itemId/convert', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { itemId } = request.params as { id: string; itemId: string };
      const user = request.user!;
      const { scheduleId } = request.body as { scheduleId: string };
      if (!scheduleId) return reply.status(400).send({ error: 'scheduleId is required' });

      const result = await retrospectiveService.convertToTask(itemId, scheduleId, user.userId);
      return { taskId: result.taskId };
    } catch (error: any) {
      if (error.message?.includes('not found')) return reply.status(404).send({ error: error.message });
      if (error.message?.includes('Only action items') || error.message?.includes('already converted')) return reply.status(400).send({ error: error.message });
      logger.error('Convert retro item error', { error });
      return reply.status(500).send({ error: 'Failed to convert retro item to task' });
    }
  });

  // =========================================================================
  // Definition of Ready / Done
  // =========================================================================

  // GET /definitions/:projectId — get DoR/DoD templates
  fastify.get('/definitions/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const definitions = await scrumDefinitionService.getDefinitions(projectId);
      return { definitions };
    } catch (error) {
      logger.error('Get scrum definitions error', { error });
      return reply.status(500).send({ error: 'Failed to fetch definitions' });
    }
  });

  // PUT /definitions/:projectId/:type — upsert template (manager+)
  fastify.put('/definitions/:projectId/:type', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, type } = request.params as { projectId: string; type: string };
      if (type !== 'dor' && type !== 'dod') return reply.status(400).send({ error: 'Type must be dor or dod' });

      const user = request.user!;
      const body = z.object({
        criteria: z.array(z.object({
          id: z.string(),
          label: z.string().min(1).max(500),
          order: z.number().int().min(0),
        })).max(50),
      }).parse(request.body);

      const definition = await scrumDefinitionService.upsertDefinition(projectId, type, body.criteria, user.userId);
      return { definition };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Upsert scrum definition error', { error });
      return reply.status(500).send({ error: 'Failed to save definition' });
    }
  });

  // GET /checklists/:taskId — get task checklists
  fastify.get('/checklists/:taskId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { taskId } = request.params as { taskId: string };
      const checklists = await scrumDefinitionService.getTaskChecklists(taskId);
      return { checklists };
    } catch (error) {
      logger.error('Get task checklists error', { error });
      return reply.status(500).send({ error: 'Failed to fetch checklists' });
    }
  });

  // POST /checklists/:taskId/:type — initialize checklist from template
  fastify.post('/checklists/:taskId/:type', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { taskId, type } = request.params as { taskId: string; type: string };
      if (type !== 'dor' && type !== 'dod') return reply.status(400).send({ error: 'Type must be dor or dod' });

      const { projectId } = request.body as { projectId: string };
      if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

      const checklist = await scrumDefinitionService.initializeChecklist(taskId, projectId, type);
      return reply.status(201).send({ checklist });
    } catch (error: any) {
      if (error.message?.includes('No ')) return reply.status(400).send({ error: error.message });
      logger.error('Initialize checklist error', { error });
      return reply.status(500).send({ error: 'Failed to initialize checklist' });
    }
  });

  // PUT /checklists/:checklistId — update checklist item
  fastify.put('/checklists/:checklistId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { checklistId } = request.params as { checklistId: string };
      const body = z.object({
        criterionId: z.string(),
        checked: z.boolean(),
      }).parse(request.body);

      const checklist = await scrumDefinitionService.updateChecklistItem(checklistId, body.criterionId, body.checked);
      return { checklist };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      if (error.message?.includes('not found')) return reply.status(404).send({ error: error.message });
      logger.error('Update checklist error', { error });
      return reply.status(500).send({ error: 'Failed to update checklist' });
    }
  });

  // GET /checklists/bulk/:type — bulk readiness query
  fastify.get('/checklists/bulk/:type', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { type } = request.params as { type: string };
      if (type !== 'dor' && type !== 'dod') return reply.status(400).send({ error: 'Type must be dor or dod' });

      const { taskIds } = request.query as { taskIds?: string };
      if (!taskIds) return reply.status(400).send({ error: 'taskIds query param is required' });

      const ids = taskIds.split(',').filter(Boolean);
      if (ids.length === 0) return { readiness: {} };
      if (ids.length > 200) return reply.status(400).send({ error: 'Too many task IDs (max 200)' });

      const readiness = await scrumDefinitionService.getReadinessBulk(ids, type);
      return { readiness };
    } catch (error) {
      logger.error('Bulk readiness query error', { error });
      return reply.status(500).send({ error: 'Failed to fetch readiness' });
    }
  });
}
