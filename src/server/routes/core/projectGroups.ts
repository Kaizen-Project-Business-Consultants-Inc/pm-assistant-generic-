import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { projectGroupService, mergeIntoFullOrder } from '../../services/ProjectGroupService';
import { sendValidationError } from '../../utils/validationError';
import { checkProjectRoleFor } from '../../middleware/requireProjectAccess';
import { clientService, ClientNotFoundError } from '../../services/ClientService';
import { renderClientReportHtml } from '../../utils/clientReportRenderer';
import { buildClientReportDocx } from '../../utils/clientReportDocx';
import { emailService, EmailRejectedError } from '../../services/EmailService';
import { heavyActionLimit } from '../../middleware/rateLimiter';
import { readableProjectIds } from '../../utils/readableProjects';
import { databaseService } from '../../database/connection';
import { trialEmailAllowance } from '../../utils/trialEmail';

/**
 * Project groups are shown as CLIENTS (2026-10-07): a consultant's customers. Clients never sign
 * in — they get reports. Managing the client list is for the company owner, PMO and project
 * managers; putting a project under a client is for that project's Manager/Owner (before, any
 * member could do both). The RAID view and the report only include projects the viewer can open.
 */
const CLIENT_MANAGERS = ['pmo', 'project_manager']; // the company owner works as PMO
const canManageClients = (role: string) => CLIENT_MANAGERS.includes(role);
const NOT_MANAGER = { error: 'Forbidden', message: 'Only the company owner, PMO and project managers manage clients.' };
/**
 * Renaming, deleting or reordering a client changes it for every project manager's projects, so it is for the
 * company owner/PMO, or the project manager who added that client (any PM could rename or delete
 * any client — audit 2, L-g, 2026-10-11). Same rule on the client: hooks/useCanManageClients.ts.
 */
const canChangeClient = (user: { role: string; userId: string }, group: { createdBy: string | null }) =>
  user.role === 'pmo' || (user.role === 'project_manager' && !!group.createdBy && group.createdBy === user.userId);
const NOT_CLIENT_OWNER_REORDER = { error: 'Forbidden', message: 'Only the company owner, a PMO or the project manager who added a client can move it in the list.' };
const NOT_CLIENT_OWNER = { error: 'Forbidden', message: 'Only the company owner, a PMO or the project manager who added this client can rename or delete it.' };

const emailSchema = z.object({
  recipients: z.array(z.string().email('Each recipient must be an email address.'), { message: 'Say who to send it to (recipients).' })
    .min(1, 'Add at least one recipient.').max(20, 'Send to at most 20 people at once.'),
});

const NAME_MESSAGE = 'Enter a name for the client.';
const COLOR_MESSAGE = 'Pick a colour as a hex code, e.g. #3B82F6.';

const createSchema = z.object({
  name: z.string({ message: NAME_MESSAGE }).trim().min(1, NAME_MESSAGE).max(255, 'Keep the client name under 255 characters.'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, COLOR_MESSAGE).optional(),
  icon: z.string().max(50, 'Keep the icon name under 50 characters.').optional(),
});

const updateSchema = z.object({
  name: z.string({ message: NAME_MESSAGE }).trim().min(1, NAME_MESSAGE).max(255, 'Keep the client name under 255 characters.').optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, COLOR_MESSAGE).optional(),
  icon: z.string().max(50, 'Keep the icon name under 50 characters.').optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string({ message: 'Each client in the new order must be a client id.' }), {
    message: 'Send the clients in their new order (orderedIds).',
  }),
});

const PROJECT_MESSAGE = 'Say which project (projectId).';
const projectSchema = z.object({
  projectId: z.string({ message: PROJECT_MESSAGE }).min(1, PROJECT_MESSAGE),
});

/**
 * Turn a caller mistake into a clear 4xx instead of a 500: a body that fails its schema
 * (400), a group that doesn't exist (404), a duplicate name (409). Anything else is a real
 * failure and goes to the global error handler.
 */
function handleGroupError(reply: FastifyReply, err: unknown) {
  if (err instanceof z.ZodError) return sendValidationError(reply, err);
  const message = err instanceof Error ? err.message : '';
  if (message === 'Group not found' || err instanceof ClientNotFoundError) {
    return reply.status(404).send({ error: 'Not found', message: 'That client no longer exists.' });
  }
  // by name: the service is replaced in some tests, so its class may not be the one thrown
  if (err instanceof Error && err.name === 'ClientHasPeopleError') return reply.status(409).send({ error: 'Conflict', message: err.message });
  if (message === 'A group with this name already exists') {
    return reply.status(409).send({ error: 'Conflict', message: 'A client with this name already exists — choose another name.' });
  }
  throw err;
}

export async function projectGroupRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list all groups. A guest is an outsider: only the clients of projects they are on
  // (the whole client list went to everyone, guests included — 2026-10-09 audit, low).
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const groups = await projectGroupService.getGroups();
    if (!request.user!.isGuest) return { groups };
    const readable = await readableProjectIds(request.user!);
    if (readable === 'all') return { groups };
    const ids = [...readable];
    if (ids.length === 0) return { groups: [] };
    const rows = await databaseService.query<{ group_id: string }>(
      `SELECT DISTINCT group_id FROM projects WHERE id IN (${ids.map(() => '?').join(',')}) AND group_id IS NOT NULL`, ids);
    const theirs = new Set(rows.map((r) => r.group_id));
    return { groups: groups.filter((g) => theirs.has(g.id)) };
  });

  // POST / — create group
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!canManageClients(user.role)) return reply.status(403).send(NOT_MANAGER);
      const parsed = createSchema.parse(request.body ?? {});
      const group = await projectGroupService.createGroup(parsed, user.userId);
      return reply.status(201).send(group);
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // PUT /reorder — reorder groups (must be before /:id routes)
  fastify.put('/reorder', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!canManageClients(request.user!.role)) return reply.status(403).send(NOT_MANAGER);
      const { orderedIds } = reorderSchema.parse(request.body ?? {});
      // Reordering moves each listed client, so — like rename/delete — a project manager may list
      // only the clients they added (user decision, 2026-10-11). The listed clients move among the
      // places they hold in the FULL list; everyone else's keep theirs. One read.
      const groups = await projectGroupService.getGroups();
      if (request.user!.role !== 'pmo') {
        const byId = new Map(groups.map(g => [g.id, g]));
        const notTheirs = orderedIds.some(id => { const g = byId.get(id); return !!g && !canChangeClient(request.user!, g); });
        if (notTheirs) return reply.status(403).send(NOT_CLIENT_OWNER_REORDER);
      }
      await projectGroupService.reorderGroups(mergeIntoFullOrder(groups.map(g => g.id), orderedIds));
      return { ok: true };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // PUT /unassign — unassign project from group
  fastify.put('/unassign', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = projectSchema.parse(request.body ?? {});
      const access = await checkProjectRoleFor(request.user!, projectId, 'manager');
      if (!access.ok) return reply.status(access.status).send(access.body);
      await projectGroupService.unassignProject(projectId);
      return { ok: true };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // PUT /:id — update group
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      if (!canManageClients(request.user!.role)) return reply.status(403).send(NOT_MANAGER);
      const parsed = updateSchema.parse(request.body ?? {});
      const existing = await projectGroupService.getGroup(id);
      if (!existing) throw new ClientNotFoundError();
      if (!canChangeClient(request.user!, existing)) return reply.status(403).send(NOT_CLIENT_OWNER);
      const group = await projectGroupService.updateGroup(id, parsed);
      return group;
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // DELETE /:id — delete group
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      if (!canManageClients(request.user!.role)) return reply.status(403).send(NOT_MANAGER);
      const existing = await projectGroupService.getGroup(id);
      if (!existing) throw new ClientNotFoundError();
      if (!canChangeClient(request.user!, existing)) return reply.status(403).send(NOT_CLIENT_OWNER);
      await projectGroupService.deleteGroup(id);
      return { ok: true };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // PUT /:id/assign — assign project to group
  fastify.put('/:id/assign', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { projectId } = projectSchema.parse(request.body ?? {});
      const access = await checkProjectRoleFor(request.user!, projectId, 'manager');
      if (!access.ok) return reply.status(access.status).send(access.body);
      await projectGroupService.assignProject(projectId, id);
      return { ok: true };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // GET /:id/raid — the client's open risks & issues across the projects the viewer can open
  fastify.get('/:id/raid', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const q = (request.query as { show?: string }) ?? {};
      const show = q.show === 'all' || q.show === 'high' ? q.show : 'open';
      return await clientService.raid(id, request.user!, show);
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // GET /:id/report — one report across the client's projects (data + the rendered page)
  fastify.get('/:id/report', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const report = await clientService.report(id, request.user!);
      return { report, html: renderClientReportHtml(report) };
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // GET /:id/report/docx — the same report as Word
  fastify.get('/:id/report/docx', { preHandler: [requireScope('read'), heavyActionLimit('client-report-docx', 30)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const report = await clientService.report(id, request.user!);
      const buf = await buildClientReportDocx(report);
      const safe = report.client.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase() || 'client';
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="client-report-${safe}-${report.today}.docx"`)
        .send(buf);
    } catch (err) {
      return handleGroupError(reply, err);
    }
  });

  // POST /:id/report/email — send the report to the client (owner, PMO or a project manager)
  fastify.post('/:id/report/email', { preHandler: [requireScope('write'), heavyActionLimit('client-report-email', 20, 60 * 60_000), trialEmailAllowance()] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!canManageClients(request.user!.role)) return reply.status(403).send({ error: 'Forbidden', message: 'Only the company owner, PMO and project managers send client reports.' });
      const { id } = request.params as { id: string };
      const { recipients } = emailSchema.parse(request.body ?? {});
      const report = await clientService.report(id, request.user!);
      await emailService.sendStatusReportEmail(recipients, `${report.client.name} (client report)`, renderClientReportHtml(report));
      return { success: true };
    } catch (err) {
      if (err instanceof EmailRejectedError) {
        return reply.status(400).send({ error: 'Recipient refused', message: `The report could not be sent: ${err.providerMessage}` });
      }
      return handleGroupError(reply, err);
    }
  });
}
