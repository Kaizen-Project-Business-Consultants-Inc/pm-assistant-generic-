import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../../config';
import { authMiddleware } from '../../middleware/auth';
import { rateLimiter } from '../../middleware/rateLimiter';
import { userService } from '../../services/UserService';
import { sendValidationError } from '../../utils/validationError';
import {
  supportSessionService, SupportSessionError, SUPPORT_COOKIE, SUPPORT_SESSION_MINUTES,
} from '../../services/SupportSessionService';

const startSchema = z.object({
  organizationId: z.string().uuid('Pick the company to view.'),
  reason: z.string().trim().min(10, 'Say why you need to look (at least 10 characters) — the company sees this reason.').max(500, 'Keep the reason under 500 characters.'),
  password: z.string().min(1, 'Enter your password to start a support visit.'),
});

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.user?.role !== 'admin') {
    reply.status(403).send({ error: 'Forbidden', message: 'Only the platform admin can start a support visit.' });
    return false;
  }
  return true;
}

/**
 * Support view (read-only, recorded) — start and end a visit into one company.
 * Registered under /api/v1/admin, so the visit itself never applies to these routes.
 */
export async function supportSessionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/current', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const visit = await supportSessionService.findActive(request.cookies?.[SUPPORT_COOKIE], request.user!.userId);
    return { visit };
  });

  fastify.post('/', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const rl = rateLimiter.check(`support:start:${request.user!.userId}`, 5, 15 * 60_000);
    if (!rl.allowed) return reply.status(429).send({ error: 'Too many attempts', message: 'Too many support visits started — wait a few minutes.' });

    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    // Your password again: this account can see into every customer
    const me = await userService.findById(request.user!.userId);
    if (!me || !(await bcrypt.compare(parsed.data.password, me.passwordHash))) {
      return reply.status(403).send({ error: 'wrong_password', message: "That password isn't right, so the support visit wasn't started." });
    }

    try {
      const visit = await supportSessionService.start({
        adminUserId: me.id, organizationId: parsed.data.organizationId, reason: parsed.data.reason, ipAddress: request.ip,
      });
      reply.setCookie(SUPPORT_COOKIE, visit.id, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: SUPPORT_SESSION_MINUTES * 60,
      });
      return reply.status(201).send({ visit });
    } catch (err) {
      if (err instanceof SupportSessionError) return reply.status(err.status).send({ error: 'support_visit', message: err.message });
      throw err;
    }
  });

  fastify.delete('/current', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    await supportSessionService.end(request.cookies?.[SUPPORT_COOKIE], request.user!.userId);
    reply.clearCookie(SUPPORT_COOKIE, { path: '/' });
    return { ended: true };
  });
}
