import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { maySeePayRates, maySetPayRates } from '../../utils/payRates';
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
 * Rates are pay information: only the people who manage costs see the card, plus finance officers;
 * only the managers change it (utils/payRates.ts — the same rule hides each person's rate in the
 * people lists).
 */
async function rateCardReaders(request: FastifyRequest, reply: FastifyReply) {
  if (await maySeePayRates(request)) return;
  return reply.status(403).send({ error: 'Forbidden', message: 'Only the company owner, a PMO, a project manager or a finance officer can see the rate card.' });
}
async function rateCardManagerOnly(request: FastifyRequest, reply: FastifyReply) {
  if (await maySetPayRates(request)) return;
  return reply.status(403).send({ error: 'Forbidden', message: 'Only the company owner, a PMO or a project manager can change the rate card.' });
}

export async function rateCardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/', { preHandler: [requireScope('read'), rateCardReaders] }, async () => {
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
