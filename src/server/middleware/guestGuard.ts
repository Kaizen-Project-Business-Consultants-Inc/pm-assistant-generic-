import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Called from authMiddleware once the user is known (not as a global hook — those run before
 * authentication and never saw a guest).
 * Middleware that restricts guest users to only their allowed routes.
 * Guests CANNOT: create projects, access org settings, invite users, access billing.
 * Guests CAN: view assigned projects, comment, update assigned tasks.
 */

const GUEST_BLOCKED_PREFIXES = [
  '/api/v1/org',
  '/api/v1/seats',
  '/api/v1/stripe',
  '/api/v1/admin',
  '/api/v1/api-keys',
  '/api/v1/webhooks',
  '/api/v1/pricing',
];

export const GUEST_EXPIRED_MESSAGE = 'Your guest access has expired. Please contact the project administrator.';

export function guestExpired(user: { isGuest?: boolean; guestExpiresAt?: Date | string | null }): boolean {
  return !!user.isGuest && !!user.guestExpiresAt && new Date(user.guestExpiresAt) < new Date();
}

const GUEST_BLOCKED_METHODS_ON_PROJECTS: Set<string> = new Set(['POST']);

export async function guestGuard(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const user = request.user;
  if (!user || !user.isGuest) return;

  const url = request.url;

  // Block all admin/org/billing routes
  for (const prefix of GUEST_BLOCKED_PREFIXES) {
    if (url.startsWith(prefix)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Guest users cannot access this resource',
      });
    }
  }

  // Block project creation (POST /api/v1/projects without :id)
  if (url === '/api/v1/projects' && request.method === 'POST') {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Guest users cannot create projects',
    });
  }

  // Check guest expiry (signing out still works). 401, so the app signs them out and the
  // sign-in page shows why, rather than a screen of failed requests.
  if (guestExpired(user) && !url.startsWith('/api/v1/auth/logout')) {
    return reply.status(401).send({ error: 'Expired', message: GUEST_EXPIRED_MESSAGE });
  }
}
