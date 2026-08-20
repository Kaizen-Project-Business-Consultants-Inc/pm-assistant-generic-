import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { resourceRequestService } from '../../services/ResourceRequestService';

const createSchema = z.object({
  projectId: z.string().uuid(),
  resourceRole: z.string().min(1).max(100),
  resourceGroup: z.string().max(100).optional(),
  hoursNeeded: z.number().positive().max(10000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  justification: z.string().max(5000).optional(),
  skillsRequired: z.array(z.string().max(100)).max(20).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

const updateSchema = z.object({
  resourceRole: z.string().min(1).max(100).optional(),
  resourceGroup: z.string().max(100).optional(),
  hoursNeeded: z.number().positive().max(10000).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  justification: z.string().max(5000).optional(),
  skillsRequired: z.array(z.string().max(100)).max(20).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

export async function resourceRequestRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list resource requests
  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId, status, priority } = request.query as { projectId?: string; status?: string; priority?: string };
    const requests = await resourceRequestService.getRequests({ projectId, status, priority });
    return { requests };
  });

  // GET /pending — pending approvals
  fastify.get('/pending', { preHandler: [requireScope('read')] }, async () => {
    const requests = await resourceRequestService.getPendingApprovals();
    return { requests };
  });

  // GET /summary — counts by status
  fastify.get('/summary', { preHandler: [requireScope('read')] }, async () => {
    const summary = await resourceRequestService.getSummary();
    return { summary };
  });

  // GET /:id — detail
  fastify.get('/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const rr = await resourceRequestService.getRequest(id);
    if (!rr) return reply.status(404).send({ error: 'Resource request not found' });
    return rr;
  });

  // POST / — create
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const parsed = createSchema.parse(request.body);
    const rr = await resourceRequestService.createRequest(parsed.projectId, parsed, user.userId);
    return reply.status(201).send(rr);
  });

  // PUT /:id — update draft
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.parse(request.body);
    return resourceRequestService.updateRequest(id, parsed, user.userId);
  });

  // POST /:id/submit — submit for approval
  fastify.post('/:id/submit', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    return resourceRequestService.submitRequest(id, user.userId);
  });

  // POST /:id/approve — approve (manager+)
  fastify.post('/:id/approve', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { comment } = (request.body as { comment?: string }) || {};
    return resourceRequestService.approveRequest(id, user.userId, comment);
  });

  // POST /:id/reject — reject (manager+)
  fastify.post('/:id/reject', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { comment } = (request.body as { comment?: string }) || {};
    if (!comment) throw new Error('Comment is required when rejecting');
    return resourceRequestService.rejectRequest(id, user.userId, comment);
  });

  // POST /:id/fulfill — fulfill with resource
  fastify.post('/:id/fulfill', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { resourceId } = (request.body as { resourceId: string }) || {};
    if (!resourceId) throw new Error('resourceId is required');
    return resourceRequestService.fulfillRequest(id, resourceId, user.userId);
  });

  // POST /:id/cancel — cancel
  fastify.post('/:id/cancel', { preHandler: [requireScope('write')] }, async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    return resourceRequestService.cancelRequest(id, user.userId);
  });
}
