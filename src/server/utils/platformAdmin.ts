import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The Kovarti platform admin (user rule, 2026-10-04): the role 'admin' AND no company.
 * "Admin owns nothing." No company member is, or can become, an admin — company owners
 * cannot grant the role (routes/core/org.ts) and UserService refuses to write it.
 *
 * Every platform screen (all companies, plans, password resets, revenue, logs, support
 * visits, all-company feedback, the AI kill switch, skills…) checks THIS, never the bare
 * role: until 2026-10-04 they checked only role === 'admin', and a company owner could
 * hand that role to a member (guard: __tests__/middleware/platformAdminGuard.test.ts).
 *
 * `hasCompany` is set by authMiddleware from the user's row; when it isn't known the answer
 * is no (fail closed).
 */
export function isPlatformAdmin(user: { role?: string; hasCompany?: boolean } | null | undefined): boolean {
  return !!user && user.role === 'admin' && user.hasCompany === false;
}

/** For handlers: sends 403 and returns false unless the caller is the platform admin */
export function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!isPlatformAdmin(request.user)) {
    reply.status(403).send({ error: 'Forbidden', message: 'Only the Kovarti platform admin can do this.' });
    return false;
  }
  return true;
}

/**
 * As a route preHandler. It must RETURN the reply when it refuses: an async hook that sends and
 * returns nothing lets the route run anyway (the response's async onSend hooks haven't finished,
 * so Fastify doesn't yet count it as sent) — until 2026-10-09 every route behind this gate still
 * did its work for anyone signed in, after answering 403 (guard: replyDiscipline.test.ts).
 */
export async function platformAdminOnly(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if (!requirePlatformAdmin(request, reply)) return reply;
}
