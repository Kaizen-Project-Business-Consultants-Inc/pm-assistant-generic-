import { FastifyRequest, FastifyReply } from 'fastify';

/**
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

const GUEST_BLOCKED_METHODS_ON_PROJECTS: Set<string> = new Set(['POST']);

export async function guestGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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

  // Check guest expiry
  if (user.guestExpiresAt && new Date(user.guestExpiresAt) < new Date()) {
    return reply.status(403).send({
      error: 'Expired',
      message: 'Your guest access has expired. Please contact the project administrator.',
    });
  }
}
