import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { meetingActionItemService } from '../../services/MeetingActionItemService';
import { requireProjectAccess, checkProjectRole } from '../../middleware/requireProjectAccess';
import { ownWorkScope } from '../../middleware/viewerWriteBypass';
import { meetingRepository } from '../../database/MeetingRepository';

/**
 * Meeting action items (Sep 2026 rules): the project's Manager/Owner creates, edits,
 * reassigns and cancels them; the person an item is assigned to can mark it done, reopen it,
 * move it to in-progress and add notes — nothing else, and only on their own items.
 */
const meetingProject = async (meetingId?: string) => (meetingId ? (await meetingRepository.findById(meetingId))?.projectId ?? null : null);
const createPM = requireProjectAccess('manager', { resolve: async (req) => meetingProject((req.body as any)?.meetingId) });
const listMember = requireProjectAccess('viewer', {
  resolve: async (req) => {
    const q = req.query as { projectId?: string; meetingId?: string };
    return q.meetingId ? meetingProject(q.meetingId) : q.projectId ?? null;
  },
});
const itemMember = requireProjectAccess('viewer', {
  resolve: async (req) => (await meetingActionItemService.getItem((req.params as { id: string }).id))?.projectId ?? null,
});
/** What an assignee (not the PM) may change on their own item */
const ASSIGNEE_FIELDS = new Set(['status', 'notes']);
const ASSIGNEE_STATUSES = new Set(['open', 'in_progress', 'completed']);

/** PM → anything; the assignee → only their own item (and `assigneeOk` decides which changes). */
async function actionItemGate(request: FastifyRequest, reply: FastifyReply): Promise<{ asManager: boolean } | null> {
  const { id } = request.params as { id: string };
  const item = await meetingActionItemService.getItem(id);
  if (!item) { reply.status(404).send({ error: 'Action item not found' }); return null; }
  const pm = await checkProjectRole(request, item.projectId, 'manager');
  if (pm.ok) return { asManager: true };
  const member = await checkProjectRole(request, item.projectId, 'viewer');
  if (!member.ok) { reply.status(member.status).send(member.body); return null; }
  if (item.assigneeUserId && item.assigneeUserId === request.user!.userId) return { asManager: false };
  reply.status(403).send({ error: 'not_assignee', message: "Only the project's Manager or Owner, or the person this action is assigned to, can update it." });
  return null;
}

const createSchema = z.object({
  meetingId: z.string().min(1),
  description: z.string().min(1).max(5000),
  assigneeName: z.string().max(255).optional(),
  assigneeUserId: z.string().max(36).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  notes: z.string().max(5000).optional(),
});

const updateSchema = z.object({
  description: z.string().min(1).max(5000).optional(),
  assigneeName: z.string().max(255).optional(),
  assigneeUserId: z.string().max(36).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
  notes: z.string().max(5000).optional(),
});

export async function meetingActionItemRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list action items (filter by projectId, meetingId, status, assigneeUserId, overdue)
  fastify.get('/', { preHandler: [requireScope('read'), listMember] }, async (request: FastifyRequest) => {
    const { projectId, meetingId, status, assigneeUserId, overdue } = request.query as {
      projectId?: string; meetingId?: string; status?: string;
      assigneeUserId?: string; overdue?: string;
    };

    if (meetingId) {
      const items = await meetingActionItemService.getItemsByMeeting(meetingId);
      return { items };
    }
    if (!projectId) throw new Error('projectId or meetingId query parameter is required');

    const items = await meetingActionItemService.getItemsByProject(projectId, {
      status,
      assigneeUserId,
      overdue: overdue === 'true',
    });
    return { items };
  });

  // GET /my — my action items across all projects
  fastify.get('/my', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { status, overdue } = request.query as { status?: string; overdue?: string };
    const items = await meetingActionItemService.getMyItems(user.userId, {
      status,
      overdue: overdue === 'true',
    });
    return { items };
  });

  // GET /summary — counts by status + overdue
  fastify.get('/summary', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.query as { projectId?: string };
    if (projectId) {
      const d = await checkProjectRole(request, projectId, 'viewer');
      if (!d.ok) return reply.status(d.status).send(d.body);
    } else if (!['admin', 'pmo', 'executive'].includes(request.user!.role)) {
      return reply.status(400).send({ error: 'projectId required', message: 'Choose a project.' });
    }
    const summary = await meetingActionItemService.getSummary(projectId);
    return { summary };
  });

  // POST / — create action item
  fastify.post('/', { preHandler: [requireScope('write'), createPM] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const parsed = createSchema.parse(request.body);
    const item = await meetingActionItemService.createItem(parsed.meetingId, parsed, user.userId);
    return reply.status(201).send(item);
  });

  // GET /:id — get single
  fastify.get('/:id', { preHandler: [requireScope('read'), itemMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const item = await meetingActionItemService.getItem(id);
    if (!item) return reply.status(404).send({ error: 'Action item not found' });
    return item;
  });

  // PUT /:id — update
  fastify.put('/:id', { preHandler: [ownWorkScope()] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const gate = await actionItemGate(request, reply);
    if (!gate) return;
    const parsed = updateSchema.parse(request.body);
    if (!gate.asManager) {
      const other = Object.keys(parsed).filter(k => !ASSIGNEE_FIELDS.has(k));
      if (other.length > 0 || (parsed.status && !ASSIGNEE_STATUSES.has(parsed.status))) {
        return reply.status(403).send({ error: 'assignee_limited', message: "As the assignee you can mark this done, reopen it or add notes. Ask the project manager to change anything else." });
      }
    }
    return meetingActionItemService.updateItem(id, parsed, user.userId);
  });

  // POST /:id/complete — complete
  fastify.post('/:id/complete', { preHandler: [ownWorkScope()] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    if (!(await actionItemGate(request, reply))) return;
    return meetingActionItemService.completeItem(id, user.userId);
  });

  // POST /:id/reopen — reopen
  fastify.post('/:id/reopen', { preHandler: [ownWorkScope()] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    if (!(await actionItemGate(request, reply))) return;
    return meetingActionItemService.reopenItem(id, user.userId);
  });

  // POST /:id/cancel — cancel
  fastify.post('/:id/cancel', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const gate = await actionItemGate(request, reply);
    if (!gate) return;
    if (!gate.asManager) return reply.status(403).send({ error: 'pm_only', message: "Only the project's Manager or Owner can cancel an action item." });
    return meetingActionItemService.cancelItem(id, user.userId);
  });
}
