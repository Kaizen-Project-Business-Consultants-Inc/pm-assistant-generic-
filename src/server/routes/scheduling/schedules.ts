import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { scheduleService, DependencyValidationError } from '../../services/ScheduleService';
import { criticalPathService } from '../../services/CriticalPathService';
import { baselineService } from '../../services/BaselineService';
import { dagWorkflowService } from '../../services/DagWorkflowService';
import { WebSocketService } from '../../services/WebSocketService';
import { webhookService } from '../../services/WebhookService';
import { slackEventDispatcher } from '../../services/integrations/SlackEventDispatcher';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { notificationService } from '../../services/NotificationService';
import { userService } from '../../services/UserService';
import { paginate } from '../../dto/responses';
import { parsePagination } from '../../schemas/paginationSchema';
import logger from '../../utils/logger';

const createScheduleSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().date(),
  endDate: z.string().date(),
});

const taskDependencySchema = z.object({
  dependencyId: z.string(),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
  lagDays: z.number().int().default(0),
});

const createTaskSchema = z.object({
  scheduleId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).default('pending'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assignedTo: z.string().optional(),
  dueDate: z.string().date().optional(),
  estimatedDays: z.number().positive().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  dependency: z.string().optional(),
  risks: z.string().optional(),
  issues: z.string().optional(),
  comments: z.string().optional(),
  parentTaskId: z.string().optional(),
  recurrenceRule: z.string().optional(),
  isRecurrenceTemplate: z.boolean().optional(),
  isMilestone: z.boolean().optional(),
  dependencyLagDays: z.number().int().optional(),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
  afterTaskId: z.string().optional(),
  beforeTaskId: z.string().optional(),
  dependencies: z.array(taskDependencySchema).max(20).optional(),
});

const updateTaskSchema = createTaskSchema.partial().omit({ scheduleId: true });

export async function scheduleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // dagWorkflowService is a singleton — no instantiation needed

  fastify.get('/project/:projectId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get schedules for a project', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const schedules = await scheduleService.findByProjectId(projectId);
      return { schedules };
    } catch (error) {
      logger.error('Get schedules error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch schedules' });
    }
  });

  fastify.post('/', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Create a schedule (projectId in body)', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const data = createScheduleSchema.parse(request.body);
      const schedule = await scheduleService.create({
        ...data,
        createdBy: user.userId,
      });
      return reply.status(201).send({ schedule });
    } catch (error) {
      logger.error('Create schedule error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to create schedule' });
    }
  });

  fastify.put('/:scheduleId', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Update a schedule', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const data = createScheduleSchema.partial().parse(request.body);
      const schedule = await scheduleService.update(scheduleId, {
        ...data,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
      });
      if (!schedule) return reply.status(404).send({ error: 'Not found', message: 'Schedule not found' });
      return { schedule };
    } catch (error) {
      logger.error('Update schedule error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to update schedule' });
    }
  });

  fastify.delete('/:scheduleId', {
    preHandler: [requireScope('admin'), requireProjectAccess('manager')],
    schema: { description: 'Delete a schedule', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const deleted = await scheduleService.delete(scheduleId);
      if (!deleted) return reply.status(404).send({ error: 'Not found', message: 'Schedule not found' });
      return { message: 'Schedule deleted successfully' };
    } catch (error) {
      logger.error('Delete schedule error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete schedule' });
    }
  });

  fastify.get('/:scheduleId/tasks', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get tasks for a schedule', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const { limit, offset } = parsePagination(request.query as Record<string, unknown>);
      const { rows, total } = await scheduleService.findTasksByScheduleIdPaginated(scheduleId, limit, offset);
      const page = Math.floor(offset / limit) + 1;
      return paginate(rows, total, page, limit);
    } catch (error) {
      logger.error('Get tasks error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch tasks' });
    }
  });

  fastify.post('/:scheduleId/tasks', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Create a task', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { scheduleId } = request.params as { scheduleId: string };
      const data = createTaskSchema.omit({ scheduleId: true }).parse(request.body);
      const task = await scheduleService.createTask({
        scheduleId,
        ...data,
        dueDate: data.dueDate || undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        createdBy: user.userId,
      });
      // Look up schedule's projectId for scoped broadcast
      const schedule = await scheduleService.findById(scheduleId);
      WebSocketService.broadcast({ type: 'task_created', payload: { task } }, schedule?.projectId);
      webhookService.dispatch('task.created', { task }, user?.userId);
      return reply.status(201).send({ task });
    } catch (error) {
      if (error instanceof DependencyValidationError) {
        return reply.status(400).send({ error: 'Validation error', message: error.message });
      }
      logger.error('Create task error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to create task' });
    }
  });

  fastify.put('/:scheduleId/tasks/:taskId', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Update a task', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { taskId } = request.params as { taskId: string };
      const data = updateTaskSchema.parse(request.body);

      // Capture old end date before update for cascade detection
      const oldTask = await scheduleService.findTaskById(taskId);
      if (!oldTask) return reply.status(404).send({ error: 'Not found', message: 'Task not found' });

      const oldEndDate = oldTask.endDate ? new Date(oldTask.endDate) : null;

      const task = await scheduleService.updateTask(taskId, {
        ...data,
        dueDate: data.dueDate || undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
      });
      if (!task) return reply.status(404).send({ error: 'Not found', message: 'Task not found' });

      // Auto-scheduling: cascade date changes to downstream tasks
      let cascadedChanges = null;
      const newEndDate = data.endDate ? new Date(data.endDate) : null;
      if (oldEndDate && newEndDate && oldEndDate.getTime() !== newEndDate.getTime()) {
        const result = await scheduleService.cascadeReschedule(taskId, oldEndDate, newEndDate);
        if (result.affectedTasks.length > 0) {
          cascadedChanges = result;
        }
      }

      // Workflow automation: evaluate rules
      await dagWorkflowService.evaluateTaskChange(task, oldTask, scheduleService);

      // WebSocket broadcast (scoped to project)
      const { scheduleId } = request.params as { scheduleId: string };
      const schedule = await scheduleService.findById(scheduleId);
      WebSocketService.broadcast({ type: 'task_updated', payload: { task, cascadedChanges } }, schedule?.projectId);
      const user = request.user!;
      webhookService.dispatch('task.updated', { task, cascadedChanges }, user?.userId);

      // Slack notification for completed tasks
      if (task.status === 'completed' && schedule?.projectId) {
        slackEventDispatcher.dispatchToSlack('task.updated', { task }, schedule.projectId);
      }

      return { task, cascadedChanges };
    } catch (error) {
      if (error instanceof DependencyValidationError) {
        return reply.status(400).send({ error: 'Validation error', message: error.message });
      }
      logger.error('Update task error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to update task' });
    }
  });

  fastify.delete('/:scheduleId/tasks/:taskId', {
    preHandler: [requireScope('admin'), requireProjectAccess('manager')],
    schema: { description: 'Delete a task', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { taskId } = request.params as { taskId: string };
      const deleted = await scheduleService.deleteTask(taskId);
      if (!deleted) return reply.status(404).send({ error: 'Not found', message: 'Task not found' });
      const { scheduleId } = request.params as { scheduleId: string };
      const schedule = await scheduleService.findById(scheduleId);
      WebSocketService.broadcast({ type: 'task_deleted', payload: { taskId } }, schedule?.projectId);
      const user = request.user!;
      webhookService.dispatch('task.deleted', { taskId }, user?.userId);
      return { message: 'Task deleted successfully' };
    } catch (error) {
      logger.error('Delete task error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete task' });
    }
  });

  // -------------------------------------------------------------------------
  // Critical Path
  // -------------------------------------------------------------------------

  fastify.get('/:scheduleId/critical-path', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get critical path analysis', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const result = await criticalPathService.calculateCriticalPath(scheduleId);
      return result;
    } catch (error) {
      logger.error('Critical path error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to compute critical path' });
    }
  });

  // -------------------------------------------------------------------------
  // Baselines
  // -------------------------------------------------------------------------

  fastify.get('/:scheduleId/baselines', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get baselines for a schedule', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const baselines = await baselineService.findByScheduleId(scheduleId);
      return { baselines };
    } catch (error) {
      logger.error('Get baselines error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch baselines' });
    }
  });

  fastify.get('/:scheduleId/baselines/:baselineId/compare', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Compare baseline vs current schedule', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { baselineId } = request.params as { baselineId: string };
      const comparison = await baselineService.compareBaseline(baselineId);
      if (!comparison) return reply.status(404).send({ error: 'Baseline not found' });
      return { comparison };
    } catch (error) {
      logger.error('Baseline comparison error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to compare baseline' });
    }
  });

  fastify.delete('/:scheduleId/baselines/:baselineId', {
    preHandler: [requireScope('admin'), requireProjectAccess('manager')],
    schema: { description: 'Delete a baseline', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { baselineId } = request.params as { baselineId: string };
      const deleted = await baselineService.delete(baselineId);
      if (!deleted) return reply.status(404).send({ error: 'Baseline not found' });
      return { message: 'Baseline deleted successfully' };
    } catch (error) {
      logger.error('Delete baseline error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete baseline' });
    }
  });

  fastify.post('/:scheduleId/baselines', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Create a baseline snapshot', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { scheduleId } = request.params as { scheduleId: string };
      const { name } = (request.body as { name?: string }) || {};
      const baseline = await baselineService.create(
        scheduleId,
        name || `Baseline ${new Date().toLocaleDateString()}`,
        user.userId,
      );
      return reply.status(201).send({ baseline });
    } catch (error) {
      logger.error('Create baseline error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to create baseline' });
    }
  });

  // -------------------------------------------------------------------------
  // Comments & Activity
  // -------------------------------------------------------------------------

  fastify.get('/:scheduleId/tasks/:taskId/comments', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get comments for a task', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { taskId } = request.params as { taskId: string };
      const comments = await scheduleService.getComments(taskId);
      return { comments };
    } catch (error) {
      logger.error('Get comments error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch comments' });
    }
  });

  fastify.post('/:scheduleId/tasks/:taskId/comments', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Add a comment to a task', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { taskId } = request.params as { taskId: string };
      const { text } = (request.body as { text: string });
      if (!text || !text.trim()) {
        return reply.status(400).send({ error: 'Comment text is required' });
      }
      const comment = await scheduleService.addComment(taskId, text.trim(), user.userId, user.username || 'Project Manager');

      // Parse @mentions and notify task assignee (fire-and-forget)
      const mentions = text.match(/@(\w+)/g);
      const mentionedUserIds = new Set<string>();
      if (mentions && mentions.length > 0) {
        (async () => {
          try {
            const usernames = [...new Set(mentions.map(m => m.slice(1)))].filter(u => u !== user.username).slice(0, 20);
            if (usernames.length === 0) return;
            const [task, mentionedUsers] = await Promise.all([
              scheduleService.findTaskById(taskId),
              userService.findByUsernames(usernames),
            ]);
            for (const mu of mentionedUsers) mentionedUserIds.add(mu.id);
            await Promise.all(mentionedUsers.map(mu =>
              notificationService.create({
                userId: mu.id,
                type: 'mention',
                title: `${user.username} mentioned you`,
                message: `${user.username} mentioned you in a comment on "${task?.name || 'a task'}"`,
                linkType: 'task',
                linkId: taskId,
              }),
            ));
          } catch (err) {
            logger.error('Mention notification error', { error: err });
          }
        })();
      }

      // Notify task assignee about the comment (if not the commenter and not already @mentioned)
      (async () => {
        try {
          const task = await scheduleService.findTaskById(taskId);
          if (task?.assignedTo && task.assignedTo !== user.userId && !mentionedUserIds.has(task.assignedTo)) {
            await notificationService.create({
              userId: task.assignedTo,
              type: 'task_comment',
              severity: 'low',
              title: 'New comment on your task',
              message: `${user.username || 'Someone'} commented on "${task.name}"`,
              linkType: 'task',
              linkId: taskId,
            });
          }
        } catch (err) {
          logger.error('Task comment notification error', { error: err });
        }
      })();

      return reply.status(201).send({ comment });
    } catch (error) {
      logger.error('Add comment error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to add comment' });
    }
  });

  fastify.delete('/:scheduleId/tasks/:taskId/comments/:commentId', {
    preHandler: [requireScope('admin'), requireProjectAccess('manager')],
    schema: { description: 'Delete a comment', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { commentId } = request.params as { commentId: string };
      const deleted = await scheduleService.deleteComment(commentId);
      if (!deleted) return reply.status(404).send({ error: 'Comment not found' });
      return { message: 'Comment deleted' };
    } catch (error) {
      logger.error('Delete comment error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete comment' });
    }
  });

  fastify.get('/:scheduleId/tasks/:taskId/activity', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get activity feed for a task', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { taskId } = request.params as { taskId: string };
      const activities = await scheduleService.getActivities(taskId);
      return { activities };
    } catch (error) {
      logger.error('Get activity error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch activity' });
    }
  });
}
