import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { projectService } from '../../services/ProjectService';
import { readableProjectIds } from '../../utils/readableProjects';
import { requireProjectAccess, projectsOfSchedules } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { parse as csvParse } from 'csv-parse/sync';
import { resourceService, normalizeSkills, ResourceValidationError } from '../../services/ResourceService';
import { isPlaceholderEmail } from '../../utils/placeholderEmail';
import { authMiddleware } from '../../middleware/auth';
import { maySeePayRates, maySetPayRates, peopleFor, withoutPay, withoutPayInput } from '../../utils/payRates';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { scheduleService } from '../../services/ScheduleService';
import { emailService, EmailRejectedError } from '../../services/EmailService';
import { databaseService } from '../../database/connection';
import { inviteService } from '../../services/InviteService';
import { taskAssignmentService } from '../../services/TaskAssignmentService';
import { resourceReplaceService } from '../../services/ResourceReplaceService';
import { teamPlannerService } from '../../services/TeamPlannerService';
import { rateLimiter, heavyActionLimit } from '../../middleware/rateLimiter';
import { checkCreate, checkUpdate, checkDelete, removeLogin, PeopleRightsError } from '../../services/peopleRights';
import { getRequestContext } from '../../middleware/requestContext';
import logger from '../../utils/logger';
import { utcDay, mondayOf } from '../../utils/workingDays';
import { hoursInWeek, calendarsFor } from '../../services/weeklyLoad';
import { isExamplePerson } from '../../utils/sampleData';
import { clampPagination } from '../../schemas/paginationSchema';
import { groupBy } from '../../utils/groupBy';

const skillSchema = z.union([
  z.string(),
  z.object({ name: z.string(), level: z.number().min(1).max(5) }),
]);

export const createResourceSchema = z.object({
  name: z.string().min(1),
  // Both required in the original schema; the DB column has always had
  // `NOT NULL DEFAULT ''` for both, and the rest of this route's own logic
  // (the invite-email flow below) already treats email as conditional
  // (`if (raw.email) {...}`) — the schema just never matched. A resource is
  // a personnel record for planning; name is the only thing that must be
  // known up front (e.g. entering a bid's Key Personnel list one name at a
  // time, filling in role/email later).
  role: z.string().optional(),
  // Required for a person and absent for a generic role (2026-10-01) — ResourceService
  // enforces it for every caller, so it's checked there, not only here
  // '' is let through so the service can say what to do ("use a generic role"), not "invalid email"
  email: z.string().trim().email().or(z.literal('')).optional(),
  isGeneric: z.boolean().optional(),
  // Who approves their timesheets — required for a person (the company owner if left out)
  lineManagerUserId: z.string().min(1).nullable().optional(),
  capacityHoursPerWeek: z.number().positive().default(40),
  skills: z.array(skillSchema).default([]),
  isActive: z.boolean().default(true),
  costRateHourly: z.number().min(0).nullable().default(null),
  overtimeRateHourly: z.number().min(0).nullable().default(null),
  useRateCard: z.boolean().default(false),
  resourceGroup: z.string().max(100).nullable().default(null),
  userId: z.string().uuid().nullable().default(null),
  calendarTemplateId: z.string().uuid().nullable().default(null),
});

// createResourceSchema.partial() is NOT enough here: this project's Zod version does
// not clear a field's .default(...) when .partial() wraps it (same bug class as
// updateProjectSchema/updateTaskSchema). An update that omitted isActive was silently
// reactivating a deactivated resource; omitting skills wiped them to []; cost/overtime
// rates got nulled. Override every defaulted field with a bare .optional() copy.
export const updateResourceSchema = createResourceSchema.partial().extend({
  capacityHoursPerWeek: z.number().positive().optional(),
  skills: z.array(skillSchema).optional(),
  isActive: z.boolean().optional(),
  costRateHourly: z.number().min(0).nullable().optional(),
  overtimeRateHourly: z.number().min(0).nullable().optional(),
  useRateCard: z.boolean().optional(),
  resourceGroup: z.string().max(100).nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  calendarTemplateId: z.string().uuid().nullable().optional(),
});

const createAssignmentSchema = z.object({
  resourceId: z.string().min(1),
  taskId: z.string().min(1),
  scheduleId: z.string().min(1),
  hoursPerWeek: z.number().positive(),
  startDate: z.string().date(),
  endDate: z.string().date(),
});

/**
 * Assigning people to a project's tasks (Sep 2026 rules): that project's Manager/Owner.
 * The resource pool itself (people, rates, import) is organisation data and unchanged.
 */
const bodyTaskPM = requireProjectAccess('manager', {
  resolve: async (req) => {
    const b = req.body as { taskId?: string; scheduleId?: string } | undefined;
    const task = b?.taskId ? await scheduleService.findTaskById(b.taskId) : null;
    if (!task || task.scheduleId !== b?.scheduleId) return null; // the task must be in that schedule
    return projectsOfSchedules([task.scheduleId]);
  },
});
const assignmentPM = requireProjectAccess('manager', {
  resolve: async (req) => {
    const rows = await databaseService.query<{ schedule_id: string }>('SELECT schedule_id FROM resource_assignments WHERE id = ?', [(req.params as { id: string }).id]);
    return rows[0] ? projectsOfSchedules([rows[0].schedule_id]) : null;
  },
});

/**
 * Invite a resource to log in (the Invite button). Saving a resource never sends anything
 * (2026-10-01) — inviting is a separate, deliberate step. Says what happened either way.
 */
async function inviteResource(
  request: FastifyRequest,
  resource: { id: string; name: string; role: string; email: string; isGeneric?: boolean },
): Promise<{ sent: boolean; message: string }> {
  if (resource.isGeneric) return { sent: false, message: "A generic role can't be invited. Replace it with a real person on the tasks instead." };
  const email = resource.email?.trim();
  if (!email || isPlaceholderEmail(email)) {
    return { sent: false, message: `${resource.name} has a placeholder email. Add their real email first, then invite them.` };
  }
  // The request user carries only id/username/role — read the rest (it used to read email, name
  // and company off request.user, got nothing, and told people already in YOUR company that they
  // belong to "another company"; found 2026-10-05)
  const inviterUserId = request.user!.userId;
  const [inviter] = await databaseService.queryControlPlane<{ email: string; full_name: string | null }>(
    'SELECT email, full_name FROM users WHERE id = ? LIMIT 1', [inviterUserId]);
  const inviterEmail = inviter?.email;
  const inviterName = inviter?.full_name || inviterEmail || 'A team member';
  const inviterOrgId = getRequestContext()?.organizationId;

  if (inviterEmail && email.toLowerCase() === inviterEmail.toLowerCase()) {
    return { sent: false, message: 'This resource uses your own email. You already have access — no invite was sent.' };
  }
  const [duplicate] = await databaseService.query<{ id: string; name: string }>(
    'SELECT id, name FROM resources WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1',
    [email, resource.id],
  );
  if (duplicate) return { sent: false, message: `Another resource already uses this email: "${duplicate.name}". No invite was sent.` };

  const rl = await rateLimiter.checkAsync(`resource-invite:${inviterUserId}`, 20, 3_600_000);
  if (!rl.allowed) {
    logger.warn('Resource invite rate limit exceeded', { userId: inviterUserId });
    return { sent: false, message: "You've sent a lot of invites in the last hour. Try again later." };
  }

  const [existingUser] = await databaseService.queryControlPlane<{ id: string; organization_id: string }>(
    'SELECT id, organization_id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
    [email],
  );
  if (existingUser && existingUser.organization_id !== inviterOrgId) {
    // Different company — a misleading invite would only confuse them
    logger.info('Resource invite skipped for a user of another company', { inviterOrgId });
    return { sent: false, message: "This person has an account with another company, so they can't be invited to yours yet." };
  }
  if (existingUser) {
    await emailService.sendResourceInviteEmail(email, { resourceName: resource.name, role: resource.role || 'Team Member', inviterName, isRegistered: true });
    return { sent: true, message: `${resource.name} already has a login — we emailed them a link to your projects.` };
  }
  // No account yet — a company invite (seat/viewer limits and duplicates are checked there)
  const invite = await inviteService.createInvite(inviterUserId, email, null, 'viewer', { skipEmail: true });
  await emailService.sendResourceInviteEmail(email, { resourceName: resource.name, role: resource.role || 'Team Member', inviterName, isRegistered: false, inviteToken: invite.token });
  return { sent: true, message: `Invite sent to ${email}.` };
}

/** The Replace dialog and action belong to the plan's Manager/Owner */
const scheduleQueryPM = requireProjectAccess('manager', {
  resolve: async (req) => projectsOfSchedules([(req.query as { scheduleId?: string } | undefined)?.scheduleId]),
});
const bodySchedulePM = requireProjectAccess('manager', {
  resolve: async (req) => projectsOfSchedules([(req.body as { scheduleId?: string } | undefined)?.scheduleId]),
});

// Team Planner drops: the PM of the dragged task's project
const plannerTaskPM = requireProjectAccess('manager', {
  resolve: async (req) => {
    const taskId = (req.body as { taskId?: unknown } | undefined)?.taskId;
    return typeof taskId === 'string' && taskId ? teamPlannerService.projectOfTask(taskId) : null;
  },
});

const plannerMoveSchema = z.object({
  taskId: z.string().min(1),
  fromResourceId: z.string().min(1).nullable(),
  toResourceId: z.string().min(1).nullable(),
  weeks: z.number().int().min(-52).max(52),
});

export async function resourceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /resources - List resources (paginated, optional group filter)
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { limit, offset, group } = request.query as { limit?: string; offset?: string; group?: string };
    const result = await resourceService.findAllResourcesPaginated(
      // text or negative values fall back to the defaults (a negative offset reached SQL — 2026-10-07)
      clampPagination({ limit, offset }).limit,
      clampPagination({ limit, offset }).offset,
      group || undefined,
    );
    // pay rates for cost managers only; emails not for guests (2026-10-09 audit M11)
    return { ...result, resources: await peopleFor(request, result.resources) };
  });

  // GET /resources/skills — Distinct skill names for autocomplete
  fastify.get('/skills', { preHandler: [requireScope('read')] }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    const skills = await resourceService.findAllDistinctSkillNames();
    return { skills };
  });

  // GET /resources/by-skill — Find resources by skill name + optional min level
  fastify.get('/by-skill', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { skill, minLevel } = request.query as { skill?: string; minLevel?: string };
    if (!skill || !skill.trim()) return reply.status(400).send({ error: 'skill query parameter is required' });
    const min = minLevel ? Math.min(Math.max(parseInt(minLevel) || 1, 1), 5) : undefined;
    const resources = await peopleFor(request, await resourceService.findBySkill(skill.trim(), min));
    return { resources };
  });

  // POST /resources - Create a resource
  fastify.post('/', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = createResourceSchema.parse(request.body);
      // pay fields only from those who may set pay; others get the defaults (no rate)
      const raw = (await maySetPayRates(request))
        ? parsed
        : { ...parsed, costRateHourly: null, overtimeRateHourly: null, useRateCard: false };
      await checkCreate(request.user, raw as any);
      const resource = await resourceService.createResource({
        ...raw,
        skills: normalizeSkills(raw.skills),
      } as any);
      return reply.status(201).send({ resource });
    } catch (error) {
      if (error instanceof PeopleRightsError) return reply.status(403).send({ error: 'Forbidden', message: error.message });
      if (error instanceof ResourceValidationError) return reply.status(400).send({ error: 'Invalid resource data', message: error.message });
      // A rejected field is the caller's mistake, not a server fault — say what
      // was actually wrong instead of a bare "Invalid resource data" that gives
      // no clue which field it was (matches the pattern already used in
      // projects.ts and bulk.ts).
      if (error instanceof z.ZodError) {
        const first = error.issues[0];
        return reply.status(400).send({
          error: 'Invalid resource data',
          message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request body',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        });
      }
      logger.error('Create resource error', { error });
      return reply.status(400).send({ error: 'Invalid resource data' });
    }
  });

  // PUT /resources/:id - Update a resource
  fastify.put('/:id', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const parsed = updateResourceSchema.parse(request.body);
      // a rate the caller may not set is never changed by them (most see it blank)
      const raw = (await maySetPayRates(request)) ? parsed : withoutPayInput(parsed);
      const data = raw.skills ? { ...raw, skills: normalizeSkills(raw.skills) } : raw;
      const existing = await resourceService.findResourceById(id);
      if (!existing) return reply.status(404).send({ error: 'Resource not found' });
      await checkUpdate(request.user, existing, data as any);
      const resource = await resourceService.updateResource(id, data as any);
      if (!resource) return reply.status(404).send({ error: 'Resource not found' });
      return { resource };
    } catch (error) {
      if (error instanceof PeopleRightsError) return reply.status(403).send({ error: 'Forbidden', message: error.message });
      if (error instanceof ResourceValidationError) return reply.status(400).send({ error: 'Invalid resource data', message: error.message });
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid resource data', message: error.issues[0] ? `${error.issues[0].path.join('.')}: ${error.issues[0].message}` : 'Invalid request body' });
      logger.error('Update resource error', { error });
      return reply.status(400).send({ error: 'Invalid resource data' });
    }
  });

  // POST /resources/:id/invite — the Invite button: invite this person to log in
  fastify.post('/:id/invite', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const resource = await resourceService.findResourceById(id);
    if (!resource) return reply.status(404).send({ error: 'Resource not found' });
    try {
      const result = await inviteResource(request, resource);
      return result.sent ? result : reply.status(400).send({ error: 'Invite not sent', message: result.message });
    } catch (error: any) {
      // Plan limits and a refused address are the caller's to fix — say so plainly
      if (error instanceof EmailRejectedError) return reply.status(400).send({ error: 'Invite not sent', message: `The email provider refused ${resource.email}: ${error.message}` });
      if (error?.message && /limit|plan|already/i.test(error.message)) return reply.status(400).send({ error: 'Invite not sent', message: error.message });
      logger.error('Resource invite error', { error: error?.message || error });
      return reply.status(500).send({ error: 'Invite not sent', message: 'Something went wrong sending the invite. Try again in a minute.' });
    }
  });

  // GET /resources/:id/tasks?scheduleId= — the tasks in one plan a resource is on (Replace dialog)
  fastify.get('/:id/tasks', { preHandler: [requireScope('read'), scheduleQueryPM] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { scheduleId } = request.query as { scheduleId: string };
    return { tasks: await resourceReplaceService.tasksOf(id, scheduleId) };
  });

  // POST /resources/replace/check — the Replace dialog's warning: weeks the new person would be over 100%
  fastify.post('/replace/check', { preHandler: [requireScope('read'), bodySchedulePM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({
      scheduleId: z.string().min(1),
      fromResourceId: z.string().min(1),
      toResourceId: z.string().min(1),
      taskIds: z.array(z.string().min(1)).max(500),
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation error', message: 'Send scheduleId, fromResourceId, toResourceId and taskIds' });
    const result = await resourceService.checkReplaceLoad({ fromId: parsed.data.fromResourceId, toId: parsed.data.toResourceId, scheduleId: parsed.data.scheduleId, taskIds: parsed.data.taskIds });
    if (!result) return reply.status(404).send({ error: 'Resource not found' });
    // Only weeks and percentages: the names of other projects' tasks stay private
    return { resourceName: result.resourceName, overWeeks: result.overWeeks.map(w => ({ weekStart: w.weekStart, utilization: w.utilization })) };
  });

  // POST /resources/replace — "Replace Generic Developer with …" on chosen tasks (undoable from History)
  fastify.post('/replace', { preHandler: [requireScope('write'), requireFeature('resources'), bodySchedulePM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({
      scheduleId: z.string().min(1),
      fromResourceId: z.string().min(1),
      toResourceId: z.string().min(1),
      taskIds: z.array(z.string().min(1)).min(1).max(500).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation error', message: 'Send scheduleId, fromResourceId, toResourceId and optionally taskIds' });
    const schedule = await scheduleService.findById(parsed.data.scheduleId);
    if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });
    try {
      return await resourceReplaceService.replace({
        projectId: schedule.projectId,
        scheduleId: schedule.id,
        fromId: parsed.data.fromResourceId,
        toId: parsed.data.toResourceId,
        taskIds: parsed.data.taskIds,
      });
    } catch (error) {
      if (error instanceof ResourceValidationError) return reply.status(400).send({ error: 'Not replaced', message: error.message });
      throw error;
    }
  });

  // GET /resources/planner?from=YYYY-MM-DD&weeks=8 — Team Planner: everyone on the viewer's
  // projects, week by week, across all their work (only projects the viewer manages; other
  // projects' work is hours only, named only if the viewer can open that project)
  fastify.get('/planner', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { from, weeks } = request.query as { from?: string; weeks?: string };
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return reply.status(400).send({ error: 'Validation error', message: 'from must be a date (YYYY-MM-DD)' });
    const start = from ?? new Date().toISOString().slice(0, 10);
    return teamPlannerService.board(request.user!, start, Number(weeks) || 8);
  });

  // POST /resources/planner/check — what a drop would do (nothing is saved)
  fastify.post('/planner/check', { preHandler: [requireScope('read'), plannerTaskPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = plannerMoveSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation error', message: 'Send taskId, fromResourceId, toResourceId and weeks' });
    try {
      return await teamPlannerService.preview(parsed.data);
    } catch (error) {
      if (error instanceof ResourceValidationError) return reply.status(400).send({ error: 'Not possible', message: error.message });
      throw error;
    }
  });

  // POST /resources/planner/move — apply a drop: one Schedule History change, undoable
  fastify.post('/planner/move', { preHandler: [requireScope('write'), requireFeature('resources'), plannerTaskPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = plannerMoveSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation error', message: 'Send taskId, fromResourceId, toResourceId and weeks' });
    try {
      const { changeId, summary } = await teamPlannerService.apply(parsed.data);
      return { changeId, summary };
    } catch (error) {
      if (error instanceof ResourceValidationError) return reply.status(400).send({ error: 'Not moved', message: error.message });
      throw error;
    }
  });

  // GET /resources/:id/delete-impact — Preview what will be affected by deleting this resource
  fastify.get('/:id/delete-impact', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const resource = await resourceService.findResourceById(id);
    if (!resource) return reply.status(404).send({ error: 'Resource not found' });

    // Count task assignments (Gantt resource column)
    const [taskAssignmentRow] = await databaseService.query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM task_assignments WHERE resource_id = ?', [id],
    );
    const taskAssignments = Number(taskAssignmentRow?.cnt || 0);

    // Count resource assignments (workload/capacity planning)
    const [resourceAssignmentRow] = await databaseService.query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM resource_assignments WHERE resource_id = ?', [id],
    );
    const resourceAssignments = Number(resourceAssignmentRow?.cnt || 0);

    // Count RAID items owned by this user
    let raidItems = 0;
    if (resource.userId) {
      const [raidRow] = await databaseService.query<{ cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM project_risks WHERE owner_id = ? AND status NOT IN ('closed','resolved','cancelled')", [resource.userId],
      );
      raidItems = Number(raidRow?.cnt || 0);
    }

    return {
      resourceName: resource.name,
      taskAssignments,
      resourceAssignments,
      raidItems,
    };
  });

  // DELETE /resources/:id
  fastify.delete('/:id', { preHandler: [requireScope('write'), requireFeature('resources')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { removeAccess } = request.query as { removeAccess?: string };

    // Look up resource before deleting (need its login for access removal)
    const resource = await resourceService.findResourceById(id);
    if (!resource) return reply.status(404).send({ error: 'Resource not found' });

    // Removing someone who signs in, or their login, is the company owner's or a PMO's call
    try {
      await checkDelete(request.user, [resource], removeAccess === 'true');
    } catch (error) {
      if (error instanceof PeopleRightsError) return reply.status(403).send({ error: 'Forbidden', message: error.message });
      throw error;
    }

    const deleted = await resourceService.deleteResource(id);
    if (!deleted) return reply.status(404).send({ error: 'Resource not found' });

    let accessRemoved = false;
    if (removeAccess === 'true') {
      accessRemoved = await removeLogin(resource);
      if (accessRemoved) logger.info('User access removed on resource delete', { resourceId: id, userId: resource.userId });
    }

    return { message: accessRemoved ? 'Resource deleted and their login removed' : 'Resource deleted', accessRemoved };
  });

  // POST /resources/bulk-delete
  fastify.post('/bulk-delete', { preHandler: [requireScope('write'), requireFeature('resources'), heavyActionLimit('people-bulk-delete', 20)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Provide an array of resource IDs (max 100)' });
    const people = await resourceService.findResourcesByIds(body.data.ids);
    try {
      await checkDelete(request.user, people, false);
    } catch (error) {
      if (error instanceof PeopleRightsError) return reply.status(403).send({ error: 'Forbidden', message: error.message });
      throw error;
    }
    const deleted = await resourceService.deleteResources(body.data.ids);
    return { deleted };
  });

  // GET /resources/assignments/:scheduleId
  fastify.get('/assignments/:scheduleId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { scheduleId } = request.params as { scheduleId: string };
    const assignments = await resourceService.findAssignmentsBySchedule(scheduleId);
    return { assignments };
  });

  // POST /resources/assignments
  fastify.post('/assignments', { preHandler: [requireScope('write'), requireFeature('resources'), bodyTaskPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.delete('/assignments/:id', { preHandler: [requireScope('write'), requireFeature('resources'), assignmentPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const deleted = await resourceService.deleteAssignment(id);
    if (!deleted) return reply.status(404).send({ error: 'Assignment not found' });
    return { message: 'Assignment deleted' };
  });

  // GET /resources/workload - Global cross-project workload (#2)
  fastify.get('/workload', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const workload = await resourceService.computeGlobalWorkload();
    const totalProjectCost = Math.round(workload.reduce((sum, w) => sum + w.totalCost, 0) * 100) / 100;
    // Hours across all projects are shown to everyone (how busy is this person?); the money is
    // other projects' business — admin/PMO/executive only
    // …unless the viewer is on every project anyway (then it's all their own business)
    const readable = await readableProjectIds(request.user!);
    const seesAll = readable === 'all' || (await projectService.findAll()).every((p) => readable.has(p.id));
    const shown = (await maySeePayRates(request)) ? workload : withoutPay(workload);
    if (!seesAll) {
      return { workload: shown.map((w) => ({ ...w, totalCost: null })), costSummary: { totalProjectCost: null } };
    }
    return { workload: shown, costSummary: { totalProjectCost } };
  });

  // GET /resources/on-project/:projectId — the people doing work on this project (any of its
  // tasks), with how many tasks each, so the Team tab can show those who have no login yet.
  // Generic roles are left out: they are unfilled demand, not team members.
  fastify.get('/on-project/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) return { people: [] };
    // Anyone who has worked on the project counts, finished tasks included
    const bookings = await resourceService.findEffectiveAssignments({ scheduleIds: schedules.map((s) => s.id), includeDone: true });
    const tasksBy = new Map<string, Set<string>>();
    for (const b of bookings) {
      if (!tasksBy.has(b.resourceId)) tasksBy.set(b.resourceId, new Set());
      tasksBy.get(b.resourceId)!.add(b.taskId);
    }
    const resources = (await resourceService.findResourcesByIds([...tasksBy.keys()])).filter((r) => !r.isGeneric);
    return {
      people: resources
        .map((r) => ({
          // a guest is an outsider: names only (2026-10-09 audit M11)
          resourceId: r.id, name: r.name, role: r.role, email: request.user!.isGuest ? null : r.email, userId: r.userId,
          placeholderEmail: isPlaceholderEmail(r.email), taskCount: tasksBy.get(r.id)?.size ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  // GET /resources/workload/:projectId
  fastify.get('/workload/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const [workload, demand] = await Promise.all([
      resourceService.computeWorkload(projectId),
      resourceService.computeUnfilledDemand(projectId),
    ]);
    const totalProjectCost = Math.round(workload.reduce((sum, w) => sum + w.totalCost, 0) * 100) / 100;
    // a person's hourly rate is pay information: cost managers only (2026-10-09 audit M11)
    const shown = (await maySeePayRates(request)) ? workload : withoutPay(workload);
    return { workload: shown, demand, costSummary: { totalProjectCost } };
  });

  // GET /resources/:id/utilization-history (#6)
  fastify.get('/:id/utilization-history', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { weeks } = request.query as { weeks?: string };
    const numWeeks = Math.min(Math.max(Number(weeks) || 12, 4), 52);
    return resourceService.computeUtilizationHistory(id, numWeeks);
  });

  // POST /resources/quick-assign (#7) - Quick assign resource to task
  // POST /resources/load-check — would this booking push the person over 100%? (a read, sent as a
  // POST for the body). Other tasks are named only on projects the caller can read.
  fastify.post('/load-check', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/);
    const parsed = z.object({
      resourceId: z.string().min(1),
      startDate: day,
      endDate: day,
      allocationPct: z.number().min(0).max(100).default(100),
      excludeTaskId: z.string().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation error', message: 'Send resourceId, startDate, endDate (YYYY-MM-DD) and allocationPct' });
    const result = await resourceService.checkLoad(parsed.data);
    if (!result) return reply.status(404).send({ error: 'Resource not found' });

    const ids = [...new Set(result.overWeeks.flatMap(w => w.otherTaskIds))];
    const names = new Map<string, string>();
    if (ids.length) {
      const readable = await readableProjectIds(request.user!);
      const rows = await databaseService.query<{ id: string; name: string; project_id: string }>(
        `SELECT t.id, t.name, s.project_id FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE t.id IN (${ids.map(() => '?').join(',')})`, ids,
      );
      for (const r of rows) names.set(r.id, readable === 'all' || readable.has(r.project_id) ? r.name : 'Work on another project');
    }
    return {
      resourceId: result.resourceId,
      resourceName: result.resourceName,
      overWeeks: result.overWeeks.map(w => ({
        weekStart: w.weekStart, utilization: w.utilization, hours: w.hours, capacity: w.capacity,
        alsoOn: [...new Set(w.otherTaskIds.map(id => names.get(id) ?? 'Work on another project'))],
      })),
    };
  });

  fastify.post('/quick-assign', { preHandler: [requireScope('write'), requireFeature('resources'), bodyTaskPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.post('/import', { preHandler: [requireScope('write'), requireFeature('resources'), heavyActionLimit('people-import', 20)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = z.object({ csv: z.string().min(1).max(5 * 1024 * 1024) }).parse(request.body);
      const records: any[] = csvParse(body.csv, { columns: true, skip_empty_lines: true, trim: true, bom: true });

      if (records.length === 0) return reply.status(400).send({ error: 'CSV contains no data rows' });
      if (records.length > 200) return reply.status(400).send({ error: 'Maximum 200 resources per import' });

      const results: { created: number; errors: Array<{ row: number; error: string }> } = { created: 0, errors: [] };
      // a cost-rate column counts only for those who may set pay
      const ratesAllowed = await maySetPayRates(request);

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
        const costRate = costRaw && ratesAllowed ? parseFloat(costRaw) : null;
        const skillsRaw = row.skills || row.Skills || '';
        // eslint-disable-next-line no-restricted-syntax -- small: one CSV row's own skills
        const skills = skillsRaw ? skillsRaw.split(';').map((s: string) => s.trim()).filter(Boolean).map((s: string) => ({ name: s, level: 3 })) : [];
        const group = (row.resourceGroup || row.department || row.Department || '').trim() || null;

        try {
          // eslint-disable-next-line no-await-in-loop -- each row is checked and created on its own so a bad row gets its own error line (a duplicate of an earlier row included)
          await checkCreate(request.user, { email });
          // eslint-disable-next-line no-await-in-loop -- as above
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

    const assignments = await resourceService.findEffectiveAssignments({ resourceId: id });

    // Gather task names for each assignment — but only for projects the viewer is on; elsewhere
    // the hours count, the task and project stay private ("Work on another project")
    const readable = await readableProjectIds(request.user!);
    // Which project each plan belongs to and each task's name: one read each (was a read per
    // booking for the plan and another for the task; 2026-10-09)
    const scheduleIds = [...new Set(assignments.map(a => a.scheduleId))];
    const projectOfSchedule = new Map<string, string | null>();
    if (readable !== 'all' && scheduleIds.length) {
      const rows = await databaseService.query<{ id: string; project_id: string | null }>(
        `SELECT id, project_id FROM schedules WHERE id IN (${scheduleIds.map(() => '?').join(',')})`, scheduleIds);
      for (const r of rows) projectOfSchedule.set(r.id, r.project_id);
    }
    const visible = (scheduleId: string) => {
      if (readable === 'all') return true;
      const pid = projectOfSchedule.get(scheduleId);
      return !!pid && readable.has(pid);
    };
    const shownTaskIds = [...new Set(assignments.filter(a => visible(a.scheduleId)).map(a => a.taskId))];
    const taskName = new Map<string, string>();
    if (shownTaskIds.length) {
      const rows = await databaseService.query<{ id: string; name: string }>(
        `SELECT id, name FROM tasks WHERE id IN (${shownTaskIds.map(() => '?').join(',')})`, shownTaskIds);
      for (const r of rows) taskName.set(r.id, r.name);
    }
    const taskDetails: Array<{ assignmentId: string; taskId: string; taskName: string; scheduleId: string; hoursPerWeek: number; startDate: string; endDate: string }> = [];
    for (const a of assignments) {
      const show = visible(a.scheduleId);
      taskDetails.push({
        assignmentId: show && a.source === 'manual' ? a.id : '', // only hours bookings can be removed here
        taskId: show ? a.taskId : '',
        taskName: show ? (taskName.get(a.taskId) || 'Unknown Task') : 'Work on another project',
        scheduleId: show ? a.scheduleId : '',
        hoursPerWeek: a.hoursPerWeek,
        startDate: a.startDate,
        endDate: a.endDate,
      });
    }

    // This week's load: the working days of this week each booking covers (it used to add up
    // every booking the person has, months apart or not)
    const thisMonday = mondayOf(utcDay(new Date()).toISOString());
    const calOf = await calendarsFor(assignments.map(a => a.scheduleId), (sid) => scheduleService.workingDayTest(sid));
    const totalAllocatedHours = Math.round(assignments.reduce((s, a) => s + hoursInWeek(a, thisMonday, calOf(a.scheduleId)), 0) * 10) / 10;
    const utilization = resource.capacityHoursPerWeek > 0
      ? Math.round((totalAllocatedHours / resource.capacityHoursPerWeek) * 100)
      : 0;

    const [shown] = await peopleFor(request, [resource]);
    return {
      resource: shown,
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
    // People only — a generic role adds no capacity (its work is unfilled demand), nor do the
    // sample project's example people
    const resources = (await resourceService.findAllResources()).filter((r) => !r.isGeneric && !isExamplePerson(r));
    const allAssignments = await resourceService.findEffectiveAssignments();
    const calOf = await calendarsFor(allAssignments.map(a => a.scheduleId), (id) => scheduleService.workingDayTest(id));

    const DAY_MS = 86_400_000;
    const WEEK_MS = 7 * DAY_MS;
    const now = utcDay(new Date());
    const startWeek = new Date(now);
    startWeek.setUTCDate(startWeek.getUTCDate() - ((startWeek.getUTCDay() + 6) % 7));

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

    // Each role's bookings (of its active people), in list order — one pass, not one per role
    const roleOfResource = new Map<string, string>();
    for (const [role, roleResources] of roleMap) for (const r of roleResources) roleOfResource.set(r.id, role);
    const assignmentsOfRole = groupBy(
      allAssignments.filter(a => roleOfResource.has(a.resourceId)),
      a => roleOfResource.get(a.resourceId)!,
    );

    const roles = [...roleMap.entries()].map(([role, roleResources]) => {
      const totalCapacity = roleResources.reduce((s, r) => s + r.capacityHoursPerWeek, 0);
      const roleAssignments = assignmentsOfRole.get(role) ?? [];

      const weeklyData = weeks.map(weekStart => {
        const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
        // Only the working days each booking covers that week count
        const wk = weekStart.toISOString().slice(0, 10);
        let allocated = 0;
        for (const a of roleAssignments) allocated += hoursInWeek(a, wk, calOf(a.scheduleId));
        allocated = Math.round(allocated * 10) / 10;
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

  // GET /resources/project-allocations — Enhancement A: project allocations for all resources
  fastify.get('/project-allocations', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const allocations = await taskAssignmentService.getProjectAllocationsForAllResources();
    // Other projects' names are merged into one "Other projects" line (hours still add up)
    const readable = await readableProjectIds(request.user!);
    if (readable === 'all') return { allocations };
    const out: typeof allocations = {};
    for (const [rid, list] of Object.entries(allocations)) {
      // eslint-disable-next-line no-restricted-syntax -- small: each person's own allocations, each counted once
      const mine = list.filter((a) => readable.has(a.projectId));
      // eslint-disable-next-line no-restricted-syntax -- small: each person's own allocations, each counted once
      const others = list.filter((a) => !readable.has(a.projectId));
      out[rid] = others.length === 0 ? mine : [...mine, {
        projectId: '', projectName: 'Other projects', scheduleName: '',
        totalHoursPlanned: others.reduce((n, a) => n + a.totalHoursPlanned, 0),
        taskCount: others.reduce((n, a) => n + a.taskCount, 0),
      }];
    }
    return { allocations: out };
  });

  // GET /resources/usage/:projectId — Enhancement B: MPP-style resource usage for a project
  fastify.get('/usage/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const usage = await taskAssignmentService.getResourceUsageForProject(projectId);
    return { usage };
  });
}
