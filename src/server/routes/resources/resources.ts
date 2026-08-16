import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse as csvParse } from 'csv-parse/sync';
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
  overtimeRateHourly: z.number().min(0).nullable().default(null),
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

  // POST /resources/import — Bulk CSV import (#2)
  fastify.post('/import', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = z.object({ csv: z.string().min(1).max(5 * 1024 * 1024) }).parse(request.body);
      const records: any[] = csvParse(body.csv, { columns: true, skip_empty_lines: true, trim: true, bom: true });

      if (records.length === 0) return reply.status(400).send({ error: 'CSV contains no data rows' });
      if (records.length > 200) return reply.status(400).send({ error: 'Maximum 200 resources per import' });

      const results: { created: number; errors: Array<{ row: number; error: string }> } = { created: 0, errors: [] };

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const name = (row.name || row.Name || '').trim();
        const role = (row.role || row.Role || '').trim();
        const email = (row.email || row.Email || '').trim();

        if (!name || !role || !email) {
          results.errors.push({ row: i + 2, error: 'Missing required field (name, role, or email)' });
          continue;
        }

        const emailValid = z.string().email().safeParse(email);
        if (!emailValid.success) {
          results.errors.push({ row: i + 2, error: `Invalid email: ${email}` });
          continue;
        }

        const capacityRaw = row.capacityHoursPerWeek || row.capacity || row['Hours/Week'] || '40';
        const capacity = parseInt(capacityRaw) || 40;
        const costRaw = row.costRateHourly || row.costRate || row['Cost Rate'] || '';
        const costRate = costRaw ? parseFloat(costRaw) : null;
        const skillsRaw = row.skills || row.Skills || '';
        const skills = skillsRaw ? skillsRaw.split(';').map((s: string) => s.trim()).filter(Boolean).map((s: string) => ({ name: s, level: 3 })) : [];
        const group = (row.resourceGroup || row.department || row.Department || '').trim() || null;

        try {
          await resourceService.createResource({
            name, role, email,
            capacityHoursPerWeek: capacity,
            skills,
            isActive: true,
            costRateHourly: costRate != null && !isNaN(costRate) ? costRate : null,
            overtimeRateHourly: null,
            resourceGroup: group,
            userId: null,
            calendarTemplateId: null,
          });
          results.created++;
        } catch (err: any) {
          results.errors.push({ row: i + 2, error: err.message || 'Creation failed' });
        }
      }

      return { ...results, total: records.length };
    } catch (error: any) {
      logger.error('Resource import error', { error });
      if (error?.issues) return reply.status(400).send({ error: 'Invalid request data' });
      return reply.status(400).send({ error: error.message || 'CSV parsing failed' });
    }
  });

  // GET /resources/:id/profile — Resource profile with assignments (#3)
  fastify.get('/:id/profile', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const resource = await resourceService.findResourceById(id);
    if (!resource) return reply.status(404).send({ error: 'Resource not found' });

    const assignments = await resourceService.findAssignmentsByResource(id);

    // Gather task names for each assignment
    const taskDetails: Array<{ assignmentId: string; taskId: string; taskName: string; scheduleId: string; hoursPerWeek: number; startDate: string; endDate: string }> = [];
    for (const a of assignments) {
      const task = await scheduleService.findTaskById(a.taskId);
      taskDetails.push({
        assignmentId: a.id,
        taskId: a.taskId,
        taskName: task?.name || 'Unknown Task',
        scheduleId: a.scheduleId,
        hoursPerWeek: a.hoursPerWeek,
        startDate: a.startDate,
        endDate: a.endDate,
      });
    }

    // Compute summary
    const totalAllocatedHours = assignments.reduce((s, a) => s + a.hoursPerWeek, 0);
    const utilization = resource.capacityHoursPerWeek > 0
      ? Math.round((totalAllocatedHours / resource.capacityHoursPerWeek) * 100)
      : 0;

    return {
      resource,
      assignments: taskDetails,
      summary: {
        totalAllocatedHours,
        capacityHoursPerWeek: resource.capacityHoursPerWeek,
        utilization,
        activeAssignments: assignments.length,
      },
    };
  });

  // GET /resources/capacity-by-role — Capacity planning by role (#5)
  fastify.get('/capacity-by-role', { preHandler: [requireScope('read')] }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    const resources = await resourceService.findAllResources();
    const allAssignments = await resourceService.findAllAssignments();

    const DAY_MS = 86_400_000;
    const WEEK_MS = 7 * DAY_MS;
    const now = new Date();
    const startWeek = new Date(now);
    startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));

    const weeks: Date[] = [];
    for (let i = 0; i < 12; i++) {
      weeks.push(new Date(startWeek.getTime() + i * WEEK_MS));
    }

    // Group resources by role
    const roleMap = new Map<string, typeof resources>();
    for (const r of resources) {
      if (!r.isActive) continue;
      const arr = roleMap.get(r.role) || [];
      arr.push(r);
      roleMap.set(r.role, arr);
    }

    const roles = [...roleMap.entries()].map(([role, roleResources]) => {
      const resourceIds = new Set(roleResources.map(r => r.id));
      const totalCapacity = roleResources.reduce((s, r) => s + r.capacityHoursPerWeek, 0);
      const roleAssignments = allAssignments.filter(a => resourceIds.has(a.resourceId));

      const weeklyData = weeks.map(weekStart => {
        const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
        let allocated = 0;
        for (const a of roleAssignments) {
          const aStart = new Date(a.startDate).getTime();
          const aEnd = new Date(a.endDate).getTime();
          if (aStart < weekEnd.getTime() && aEnd >= weekStart.getTime()) {
            allocated += a.hoursPerWeek;
          }
        }
        const surplus = totalCapacity - allocated;
        return {
          weekStart: weekStart.toISOString().slice(0, 10),
          capacity: totalCapacity,
          allocated,
          surplus,
          status: surplus > totalCapacity * 0.2 ? 'surplus' as const : surplus >= 0 ? 'tight' as const : 'over' as const,
        };
      });

      return { role, resourceCount: roleResources.length, totalCapacity, weeks: weeklyData };
    });

    return { roles, weekHeaders: weeks.map(w => w.toISOString().slice(0, 10)) };
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
