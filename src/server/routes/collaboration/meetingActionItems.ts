import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { meetingActionItemService } from '../../services/MeetingActionItemService';

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
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
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
  fastify.get('/summary', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId } = request.query as { projectId?: string };
    const summary = await meetingActionItemService.getSummary(projectId);
    return { summary };
  });

  // POST / — create action item
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const parsed = createSchema.parse(request.body);
    const item = await meetingActionItemService.createItem(parsed.meetingId, parsed, user.userId);
    return reply.status(201).send(item);
  });

  // GET /:id — get single
  fastify.get('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const item = await meetingActionItemService.getItem(id);
    if (!item) return reply.status(404).send({ error: 'Action item not found' });
    return item;
  });

  // PUT /:id — update
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.parse(request.body);
    return meetingActionItemService.updateItem(id, parsed, user.userId);
  });

  // POST /:id/complete — complete
  fastify.post('/:id/complete', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    return meetingActionItemService.completeItem(id, user.userId);
  });

  // POST /:id/reopen — reopen
  fastify.post('/:id/reopen', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    return meetingActionItemService.reopenItem(id, user.userId);
  });

  // POST /:id/cancel — cancel
  fastify.post('/:id/cancel', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    return meetingActionItemService.cancelItem(id, user.userId);
  });
}
