import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { projectService } from '../../services/ProjectService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { webhookService } from '../../services/WebhookService';
import { slackEventDispatcher } from '../../services/integrations/SlackEventDispatcher';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { scheduleService } from '../../services/ScheduleService';
import { riskService } from '../../services/RiskService';
import { projectMemberService } from '../../services/ProjectMemberService';
import { sprintService } from '../../services/SprintService';
import { toProjectDTO, toScheduleDTO, toTaskDTO, paginate } from '../../dto/responses';
import { parsePagination } from '../../schemas/paginationSchema';
import { favouriteProjectRepository } from '../../database/FavouriteProjectRepository';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';


const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().max(50000).optional(),
  category: z.string().optional(),
  projectType: z.enum(['it', 'construction', 'infrastructure', 'roads', 'other']).default('other'),
  methodology: z.enum(['waterfall', 'agile', 'hybrid']).default('waterfall'),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).default('planning'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  budgetAllocated: z.number().positive().optional(),
  currency: z.string().default('USD'),
  location: z.string().optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLon: z.number().min(-180).max(180).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  expectedUpdatedAt: z.string().optional(),
});

const statusUpdateSchema = z.object({
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']),
  cancellationReason: z.string().max(2000).optional(),
});

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get all projects', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { limit, offset } = parsePagination(request.query as Record<string, unknown>);
      const { scope, includeArchived } = request.query as { scope?: string; includeArchived?: string };
      const archived = includeArchived === 'true';
      const globalRoles = ['admin', 'executive', 'pmo'];
      const { rows, total } = globalRoles.includes(user.role)
        ? await projectService.findAllPaginated(limit, offset, archived)
        : await projectService.findByUserIdPaginated(user.userId, limit, offset, archived);
      const projectDTOs = rows.map(toProjectDTO);
      const projectIds = projectDTOs.map((p: any) => p.id);
      const favMap = await favouriteProjectRepository.isFavouriteMap(user.userId, projectIds);
      const enriched = projectDTOs.map((p: any) => ({ ...p, isFavourite: !!favMap[p.id] }));
      const page = Math.floor(offset / limit) + 1;
      return paginate(enriched, total, page, limit);
    } catch (error) {
      logger.error('Get projects error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch projects' });
    }
  });

  fastify.get('/:id', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get project by ID', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const project = await projectService.findById(id);
      if (!project) {
        return reply.status(404).send({ error: 'Not found', message: 'The requested resource was not found' });
      }
      return { project: toProjectDTO(project) };
    } catch (error) {
      logger.error('Get project error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch project' });
    }
  });

  // GET /:id/summary — Batch endpoint: project + schedules + tasks + riskStats + members + sprints
  fastify.get('/:id/summary', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get project summary (batch)', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const project = await projectService.findById(id);
      if (!project) {
        return reply.status(404).send({ error: 'Not found', message: 'The requested resource was not found' });
      }

      // Run all queries in parallel
      const [schedules, riskStats, members, sprints] = await Promise.all([
        scheduleService.findByProjectId(id),
        riskService.getStats(id),
        projectMemberService.findByProjectId(id),
        sprintService.getByProject(id),
      ]);

      // Fetch tasks for the primary schedule (if any)
      const primarySchedule = schedules[0];
      const tasks = primarySchedule
        ? await scheduleService.findTasksByScheduleId(primarySchedule.id)
        : [];

      return {
        project: toProjectDTO(project),
        schedules: schedules.map(s => toScheduleDTO(s as any)),
        tasks: tasks.map(t => toTaskDTO(t as any)),
        riskStats,
        members,
        sprints,
      };
    } catch (error) {
      logger.error('Get project summary error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch project summary' });
    }
  });

  fastify.post('/', {
    preHandler: [requireScope('write')],
    schema: { description: 'Create a new project', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = createProjectSchema.parse(request.body);
      const userId = request.user!.userId;

      // Trial users: max 3 projects
      const user = await userService.findById(userId);
      if (user && user.subscriptionTier === 'trial' && user.role !== 'admin') {
        const projectCount = await projectService.countByUser(userId);
        if (projectCount >= 3) {
          return reply.status(403).send({
            error: 'Project limit reached',
            message: 'Trial accounts are limited to 3 projects. Upgrade to create more.',
            upgradeUrl: '/pricing',
          });
        }
      }

      const project = await projectService.create({
        ...data,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        userId,
      });
      webhookService.dispatch('project.created', { project }, userId);
      return reply.status(201).send({ project: toProjectDTO(project) });
    } catch (error) {
      logger.error('Create project error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to create project' });
    }
  });

  fastify.put('/:id', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Update a project', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = updateProjectSchema.parse(request.body);
      const userId = request.user!.userId;

      // Optimistic locking: if expectedUpdatedAt is provided, verify it matches
      const { expectedUpdatedAt, ...updateData } = data;
      if (expectedUpdatedAt) {
        const current = await projectService.findById(id);
        if (current) {
          const serverUpdatedAt = new Date(current.updatedAt).toISOString();
          const clientUpdatedAt = new Date(expectedUpdatedAt).toISOString();
          if (serverUpdatedAt !== clientUpdatedAt) {
            return reply.status(409).send({
              error: 'Conflict',
              message: 'Modified by someone else',
              serverUpdatedAt,
            });
          }
        }
      }

      const project = await projectService.update(id, {
        ...updateData,
        startDate: updateData.startDate || undefined,
        endDate: updateData.endDate || undefined,
      }, userId);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found', message: 'Project does not exist or you do not have access' });
      }
      webhookService.dispatch('project.updated', { project }, userId);
      slackEventDispatcher.dispatchToSlack('project.updated', { project }, id);
      return { project: toProjectDTO(project) };
    } catch (error) {
      logger.error('Update project error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to update project' });
    }
  });

  fastify.patch('/:id/status', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Update project status', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { status, cancellationReason } = statusUpdateSchema.parse(request.body);

      if (status === 'cancelled' && !cancellationReason?.trim()) {
        return reply.status(400).send({ error: 'Validation error', message: 'A cancellation reason is required when cancelling a project' });
      }

      const project = await projectService.update(id, { status }, user.userId);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found', message: 'Project does not exist or you do not have access' });
      }

      if (status === 'cancelled' && cancellationReason) {
        auditLedgerService.append({
          actorId: user.userId,
          actorType: 'user',
          action: 'project.cancelled',
          entityType: 'project',
          entityId: id,
          projectId: id,
          payload: { reason: cancellationReason.trim() },
          source: 'web',
        }).catch(() => {});
      }

      webhookService.dispatch('project.updated', { project }, user.userId);
      slackEventDispatcher.dispatchToSlack('project.updated', { project }, id);
      return { project };
    } catch (error) {
      logger.error('Update project status error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to update project status' });
    }
  });

  fastify.delete('/:id', {
    preHandler: [requireScope('admin'), requireProjectAccess('owner')],
    schema: { description: 'Delete a project', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;
      const deleted = await projectService.delete(id, userId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Project not found', message: 'Project does not exist or you do not have access' });
      }
      return { message: 'Project deleted successfully' };
    } catch (error) {
      logger.error('Delete project error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete project' });
    }
  });

  // ── Archive / Unarchive ────────────────────────────────────────────────

  fastify.post('/:id/archive', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Archive a project', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const archived = await projectService.archiveProject(id);
      if (!archived) {
        return reply.status(404).send({ error: 'Not found', message: 'Project not found or already archived' });
      }
      return { message: 'Project archived' };
    } catch (error) {
      logger.error('Archive project error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to archive project' });
    }
  });

  fastify.post('/:id/unarchive', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Unarchive a project', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const unarchived = await projectService.unarchiveProject(id);
      if (!unarchived) {
        return reply.status(404).send({ error: 'Not found', message: 'Project not found or not archived' });
      }
      return { message: 'Project unarchived' };
    } catch (error) {
      logger.error('Unarchive project error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to unarchive project' });
    }
  });

  // ── Favourites ──────────────────────────────────────────────────────────

  fastify.get('/favourites', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get favourite projects', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const projectIds = await favouriteProjectRepository.getByUserId(userId);
      if (projectIds.length === 0) return { projects: [] };
      const projects = await Promise.all(
        projectIds.map((id) => projectService.findById(id)),
      );
      return { projects: projects.filter(Boolean).map((p) => ({ ...toProjectDTO(p!), isFavourite: true })) };
    } catch (error) {
      logger.error('Get favourite projects error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch favourite projects' });
    }
  });

  fastify.post('/:id/favourite', {
    preHandler: [requireScope('read')],
    schema: { description: 'Add project to favourites', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;
      await favouriteProjectRepository.add(userId, id);
      return { message: 'Project added to favourites' };
    } catch (error) {
      logger.error('Add favourite error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to add favourite' });
    }
  });

  fastify.delete('/:id/favourite', {
    preHandler: [requireScope('read')],
    schema: { description: 'Remove project from favourites', tags: ['projects'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;
      await favouriteProjectRepository.remove(userId, id);
      return { message: 'Project removed from favourites' };
    } catch (error) {
      logger.error('Remove favourite error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to remove favourite' });
    }
  });
}
