import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { resourceService, normalizeSkills } from '../../services/ResourceService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { userService } from '../../services/UserService';
import { scheduleService } from '../../services/ScheduleService';
import logger from '../../utils/logger';

const skillSchema = z.union([
  z.string(),
  z.object({ name: z.string(), level: z.number().min(1).max(5) }),
]);

const createResourceSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  email: z.string().email(),
  capacityHoursPerWeek: z.number().positive().default(40),
  skills: z.array(skillSchema).default([]),
  isActive: z.boolean().default(true),
  costRateHourly: z.number().min(0).nullable().default(null),
  resourceGroup: z.string().max(100).nullable().default(null),
  userId: z.string().uuid().nullable().default(null),
  calendarTemplateId: z.string().uuid().nullable().default(null),
});

const createAssignmentSchema = z.object({
  resourceId: z.string().min(1),
  taskId: z.string().min(1),
  scheduleId: z.string().min(1),
  hoursPerWeek: z.number().positive(),
  startDate: z.string().date(),
  endDate: z.string().date(),
});

export async function resourceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /resources - List resources (paginated, optional group filter)
  // Trial users get sample resource data with an upgrade prompt.
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    // Trial users get sample resources
    if (request.user!.role !== 'admin') {
      const user = await userService.findById(request.user!.userId);
      if (user && user.subscriptionTier === 'trial') {
        return { resources: generateSampleResources(), total: 4, sample: true };
      }
    }

    const { limit, offset, group } = request.query as { limit?: string; offset?: string; group?: string };
    const result = await resourceService.findAllResourcesPaginated(
      Math.min(Number(limit) || 50, 200),
      Number(offset) || 0,
      group || undefined,
    );
    return result;
  });

  // POST /resources - Create a resource
  fastify.post('/', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const raw = createResourceSchema.parse(request.body);
      const resource = await resourceService.createResource({
        ...raw,
        skills: normalizeSkills(raw.skills),
      } as any);
      return reply.status(201).send({ resource });
    } catch (error) {
      logger.error('Create resource error', { error });
      return reply.status(400).send({ error: 'Invalid resource data' });
    }
  });

  // PUT /resources/:id - Update a resource
  fastify.put('/:id', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const raw = createResourceSchema.partial().parse(request.body);
      const data = raw.skills ? { ...raw, skills: normalizeSkills(raw.skills) } : raw;
      const resource = await resourceService.updateResource(id, data as any);
      if (!resource) return reply.status(404).send({ error: 'Resource not found' });
      return { resource };
    } catch (error) {
      logger.error('Update resource error', { error });
      return reply.status(400).send({ error: 'Invalid resource data' });
    }
  });

  // DELETE /resources/:id
  fastify.delete('/:id', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const deleted = await resourceService.deleteResource(id);
    if (!deleted) return reply.status(404).send({ error: 'Resource not found' });
    return { message: 'Resource deleted' };
  });

  // GET /resources/assignments/:scheduleId
  fastify.get('/assignments/:scheduleId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { scheduleId } = request.params as { scheduleId: string };
    const assignments = await resourceService.findAssignmentsBySchedule(scheduleId);
    return { assignments };
  });

  // POST /resources/assignments
  fastify.post('/assignments', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = createAssignmentSchema.parse(request.body);
      const { assignment, warnings } = await resourceService.createAssignment(data);
      return reply.status(201).send({ assignment, warnings });
    } catch (error) {
      logger.error('Create assignment error', { error });
      return reply.status(400).send({ error: 'Invalid assignment data' });
    }
  });

  // DELETE /resources/assignments/:id
  fastify.delete('/assignments/:id', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const deleted = await resourceService.deleteAssignment(id);
    if (!deleted) return reply.status(404).send({ error: 'Assignment not found' });
    return { message: 'Assignment deleted' };
  });

  // GET /resources/workload - Global cross-project workload (#2)
  fastify.get('/workload', { preHandler: [requireScope('read')] }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    const workload = await resourceService.computeGlobalWorkload();
    const totalProjectCost = Math.round(workload.reduce((sum, w) => sum + w.totalCost, 0) * 100) / 100;
    return { workload, costSummary: { totalProjectCost } };
  });

  // GET /resources/workload/:projectId
  fastify.get('/workload/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const workload = await resourceService.computeWorkload(projectId);
    const totalProjectCost = Math.round(workload.reduce((sum, w) => sum + w.totalCost, 0) * 100) / 100;
    return { workload, costSummary: { totalProjectCost } };
  });

  // GET /resources/:id/utilization-history (#6)
  fastify.get('/:id/utilization-history', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { weeks } = request.query as { weeks?: string };
    const numWeeks = Math.min(Math.max(Number(weeks) || 12, 4), 52);
    return resourceService.computeUtilizationHistory(id, numWeeks);
  });

  // POST /resources/quick-assign (#7) - Quick assign resource to task
  fastify.post('/quick-assign', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = z.object({
        resourceId: z.string().min(1),
        taskId: z.string().min(1),
        scheduleId: z.string().min(1),
      }).parse(request.body);

      const task = await scheduleService.findTaskById(body.taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      const resource = await resourceService.findResourceById(body.resourceId);
      if (!resource) return reply.status(404).send({ error: 'Resource not found' });

      const startDate = task.startDate || new Date().toISOString().slice(0, 10);
      const endDate = task.endDate || new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

      const { assignment, warnings } = await resourceService.createAssignment({
        resourceId: body.resourceId,
        taskId: body.taskId,
        scheduleId: body.scheduleId,
        hoursPerWeek: resource.capacityHoursPerWeek,
        startDate,
        endDate,
      });

      return reply.status(201).send({ assignment, warnings });
    } catch (error) {
      logger.error('Quick-assign error', { error });
      return reply.status(400).send({ error: 'Invalid quick-assign data' });
    }
  });
}

function generateSampleResources() {
  return [
    { id: 'sample-r1', name: 'Jane Smith', role: 'Project Manager', email: 'jane@example.com', capacityHoursPerWeek: 40, skills: ['Leadership', 'Agile', 'Risk Management'], isActive: true, costRateHourly: 95 },
    { id: 'sample-r2', name: 'John Doe', role: 'Senior Developer', email: 'john@example.com', capacityHoursPerWeek: 40, skills: ['React', 'TypeScript', 'Node.js'], isActive: true, costRateHourly: 85 },
    { id: 'sample-r3', name: 'Sarah Kim', role: 'QA Engineer', email: 'sarah@example.com', capacityHoursPerWeek: 35, skills: ['Test Automation', 'Selenium', 'Performance Testing'], isActive: true, costRateHourly: 70 },
    { id: 'sample-r4', name: 'Alex Chen', role: 'UX Designer', email: 'alex@example.com', capacityHoursPerWeek: 30, skills: ['Figma', 'User Research', 'Prototyping'], isActive: true, costRateHourly: 75 },
  ];
}
