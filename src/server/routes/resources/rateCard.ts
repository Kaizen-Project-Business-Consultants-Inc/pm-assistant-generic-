import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { organizationService } from '../../services/OrganizationService';
import { rateCardService, RateCardError } from '../../services/RateCardService';
import { sendValidationError } from '../../utils/validationError';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date this rate starts.');
const rateSchema = z.object({
  role: z.string().trim().min(1, 'Enter the role this rate is for.').max(100, 'Keep the role under 100 characters.'),
  hourlyRate: z.number({ error: 'Enter the hourly rate as a number.' }).min(0, "The hourly rate can't be negative.").max(100000),
  overtimeRate: z.number().min(0, "The overtime rate can't be negative.").max(100000).nullable().optional(),
  effectiveFrom: ymd,
});

/**
 * Rates are pay information: only the people who manage costs see or change the card —
 * admins, PMO, project managers, and the company owner (a consultant is a PM and owns
 * their company). Team members and viewers don't see it at all.
 */
async function isRateCardManager(request: FastifyRequest): Promise<boolean> {
  const user = request.user!;
  if (user.isGuest) return false;
  if (['admin', 'pmo', 'project_manager'].includes(user.role)) return true;
  const org = await organizationService.findByUserId(user.userId).catch(() => null);
  return !!org && org.ownerUserId === user.userId;
}

async function rateCardManagerOnly(request: FastifyRequest, reply: FastifyReply) {
  if (await isRateCardManager(request)) return;
  return reply.status(403).send({ error: 'Forbidden', message: 'Only an admin or a project manager can see or change the rate card.' });
}

export async function rateCardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/', { preHandler: [requireScope('read'), rateCardManagerOnly] }, async () => {
    return { rates: await rateCardService.list() };
  });

  fastify.post('/', { preHandler: [requireScope('write'), requireFeature('resources'), rateCardManagerOnly] }, async (request, reply) => {
    const parsed = rateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      return reply.status(201).send({ rate: await rateCardService.create(parsed.data, request.user!.userId) });
    } catch (err) {
      if (err instanceof RateCardError) return reply.status(409).send({ error: 'Conflict', message: err.message });
      throw err;
    }
  });

  fastify.put('/:id', { preHandler: [requireScope('write'), requireFeature('resources'), rateCardManagerOnly] }, async (request, reply) => {
    const parsed = rateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      const rate = await rateCardService.update((request.params as { id: string }).id, parsed.data);
      if (!rate) return reply.status(404).send({ error: 'Not found', message: 'That rate no longer exists.' });
      return { rate };
    } catch (err) {
      if (err instanceof RateCardError) return reply.status(409).send({ error: 'Conflict', message: err.message });
      throw err;
    }
  });

  fastify.delete('/:id', { preHandler: [requireScope('write'), requireFeature('resources'), rateCardManagerOnly] }, async (request, reply) => {
    const ok = await rateCardService.remove((request.params as { id: string }).id);
    if (!ok) return reply.status(404).send({ error: 'Not found', message: 'That rate no longer exists.' });
    return { success: true };
  });
}
